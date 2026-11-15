"""FMCG CRM — Tests for previously uncovered API surface.

Covers:
- Full order lifecycle: PUT (update draft), POST submit, DELETE
- No-Order / Follow-up outcomes on POST /orders
- Visit-task enforcement on POST /orders (not just POST /visits)
- Customer rejection with reason + filter visibility
- Customer bulk-import: CSV format, update mode, salesman 403
- Customer list ?area= and ?salesman_id= filters
- GET /customers-outstanding salesman scoping
- GET /visits ?customer_id= filter
- GET /locations ?date= filter + invalid date 400
"""
import io
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@fmcg.com", "password": "admin123"}
JOHN = {"email": "john@fmcg.com", "password": "sales123"}
PRIYA = {"email": "priya@fmcg.com", "password": "sales123"}


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


@pytest.fixture(scope="session")
def priya_token():
    return _login(PRIYA)


@pytest.fixture(scope="session")
def john_customers(john_token):
    r = requests.get(f"{API}/customers", headers=_h(john_token), timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def priya_customers(priya_token):
    r = requests.get(f"{API}/customers", headers=_h(priya_token), timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def any_item(admin_token):
    """Return one active seeded item from the product master."""
    r = requests.get(f"{API}/items", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    items = r.json()
    assert items, "No items in master — seed data required"
    return items[0]


# ================================================================
# Order lifecycle: PUT (update draft), submit, DELETE, locking
# ================================================================
class TestOrderLifecycle:
    _order_id: str = ""
    _cust_id: str = ""

    def test_create_draft_order(self, john_token, john_customers, any_item):
        cust = john_customers[0]
        TestOrderLifecycle._cust_id = cust["id"]
        body = {
            "customer_id": cust["id"],
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 2, "discount": 0, "free_qty": 0}],
            "remarks": "TEST lifecycle initial",
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["status"] == "draft"
        assert o["order_number"].startswith("ORD-")
        TestOrderLifecycle._order_id = o["id"]

    def test_put_updates_draft_order(self, john_token, any_item):
        oid = TestOrderLifecycle._order_id
        cid = TestOrderLifecycle._cust_id
        assert oid, "need order from previous test"
        body = {
            "customer_id": cid,
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 5, "discount": 10, "free_qty": 1}],
            "remarks": "TEST lifecycle updated",
        }
        r = requests.put(f"{API}/orders/{oid}", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["remarks"] == "TEST lifecycle updated"
        assert o["lines"][0]["qty"] == 5
        assert o["lines"][0]["discount"] == 10
        assert o["status"] == "draft"

    def test_submit_locks_order(self, john_token):
        oid = TestOrderLifecycle._order_id
        assert oid
        r = requests.post(f"{API}/orders/{oid}/submit", headers=_h(john_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "submitted"
        g = requests.get(f"{API}/orders/{oid}", headers=_h(john_token), timeout=20)
        assert g.json()["status"] == "submitted"

    def test_salesman_cannot_put_submitted_order(self, john_token, any_item):
        oid = TestOrderLifecycle._order_id
        cid = TestOrderLifecycle._cust_id
        body = {
            "customer_id": cid,
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 1, "discount": 0, "free_qty": 0}],
        }
        r = requests.put(f"{API}/orders/{oid}", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "").lower()
        assert "submitted" in detail or "locked" in detail

    def test_admin_can_put_submitted_order(self, admin_token, any_item):
        oid = TestOrderLifecycle._order_id
        cid = TestOrderLifecycle._cust_id
        body = {
            "customer_id": cid,
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 1, "discount": 0, "free_qty": 0}],
            "remarks": "admin override",
        }
        r = requests.put(f"{API}/orders/{oid}", headers=_h(admin_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["remarks"] == "admin override"

    def test_salesman_cannot_delete_submitted_order(self, john_token):
        oid = TestOrderLifecycle._order_id
        r = requests.delete(f"{API}/orders/{oid}", headers=_h(john_token), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_admin_deletes_order(self, admin_token):
        oid = TestOrderLifecycle._order_id
        r = requests.delete(f"{API}/orders/{oid}", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        assert r.json().get("ok") is True
        g = requests.get(f"{API}/orders/{oid}", headers=_h(admin_token), timeout=20)
        assert g.status_code == 404


# ================================================================
# No-Order and Follow-up outcomes on POST /orders
# ================================================================
class TestNoOrderOutcome:
    _cleanup_ids: list = []

    def test_create_no_order_outcome(self, john_token, john_customers):
        cust = john_customers[0]
        body = {
            "customer_id": cust["id"],
            "outcome": "No Order",
            "lines": [],
            "no_order_reason": "Out of stock",
            "no_order_note": "Will retry next week",
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["outcome"] == "No Order"
        assert o["no_order_reason"] == "Out of stock"
        assert o["no_order_note"] == "Will retry next week"
        assert o["total_amount"] == 0
        TestNoOrderOutcome._cleanup_ids.append(o["id"])

    def test_create_followup_outcome_stores_next_followup(self, john_token, john_customers):
        cust = john_customers[0]
        followup = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        body = {
            "customer_id": cust["id"],
            "outcome": "Follow-up",
            "lines": [],
            "next_followup": followup,
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["outcome"] == "Follow-up"
        assert o["next_followup"] is not None
        TestNoOrderOutcome._cleanup_ids.append(o["id"])

    def test_no_order_reason_cleared_on_order_outcome(self, john_token, john_customers, any_item):
        """no_order_reason must be null when outcome is Order."""
        cust = john_customers[0]
        body = {
            "customer_id": cust["id"],
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 1, "discount": 0, "free_qty": 0}],
            "no_order_reason": "should be cleared",
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o.get("no_order_reason") is None
        TestNoOrderOutcome._cleanup_ids.append(o["id"])

    @classmethod
    def teardown_class(cls):
        try:
            tok = _login(ADMIN)
            for oid in cls._cleanup_ids:
                requests.delete(f"{API}/orders/{oid}", headers=_h(tok), timeout=10)
        except Exception:
            pass


# ================================================================
# Visit-task enforcement applies to POST /orders (not just visits)
# ================================================================
class TestVisitTaskEnforcementOnOrders:
    ts = uuid.uuid4().hex[:6]
    _test_order_id: str = ""

    @classmethod
    def setup_class(cls):
        tok = _login(ADMIN)
        body = {
            "target": "all",
            "require_photo": True,
            "questions": [
                {"id": "q1", "label": f"TEST_OrdTask_{cls.ts}", "type": "text",
                 "options": [], "required": True},
            ],
        }
        r = requests.put(f"{API}/visit-tasks", headers=_h(tok), json=body, timeout=20)
        assert r.status_code == 200, f"visit-task setup failed: {r.text}"

    @classmethod
    def teardown_class(cls):
        tok = _login(ADMIN)
        requests.delete(f"{API}/visit-tasks/all", headers=_h(tok), timeout=10)
        if cls._test_order_id:
            requests.delete(f"{API}/orders/{cls._test_order_id}", headers=_h(tok), timeout=10)

    def test_order_missing_photo_rejected(self, john_token, john_customers, any_item):
        cust = john_customers[0]
        body = {
            "customer_id": cust["id"],
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 1, "discount": 0, "free_qty": 0}],
            "task_answers": {f"TEST_OrdTask_{self.ts}": "Some answer"},
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 400, f"expected 400 for missing photo, got {r.status_code}: {r.text}"
        assert "photo" in r.json().get("detail", "").lower()

    def test_order_missing_required_answer_rejected(self, john_token, john_customers, any_item):
        cust = john_customers[0]
        body = {
            "customer_id": cust["id"],
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 1, "discount": 0, "free_qty": 0}],
            "task_photo": "data:image/png;base64,iVBORw0KGgoAAAANS",
            "task_answers": {},
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 400, f"expected 400 for missing answer, got {r.status_code}: {r.text}"

    def test_order_with_all_required_fields_succeeds(self, john_token, john_customers, any_item):
        cust = john_customers[0]
        body = {
            "customer_id": cust["id"],
            "outcome": "Order",
            "lines": [{"item_id": any_item["id"], "qty": 1, "discount": 0, "free_qty": 0}],
            "task_photo": "data:image/png;base64,iVBORw0KGgoAAAANS",
            "task_answers": {f"TEST_OrdTask_{self.ts}": "Yes"},
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["task_photo"]
        assert o["task_answers"].get(f"TEST_OrdTask_{self.ts}") == "Yes"
        TestVisitTaskEnforcementOnOrders._test_order_id = o["id"]


# ================================================================
# Customer rejection with reason
# ================================================================
class TestCustomerRejection:
    _cid: str = ""

    def test_salesman_creates_pending_customer(self, john_token):
        ts = uuid.uuid4().hex[:6]
        body = {"shop_name": f"TEST_Reject_{ts}", "mobile": f"888{ts[:7]}"}
        r = requests.post(f"{API}/customers", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 201
        c = r.json()
        assert c["approval_status"] == "pending"
        TestCustomerRejection._cid = c["id"]

    def test_admin_rejects_with_reason(self, admin_token):
        cid = TestCustomerRejection._cid
        assert cid
        r = requests.patch(f"{API}/customers/{cid}/reject",
                           headers=_h(admin_token),
                           json={"reason": "Duplicate shop"},
                           timeout=20)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["approval_status"] == "rejected"
        assert c["rejection_reason"] == "Duplicate shop"

    def test_rejected_absent_from_default_list(self, admin_token):
        cid = TestCustomerRejection._cid
        r = requests.get(f"{API}/customers", headers=_h(admin_token), timeout=20)
        ids = [c["id"] for c in r.json()]
        assert cid not in ids, "rejected customer leaked into default customer list"

    def test_rejected_visible_via_approval_filter(self, admin_token):
        cid = TestCustomerRejection._cid
        r = requests.get(f"{API}/customers", headers=_h(admin_token),
                         params={"approval": "rejected"}, timeout=20)
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()]
        assert cid in ids, "rejected customer not found with ?approval=rejected"

    def test_reject_without_reason_uses_default(self, admin_token, john_token):
        ts = uuid.uuid4().hex[:6]
        cr = requests.post(f"{API}/customers", headers=_h(john_token),
                           json={"shop_name": f"TEST_RejectNoReason_{ts}"}, timeout=20)
        assert cr.status_code == 201
        cid2 = cr.json()["id"]
        r = requests.patch(f"{API}/customers/{cid2}/reject",
                           headers=_h(admin_token), json={}, timeout=20)
        assert r.status_code == 200
        c = r.json()
        assert c["approval_status"] == "rejected"
        assert c["rejection_reason"]  # server fills "Not specified" when empty
        # cleanup
        requests.delete(f"{API}/customers/{cid2}", headers=_h(admin_token), timeout=10)

    @classmethod
    def teardown_class(cls):
        try:
            tok = _login(ADMIN)
            if cls._cid:
                requests.delete(f"{API}/customers/{cls._cid}", headers=_h(tok), timeout=10)
        except Exception:
            pass


# ================================================================
# Customer import — CSV format, update mode, salesman 403
# ================================================================
class TestCustomerImportExtended:
    ts = uuid.uuid4().hex[:6]
    _created_mobiles: list = []

    def _csv_bytes(self, rows):
        lines = ["Shop/Party Name,Owner/Contact Name,Mobile,Address,Area,Outstanding Amount,Remarks"]
        for row in rows:
            lines.append(",".join(str(x) for x in row))
        return "\n".join(lines).encode("utf-8")

    def test_csv_import_creates_customers(self, admin_token):
        mobile = f"7770{self.ts}"
        csv = self._csv_bytes([
            [f"TEST_CSV_{self.ts}", "CSV Owner", mobile, "Some Addr", "East", 1000, "CSV test"],
        ])
        r = requests.post(
            f"{API}/customers/import",
            headers=_h(admin_token),
            files={"file": ("customers.csv", csv, "text/csv")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["created"] >= 1, result
        TestCustomerImportExtended._created_mobiles.append(mobile)

    def test_csv_import_skip_on_duplicate_mobile(self, admin_token):
        mobile = TestCustomerImportExtended._created_mobiles[0]
        csv = self._csv_bytes([
            [f"TEST_CSV_dup_{self.ts}", "Dup Owner", mobile, "Addr", "East", 500, "dup"],
        ])
        r = requests.post(
            f"{API}/customers/import?duplicate_mode=skip",
            headers=_h(admin_token),
            files={"file": ("customers.csv", csv, "text/csv")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["skipped"] >= 1
        assert result["created"] == 0

    def test_csv_import_update_on_duplicate_mobile(self, admin_token):
        mobile = TestCustomerImportExtended._created_mobiles[0]
        updated_name = f"TEST_CSV_updated_{self.ts}"
        csv = self._csv_bytes([
            [updated_name, "Updated Owner", mobile, "New Addr", "West", 2000, "updated"],
        ])
        r = requests.post(
            f"{API}/customers/import?duplicate_mode=update",
            headers=_h(admin_token),
            files={"file": ("customers.csv", csv, "text/csv")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["updated"] >= 1
        all_custs = requests.get(f"{API}/customers", headers=_h(admin_token), timeout=20).json()
        updated = next((c for c in all_custs if c.get("mobile") == mobile), None)
        assert updated is not None, "updated customer not found"
        assert updated["shop_name"] == updated_name

    def test_salesman_cannot_import_customers(self, john_token):
        csv = self._csv_bytes([["TEST_SalesmanImport", "Owner", "7771111111", "Addr", "North", 0, ""]])
        r = requests.post(
            f"{API}/customers/import",
            headers=_h(john_token),
            files={"file": ("customers.csv", csv, "text/csv")},
            timeout=20,
        )
        assert r.status_code == 403, r.text

    @classmethod
    def teardown_class(cls):
        try:
            tok = _login(ADMIN)
            all_custs = requests.get(f"{API}/customers", headers=_h(tok), timeout=20).json()
            for c in all_custs:
                if c.get("mobile") in cls._created_mobiles:
                    requests.delete(f"{API}/customers/{c['id']}", headers=_h(tok), timeout=10)
        except Exception:
            pass


# ================================================================
# Customer list filters: ?area= and ?salesman_id=
# ================================================================
class TestCustomerListFilters:
    _cid: str = ""
    ts = uuid.uuid4().hex[:6]

    def test_filter_by_area(self, admin_token):
        area_tag = f"TESTZONE_{self.ts}"
        mobile = f"6660{self.ts}"
        r = requests.post(f"{API}/customers", headers=_h(admin_token), json={
            "shop_name": f"TEST_Area_{self.ts}",
            "mobile": mobile,
            "area": area_tag,
        }, timeout=20)
        assert r.status_code == 201
        cid = r.json()["id"]
        TestCustomerListFilters._cid = cid

        result = requests.get(f"{API}/customers",
                              headers=_h(admin_token),
                              params={"area": area_tag},
                              timeout=20).json()
        assert any(c["id"] == cid for c in result), "customer not in area-filtered list"
        assert all(c.get("area") == area_tag for c in result), "wrong area leaked into results"

        # Different area should NOT include this customer
        noise = requests.get(f"{API}/customers",
                             headers=_h(admin_token),
                             params={"area": "NonExistentZone99"},
                             timeout=20).json()
        assert not any(c["id"] == cid for c in noise)

    def test_filter_by_salesman_id(self, admin_token, john_token):
        me_john = requests.get(f"{API}/auth/me", headers=_h(john_token), timeout=10).json()
        john_id = me_john["id"]
        result = requests.get(f"{API}/customers",
                              headers=_h(admin_token),
                              params={"salesman_id": john_id},
                              timeout=20).json()
        assert len(result) >= 1, "expected at least one customer for John"
        for c in result:
            assert c["salesman_id"] == john_id, f"customer {c['id']} has wrong salesman_id"

    @classmethod
    def teardown_class(cls):
        try:
            tok = _login(ADMIN)
            if cls._cid:
                requests.delete(f"{API}/customers/{cls._cid}", headers=_h(tok), timeout=10)
        except Exception:
            pass


# ================================================================
# GET /customers-outstanding — salesman sees only own customers
# ================================================================
class TestOutstandingScoping:
    def test_salesman_only_sees_own_outstanding(self, john_token):
        me = requests.get(f"{API}/auth/me", headers=_h(john_token), timeout=10).json()
        r = requests.get(f"{API}/customers-outstanding", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        for c in r.json():
            assert c["outstanding"] > 0, "outstanding filter not applied"
            assert c["salesman_id"] == me["id"], \
                f"customer {c['id']} belongs to wrong salesman ({c['salesman_id']} != {me['id']})"


# ================================================================
# GET /visits — filter by customer_id
# ================================================================
class TestVisitCustomerFilter:
    def test_filter_by_customer_id_returns_only_that_customer(self, john_token, john_customers):
        cust = john_customers[0]
        cid = cust["id"]
        # Ensure at least one visit exists for this customer
        requests.post(f"{API}/visits", headers=_h(john_token), json={
            "customer_id": cid,
            "visit_result": "No Order",
            "remarks": "TEST_cid_filter",
        }, timeout=20)
        r = requests.get(f"{API}/visits", headers=_h(john_token),
                         params={"customer_id": cid}, timeout=20)
        assert r.status_code == 200
        visits = r.json()
        assert len(visits) >= 1, "expected at least one visit for the filtered customer"
        for v in visits:
            assert v["customer_id"] == cid, \
                f"visit {v['id']} for wrong customer ({v['customer_id']} != {cid})"


# ================================================================
# GET /locations — filter by date
# ================================================================
class TestLocationDateFilter:
    def test_date_filter_returns_only_today(self, john_token):
        # Post a fresh ping so the filtered result is non-empty
        requests.post(f"{API}/locations", headers=_h(john_token),
                      json={"lat": 19.076, "lng": 72.877, "accuracy": 15}, timeout=20)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.get(f"{API}/locations", headers=_h(john_token),
                         params={"date": today}, timeout=20)
        assert r.status_code == 200
        locs = r.json()
        assert isinstance(locs, list) and len(locs) >= 1
        for loc in locs:
            assert today in loc["timestamp"], \
                f"location timestamp {loc['timestamp']} does not fall on {today}"

    def test_invalid_date_returns_400(self, john_token):
        r = requests.get(f"{API}/locations", headers=_h(john_token),
                         params={"date": "not-a-date"}, timeout=20)
        assert r.status_code == 400
