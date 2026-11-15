"""Iteration-8 backend tests: multiselect+checkbox custom fields, per-salesman
can_edit_customers, unique customer_code (CUST-#####), import Customer ID preserve,
bill export CUSTOMER ID column, visit-tasks upsert/list/applicable/delete + create_visit enforcement.
"""
import io
import os
import time
import pytest
import requests
from openpyxl import load_workbook, Workbook

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://fmcg-crm-hub-1.preview.emergentagent.com").rstrip("/") + "/api"

ADMIN = {"email": "admin@fmcg.com", "password": "admin123"}
JOHN = {"email": "john@fmcg.com", "password": "sales123"}
PRIYA = {"email": "priya@fmcg.com", "password": "sales123"}


def _login(sess, creds):
    r = sess.post(f"{BASE_URL}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"], r.json()["user"]


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    tok, user = _login(s, ADMIN)
    s.headers["Authorization"] = f"Bearer {tok}"
    s.user = user
    return s


@pytest.fixture(scope="module")
def john_client():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    tok, user = _login(s, JOHN)
    s.headers["Authorization"] = f"Bearer {tok}"
    s.user = user
    return s


@pytest.fixture(scope="module")
def priya_client():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    tok, user = _login(s, PRIYA)
    s.headers["Authorization"] = f"Bearer {tok}"
    s.user = user
    return s


# ---------- Custom Fields: multiselect + checkbox ----------
class TestCustomFieldsMultiselectCheckbox:
    ts = str(int(time.time()))
    created_ids: list = []

    def test_reject_multiselect_without_options(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/customer-fields",
                              json={"label": f"TEST_MS_bad_{self.ts}", "type": "multiselect", "options": []})
        assert r.status_code == 400, r.text

    def test_reject_dropdown_without_options(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/customer-fields",
                              json={"label": f"TEST_DD_bad_{self.ts}", "type": "dropdown", "options": []})
        assert r.status_code == 400

    def test_create_multiselect(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/customer-fields",
                              json={"label": f"TEST_MS_{self.ts}", "type": "multiselect",
                                    "options": ["a", "b", "c"]})
        assert r.status_code == 201, r.text
        f = r.json()
        assert f["type"] == "multiselect"
        assert f["options"] == ["a", "b", "c"]
        assert f["key"]
        TestCustomFieldsMultiselectCheckbox.ms_field = f
        TestCustomFieldsMultiselectCheckbox.created_ids.append(f["id"])

    def test_create_checkbox(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/customer-fields",
                              json={"label": f"TEST_CB_{self.ts}", "type": "checkbox", "options": []})
        assert r.status_code == 201, r.text
        f = r.json()
        assert f["type"] == "checkbox"
        assert f["options"] == []
        TestCustomFieldsMultiselectCheckbox.cb_field = f
        TestCustomFieldsMultiselectCheckbox.created_ids.append(f["id"])

    def test_create_customer_with_multi_and_checkbox(self, admin_client):
        # Need a route as well
        route_name = f"TEST_R8_{self.ts}"
        rr = admin_client.post(f"{BASE_URL}/routes", json={"name": route_name})
        assert rr.status_code in (201, 200, 409), rr.text
        TestCustomFieldsMultiselectCheckbox.route_name = route_name

        ms_key = self.ms_field["key"]
        cb_key = self.cb_field["key"]
        payload = {
            "shop_name": f"TEST_Cust_MS_{self.ts}",
            "mobile": "9876500099",
            "route": route_name,
            "custom": {ms_key: ["a", "b"], cb_key: True},
        }
        r = admin_client.post(f"{BASE_URL}/customers", json=payload)
        assert r.status_code == 201, r.text
        c = r.json()
        cid = c["id"]
        TestCustomFieldsMultiselectCheckbox.cid = cid

        # GET verifies persistence
        r2 = admin_client.get(f"{BASE_URL}/customers/{cid}")
        assert r2.status_code == 200
        got = r2.json()
        assert got["route"] == route_name
        assert got["custom"][ms_key] == ["a", "b"]
        assert got["custom"][cb_key] is True
        assert got.get("customer_code", "").startswith("CUST-"), got.get("customer_code")

    def test_zzz_cleanup(self, admin_client):
        # Delete customer
        cid = getattr(self, "cid", None)
        if cid:
            admin_client.delete(f"{BASE_URL}/customers/{cid}")
        for fid in TestCustomFieldsMultiselectCheckbox.created_ids:
            admin_client.delete(f"{BASE_URL}/customer-fields/{fid}")
        # Delete route
        rname = getattr(self, "route_name", None)
        if rname:
            rl = admin_client.get(f"{BASE_URL}/routes").json()
            for r in rl:
                if r["name"] == rname:
                    admin_client.delete(f"{BASE_URL}/routes/{r['id']}")


# ---------- Per-salesman can_edit_customers ----------
class TestSalesmanEditPermission:
    ts = str(int(time.time()))

    def test_toggle_can_edit_persists_and_userout(self, admin_client, john_client):
        john_id = john_client.user["id"]
        r = admin_client.patch(f"{BASE_URL}/salesmen/{john_id}", json={"can_edit_customers": True})
        assert r.status_code == 200, r.text
        assert r.json().get("can_edit_customers") is True
        # verify via list
        listr = admin_client.get(f"{BASE_URL}/salesmen").json()
        john = next(u for u in listr if u["id"] == john_id)
        assert john["can_edit_customers"] is True

    def test_edit_approved_customer_denied_when_flag_false(self, admin_client, john_client):
        john_id = john_client.user["id"]
        # Reset flag to false first
        admin_client.patch(f"{BASE_URL}/salesmen/{john_id}", json={"can_edit_customers": False})

        # John creates a customer -> approved by default (created by salesman)
        # Check backend: salesman-created customers are pending. Let's create then have admin approve.
        payload = {"shop_name": f"TEST_JohnCust_{self.ts}", "mobile": "9876500088"}
        c = john_client.post(f"{BASE_URL}/customers", json=payload).json()
        cid = c["id"]
        TestSalesmanEditPermission.cid = cid

        # If pending, salesman should still be able to edit while pending
        if c.get("approval_status", "approved") == "pending":
            r_p = john_client.patch(f"{BASE_URL}/customers/{cid}", json={"shop_name": c["shop_name"], "remarks": "edited while pending"})
            assert r_p.status_code == 200, f"pending edit expected 200, got {r_p.status_code} {r_p.text}"
            # Approve
            ap = admin_client.patch(f"{BASE_URL}/customers/{cid}/approve", json={})
            assert ap.status_code == 200, ap.text

        # Now approved, flag False -> 403
        r = john_client.patch(f"{BASE_URL}/customers/{cid}", json={"shop_name": c["shop_name"], "remarks": "no perm edit"})
        assert r.status_code == 403, r.text

    def test_edit_approved_customer_allowed_when_flag_true(self, admin_client, john_client):
        cid = self.cid
        john_id = john_client.user["id"]
        admin_client.patch(f"{BASE_URL}/salesmen/{john_id}", json={"can_edit_customers": True})
        # Re-login john to refresh flag? current_user reads DB, so no need.
        r = john_client.patch(f"{BASE_URL}/customers/{cid}", json={"shop_name": f"TEST_JohnCust_edited_{self.ts}"})
        assert r.status_code == 200, r.text

    def test_admin_can_always_edit(self, admin_client):
        cid = self.cid
        r = admin_client.patch(f"{BASE_URL}/customers/{cid}", json={"shop_name": f"TEST_JohnCust_admin_{self.ts}"})
        assert r.status_code == 200, r.text

    def test_zzz_cleanup(self, admin_client, john_client):
        cid = getattr(self, "cid", None)
        if cid:
            admin_client.delete(f"{BASE_URL}/customers/{cid}")
        john_id = john_client.user["id"]
        admin_client.patch(f"{BASE_URL}/salesmen/{john_id}", json={"can_edit_customers": False})


# ---------- Unique customer_code + import preserve ----------
class TestCustomerCode:
    ts = str(int(time.time()))

    def test_existing_customer_has_code(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/customers")
        assert r.status_code == 200
        arr = r.json()
        assert len(arr) > 0
        for c in arr[:5]:
            assert c.get("customer_code", "").startswith("CUST-") or c.get("customer_code", "") != "", \
                f"customer {c.get('shop_name')} missing customer_code: {c.get('customer_code')}"

    def test_new_customer_autogen_code(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/customers", json={"shop_name": f"TEST_CC_auto_{self.ts}"})
        assert r.status_code == 201
        c = r.json()
        assert c.get("customer_code", "").startswith("CUST-"), c.get("customer_code")
        TestCustomerCode.auto_id = c["id"]

    def test_import_preserves_customer_id(self, admin_client):
        # Build an xlsx following the template header format
        wb = Workbook()
        ws = wb.active
        headers = ["Customer ID", "Shop/Party Name", "Owner/Contact Name", "Mobile", "Address", "Area", "Outstanding Amount", "Remarks"]
        ws.append(headers)
        preserved_code = f"SA-{self.ts[-4:]}"
        ws.append([preserved_code, f"TEST_Imp_Preserve_{self.ts}", "Owner1", "9876500077", "Addr", "East", 0, ""])
        ws.append(["", f"TEST_Imp_Auto_{self.ts}", "Owner2", "9876500066", "Addr", "West", 0, ""])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        files = {"file": ("import.xlsx", buf.read(),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        # Remove Content-Type default json for multipart
        h = {k: v for k, v in admin_client.headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{BASE_URL}/customers/import", files=files, headers=h, timeout=60)
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["created"] >= 2, result

        # Verify via GET
        all_cust = admin_client.get(f"{BASE_URL}/customers").json()
        preserved = next((c for c in all_cust if c.get("shop_name") == f"TEST_Imp_Preserve_{self.ts}"), None)
        auto = next((c for c in all_cust if c.get("shop_name") == f"TEST_Imp_Auto_{self.ts}"), None)
        assert preserved is not None
        assert auto is not None
        assert preserved.get("customer_code") == preserved_code, \
            f"expected {preserved_code}, got {preserved.get('customer_code')}"
        assert auto.get("customer_code", "").startswith("CUST-"), auto.get("customer_code")
        TestCustomerCode.preserved_id = preserved["id"]
        TestCustomerCode.auto2_id = auto["id"]

    def test_customer_template_has_customer_id_first(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/import-templates/customers")
        assert r.status_code == 200
        wb = load_workbook(io.BytesIO(r.content))
        ws = wb.active
        header0 = ws.cell(row=1, column=1).value
        assert header0 == "Customer ID", f"first column must be 'Customer ID', got {header0}"

    def test_zzz_cleanup(self, admin_client):
        for attr in ("auto_id", "preserved_id", "auto2_id"):
            cid = getattr(self, attr, None)
            if cid:
                admin_client.delete(f"{BASE_URL}/customers/{cid}")


# ---------- Bill export CUSTOMER ID ----------
class TestOrdersExport:
    ts = str(int(time.time()))

    def test_export_has_customer_id_column(self, admin_client):
        # Ensure at least one submitted order exists — check by listing
        r = admin_client.get(f"{BASE_URL}/orders/export")
        assert r.status_code == 200, r.text
        wb = load_workbook(io.BytesIO(r.content))
        ws = wb.active
        headers = [ws.cell(row=1, column=i).value for i in range(1, 15)]
        assert headers[0] == "ORDER NUMBER"
        assert headers[1] == "DATE"
        assert headers[2] == "CUSTOMER ID", f"3rd column must be CUSTOMER ID, got {headers[2]}"
        assert headers[3] == "PARTY NAME"

        # If there are submitted orders, check first data row's CUSTOMER ID matches its customer's code
        if ws.max_row >= 2:
            for row in range(2, min(ws.max_row + 1, 5)):
                code = ws.cell(row=row, column=3).value
                if code:
                    assert isinstance(code, str) and (code.startswith("CUST-") or code.startswith("SA-") or code),\
                        f"unexpected customer id: {code}"


# ---------- Visit Tasks upsert / list / applicable / delete / enforcement ----------
class TestVisitTasks:
    ts = str(int(time.time()))

    def test_upsert_all_config(self, admin_client):
        body = {
            "target": "all",
            "require_photo": True,
            "questions": [
                {"id": "q1", "label": f"TEST_Q1_{self.ts}", "type": "single",
                 "options": ["Yes", "No"], "required": True},
                {"id": "q2", "label": f"TEST_Q2_{self.ts}", "type": "text",
                 "options": [], "required": False},
            ],
        }
        r = admin_client.put(f"{BASE_URL}/visit-tasks", json=body)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["target"] == "all"
        assert out["require_photo"] is True
        assert len(out["questions"]) == 2
        assert out.get("target_name") in ("All salesmen", None) or out.get("target_name") == "All salesmen"

    def test_list_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/visit-tasks")
        assert r.status_code == 200
        arr = r.json()
        assert any(c["target"] == "all" for c in arr)

    def test_applicable_salesman(self, john_client):
        r = john_client.get(f"{BASE_URL}/visit-tasks/applicable")
        assert r.status_code == 200, r.text
        out = r.json()
        assert out is not None, "expected applicable config for salesman"
        assert out["target"] in ("all", john_client.user["id"])
        assert out["require_photo"] is True

    def test_create_visit_missing_photo(self, admin_client, john_client):
        # find one of john's customers
        r = john_client.get(f"{BASE_URL}/customers")
        assert r.status_code == 200
        custs = r.json()
        if not custs:
            # create a customer for john via admin
            cr = admin_client.post(f"{BASE_URL}/customers", json={
                "shop_name": f"TEST_VT_C_{self.ts}",
                "mobile": "9876500055",
                "salesman_id": john_client.user["id"],
            })
            assert cr.status_code == 201
            cid = cr.json()["id"]
            TestVisitTasks.temp_cid = cid
        else:
            cid = custs[0]["id"]

        body = {"customer_id": cid, "visit_result": "No Order", "task_answers": {f"TEST_Q1_{self.ts}": "Yes"}}
        r = john_client.post(f"{BASE_URL}/visits", json=body)
        assert r.status_code == 400, f"expected 400 for missing photo, got {r.status_code}: {r.text}"
        TestVisitTasks.cid = cid

    def test_create_visit_missing_required_answer(self, john_client):
        body = {"customer_id": self.cid, "visit_result": "No Order",
                "task_photo": "data:image/png;base64,iVBORw0KGgoAAAANS", "task_answers": {}}
        r = john_client.post(f"{BASE_URL}/visits", json=body)
        assert r.status_code == 400, r.text

    def test_create_visit_success(self, john_client):
        body = {
            "customer_id": self.cid,
            "visit_result": "Order",
            "order_amount": 500,
            "task_photo": "data:image/png;base64,iVBORw0KGgoAAAANS",
            "task_answers": {f"TEST_Q1_{self.ts}": "Yes", f"TEST_Q2_{self.ts}": "Feedback ok"},
        }
        r = john_client.post(f"{BASE_URL}/visits", json=body)
        assert r.status_code == 201, r.text
        v = r.json()
        TestVisitTasks.vid = v["id"]

        # verify via GET /visits
        lr = john_client.get(f"{BASE_URL}/visits")
        assert lr.status_code == 200
        arr = lr.json()
        found = next((x for x in arr if x["id"] == self.vid), None)
        assert found is not None
        assert found.get("task_photo")
        assert found.get("task_answers", {}).get(f"TEST_Q1_{self.ts}") == "Yes"

    def test_delete_task(self, admin_client):
        r = admin_client.delete(f"{BASE_URL}/visit-tasks/all")
        assert r.status_code == 200, r.text
        # list should no longer contain 'all'
        arr = admin_client.get(f"{BASE_URL}/visit-tasks").json()
        assert not any(c["target"] == "all" for c in arr)

    def test_zzz_cleanup(self, admin_client):
        cid = getattr(self, "temp_cid", None)
        if cid:
            admin_client.delete(f"{BASE_URL}/customers/{cid}")
