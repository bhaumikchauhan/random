"""FMCG CRM iter-7 tests:
- Routes master (list/create/delete + admin RBAC + duplicate 409)
- Custom customer-fields (list/create/delete + type/options validation)
- Customer create with route + custom{} persists and returns
- Item import (CSV, skip vs update by item_code)
- Import templates (customers + items) return xlsx
- Customer list filters: route + customer_type
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@fmcg.com", "password": "admin123"}
JOHN = {"email": "john@fmcg.com", "password": "sales123"}

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def john_token():
    return _login(JOHN)


# --------- Routes master ---------
class TestRoutes:
    def test_seeded_five_routes(self, admin_token):
        r = requests.get(f"{API}/routes", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        rows = r.json()
        names = {x["name"] for x in rows}
        for n in ["North", "South", "East", "West", "Central"]:
            assert n in names, f"missing seeded route {n}: got {names}"
        for x in rows:
            assert "id" in x and "name" in x

    def test_salesman_can_list_routes(self, john_token):
        r = requests.get(f"{API}/routes", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_salesman_cannot_create_route(self, john_token):
        r = requests.post(f"{API}/routes", headers=_h(john_token),
                          json={"name": f"TEST_{uuid.uuid4().hex[:6]}"}, timeout=20)
        assert r.status_code == 403, r.text

    def test_admin_create_list_delete(self, admin_token):
        name = f"TEST_R_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/routes", headers=_h(admin_token), json={"name": name}, timeout=20)
        assert r.status_code == 201, r.text
        rid = r.json()["id"]
        assert r.json()["name"] == name

        # duplicate (case-insensitive)
        r2 = requests.post(f"{API}/routes", headers=_h(admin_token),
                           json={"name": name.lower()}, timeout=20)
        assert r2.status_code == 409, r2.text

        # list contains it
        rows = requests.get(f"{API}/routes", headers=_h(admin_token), timeout=20).json()
        assert any(x["id"] == rid for x in rows)

        # delete
        d = requests.delete(f"{API}/routes/{rid}", headers=_h(admin_token), timeout=20)
        assert d.status_code == 200
        rows2 = requests.get(f"{API}/routes", headers=_h(admin_token), timeout=20).json()
        assert not any(x["id"] == rid for x in rows2)


# --------- Custom fields ---------
class TestCustomFields:
    def test_type_validation(self, admin_token):
        r = requests.post(f"{API}/customer-fields", headers=_h(admin_token),
                          json={"label": "Bad", "type": "boolean", "options": []}, timeout=20)
        assert r.status_code == 400, r.text

    def test_dropdown_requires_options(self, admin_token):
        r = requests.post(f"{API}/customer-fields", headers=_h(admin_token),
                          json={"label": "TEST DropNoOpt", "type": "dropdown", "options": []},
                          timeout=20)
        assert r.status_code == 400, r.text

    def test_salesman_cannot_create(self, john_token):
        r = requests.post(f"{API}/customer-fields", headers=_h(john_token),
                          json={"label": "TEST X", "type": "text", "options": []}, timeout=20)
        assert r.status_code == 403

    def test_create_text_and_dropdown_list_delete(self, admin_token):
        suf = uuid.uuid4().hex[:5]
        r1 = requests.post(f"{API}/customer-fields", headers=_h(admin_token),
                           json={"label": f"TEST Shop Size {suf}", "type": "text", "options": []},
                           timeout=20)
        assert r1.status_code == 201, r1.text
        f1 = r1.json()
        assert f1["type"] == "text"
        assert f1["key"]  # slug generated

        r2 = requests.post(f"{API}/customer-fields", headers=_h(admin_token),
                           json={"label": f"TEST Grade {suf}", "type": "dropdown",
                                 "options": ["A", "B", " C ", ""]}, timeout=20)
        assert r2.status_code == 201, r2.text
        f2 = r2.json()
        assert f2["type"] == "dropdown"
        assert f2["options"] == ["A", "B", "C"]  # trimmed + empty dropped

        lst = requests.get(f"{API}/customer-fields", headers=_h(admin_token), timeout=20).json()
        assert any(x["id"] == f1["id"] for x in lst)
        assert any(x["id"] == f2["id"] for x in lst)

        # salesman can also list
        # cleanup
        for fid in (f1["id"], f2["id"]):
            d = requests.delete(f"{API}/customer-fields/{fid}", headers=_h(admin_token), timeout=20)
            assert d.status_code == 200


# --------- Customer create with route + custom + list filters ---------
class TestCustomerWithRouteAndCustom:
    def test_create_persists_route_and_custom(self, admin_token):
        # Ensure at least one custom field exists to persist against
        suf = uuid.uuid4().hex[:5]
        cf = requests.post(f"{API}/customer-fields", headers=_h(admin_token),
                           json={"label": f"TEST Notes {suf}", "type": "text", "options": []},
                           timeout=20).json()
        key = cf["key"]

        mobile = f"9990{uuid.uuid4().int % 1000000:06d}"
        body = {
            "shop_name": f"TEST_Route_Shop_{suf}",
            "owner_name": "Route Owner",
            "mobile": mobile,
            "customer_type": "Retailer",
            "customer_status": "Active",
            "route": "North",
            "custom": {key: "value-abc"},
        }
        r = requests.post(f"{API}/customers", headers=_h(admin_token), json=body, timeout=20)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        assert r.json()["route"] == "North"
        assert r.json()["custom"] == {key: "value-abc"}

        # GET verifies persistence
        g = requests.get(f"{API}/customers/{cid}", headers=_h(admin_token), timeout=20).json()
        assert g["route"] == "North"
        assert g["custom"][key] == "value-abc"

        # Filters: route
        f_route = requests.get(f"{API}/customers?route=North", headers=_h(admin_token),
                               timeout=20).json()
        assert any(c["id"] == cid for c in f_route)
        assert all(c.get("route") == "North" for c in f_route)

        # Filters: customer_type
        f_type = requests.get(f"{API}/customers?customer_type=Retailer",
                              headers=_h(admin_token), timeout=20).json()
        assert any(c["id"] == cid for c in f_type)
        assert all(c.get("customer_type") == "Retailer" for c in f_type)

        # Combined
        f_both = requests.get(f"{API}/customers?route=North&customer_type=Retailer",
                              headers=_h(admin_token), timeout=20).json()
        assert any(c["id"] == cid for c in f_both)

        # Filters exclude the wrong route
        f_south = requests.get(f"{API}/customers?route=South", headers=_h(admin_token),
                               timeout=20).json()
        assert not any(c["id"] == cid for c in f_south)

        # cleanup: delete customer + custom field
        requests.delete(f"{API}/customers/{cid}", headers=_h(admin_token), timeout=20)
        requests.delete(f"{API}/customer-fields/{cf['id']}", headers=_h(admin_token), timeout=20)


# --------- Import templates ---------
class TestImportTemplates:
    def _check_xlsx_headers(self, content: bytes, expected_headers: list):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content))
        ws = wb.active
        actual = [c.value for c in ws[1]]
        assert actual == expected_headers, f"headers mismatch: {actual} vs {expected_headers}"

    def test_customers_template(self, admin_token):
        r = requests.get(f"{API}/import-templates/customers", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert XLSX_MIME in r.headers.get("content-type", "")
        self._check_xlsx_headers(
            r.content,
            ["Customer ID", "Shop/Party Name", "Owner/Contact Name", "Mobile", "Address", "Area",
             "Outstanding Amount", "Remarks"],
        )

    def test_items_template(self, admin_token):
        r = requests.get(f"{API}/import-templates/items", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert XLSX_MIME in r.headers.get("content-type", "")
        self._check_xlsx_headers(
            r.content, ["Item Code", "Item Name", "Rate", "Tax Rate", "MRP"]
        )

    def test_salesman_forbidden_on_template(self, john_token):
        r = requests.get(f"{API}/import-templates/items", headers=_h(john_token), timeout=20)
        assert r.status_code == 403


# --------- Item import ---------
class TestItemImport:
    def _csv(self, rows):
        buf = io.StringIO()
        buf.write("Item Code,Item Name,Rate,Tax Rate,MRP\n")
        for r in rows:
            buf.write(",".join(str(x) for x in r) + "\n")
        return buf.getvalue().encode("utf-8")

    def test_create_then_skip_then_update(self, admin_token):
        suf = uuid.uuid4().hex[:5].upper()
        codes = [f"TEST{suf}A", f"TEST{suf}B", f"TEST{suf}C"]
        csv1 = self._csv([
            [codes[0], "TEST Item A", 100, 5, 120],
            [codes[1], "TEST Item B", 200, 5, 240],
            [codes[2], "TEST Item C", 300, 12, 360],
        ])

        # First import (skip) - all new
        r = requests.post(
            f"{API}/items/import?duplicate_mode=skip",
            headers=_h(admin_token),
            files={"file": ("items.csv", csv1, "text/csv")}, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_rows"] == 3
        assert body["created"] == 3
        assert body["updated"] == 0
        assert body["skipped"] == 0

        # Re-upload same in skip mode -> all skipped
        r2 = requests.post(
            f"{API}/items/import?duplicate_mode=skip",
            headers=_h(admin_token),
            files={"file": ("items.csv", csv1, "text/csv")}, timeout=30,
        )
        b2 = r2.json()
        assert r2.status_code == 200
        assert b2["created"] == 0
        assert b2["updated"] == 0
        assert b2["skipped"] == 3

        # Re-upload with updated rates in update mode
        csv2 = self._csv([
            [codes[0], "TEST Item A", 111, 5, 121],
            [codes[1], "TEST Item B", 222, 5, 241],
            [codes[2], "TEST Item C", 333, 12, 361],
        ])
        r3 = requests.post(
            f"{API}/items/import?duplicate_mode=update",
            headers=_h(admin_token),
            files={"file": ("items.csv", csv2, "text/csv")}, timeout=30,
        )
        b3 = r3.json()
        assert r3.status_code == 200
        assert b3["updated"] == 3
        assert b3["created"] == 0
        assert b3["skipped"] == 0

        # verify persistence via /api/items
        items = requests.get(f"{API}/items", headers=_h(admin_token), timeout=20).json()
        by_code = {i["item_code"]: i for i in items}
        assert by_code[codes[0]]["rate"] == 111
        assert by_code[codes[1]]["mrp"] == 241
        assert by_code[codes[2]]["tax_rate"] == 12

        # cleanup
        for c in codes:
            it = by_code.get(c)
            if it:
                requests.delete(f"{API}/items/{it['id']}", headers=_h(admin_token), timeout=20)

    def test_salesman_cannot_import_items(self, john_token):
        csv = b"Item Code,Item Name,Rate,Tax Rate,MRP\nSAL1,SalesmanItem,10,5,12\n"
        r = requests.post(
            f"{API}/items/import?duplicate_mode=skip",
            headers=_h(john_token),
            files={"file": ("items.csv", csv, "text/csv")}, timeout=20,
        )
        assert r.status_code == 403
