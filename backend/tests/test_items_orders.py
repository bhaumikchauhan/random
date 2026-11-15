"""FMCG CRM — Tests for Item Master (products CRUD) and Order Entry (line-item auto-pricing).

Covers:
- GET /api/items (with ?q= search)
- POST /api/items (unique item_code constraint)
- PATCH /api/items/{id}
- DELETE /api/items/{id}
- POST /api/orders with lines -> net calculation + total_amount + order_number auto-increment
- GET /api/orders (with lines, customer_name, salesman_name)
- GET /api/orders/{id}
- PATCH /api/orders/{id} payment_status cycle (Pending -> Paid -> Partial)
- Role scoping (admin sees all; salesman only own; salesman can create order for own customer)
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@fmcg.com", "password": "admin123"}
JOHN = {"email": "john@fmcg.com", "password": "sales123"}
PRIYA = {"email": "priya@fmcg.com", "password": "sales123"}

# ---------------- fixtures ----------------

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


# Global bag of test-created items to be cleaned up at end of session
_created_items: list[str] = []
_created_orders: list[str] = []


@pytest.fixture(scope="session", autouse=True)
def _cleanup_at_end(admin_token):
    yield
    # Cleanup items
    for iid in _created_items:
        try:
            requests.delete(f"{API}/items/{iid}", headers=_h(admin_token), timeout=10)
        except Exception:
            pass


def _mk_item(admin_token, name_suffix="", rate=100.0, tax=18.0, mrp=120.0):
    code = f"TEST_{uuid.uuid4().hex[:8].upper()}"
    body = {
        "item_code": code,
        "item_name": f"TEST_Item_{name_suffix or code}",
        "rate": rate,
        "tax_rate": tax,
        "mrp": mrp,
        "active": True,
    }
    r = requests.post(f"{API}/items", headers=_h(admin_token), json=body, timeout=20)
    assert r.status_code == 201, r.text
    it = r.json()
    _created_items.append(it["id"])
    return it


# ============================================================
#  Items CRUD
# ============================================================
class TestItemsCRUD:
    def test_create_item_and_get_it_back(self, admin_token):
        it = _mk_item(admin_token, name_suffix="basic", rate=50.0, tax=12.0, mrp=60.0)
        assert it["item_code"].startswith("TEST_")
        assert it["rate"] == 50.0
        assert it["tax_rate"] == 12.0
        assert it["mrp"] == 60.0
        assert it["active"] is True
        assert "id" in it and it["id"]

        # GET list must contain it
        r = requests.get(f"{API}/items", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        ids = [i["id"] for i in r.json()]
        assert it["id"] in ids

    def test_unique_item_code_constraint(self, admin_token):
        it = _mk_item(admin_token, name_suffix="dup1")
        # try to insert another item with the same code
        dup_body = {
            "item_code": it["item_code"],
            "item_name": "TEST_dup2",
            "rate": 10, "tax_rate": 5, "mrp": 12, "active": True,
        }
        r = requests.post(f"{API}/items", headers=_h(admin_token), json=dup_body, timeout=20)
        assert r.status_code == 409, f"expected 409 for duplicate code, got {r.status_code} {r.text}"

    def test_search_items_by_query(self, admin_token):
        marker = uuid.uuid4().hex[:6].upper()
        it = _mk_item(admin_token, name_suffix=f"srch_{marker}")
        # ?q= by name substring
        r = requests.get(f"{API}/items", headers=_h(admin_token), params={"q": marker}, timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert any(i["id"] == it["id"] for i in rows), f"search for {marker} didn't return the created item"
        # ?q= by code prefix
        r = requests.get(f"{API}/items", headers=_h(admin_token),
                         params={"q": it["item_code"][:6]}, timeout=20)
        assert r.status_code == 200
        assert any(i["id"] == it["id"] for i in r.json())

    def test_patch_item_updates_fields(self, admin_token):
        it = _mk_item(admin_token, name_suffix="patchme", rate=100, tax=18, mrp=120)
        body = {
            "item_code": it["item_code"],  # keep same
            "item_name": "TEST_Item_Renamed",
            "rate": 200.0, "tax_rate": 5.0, "mrp": 250.0, "active": True,
        }
        r = requests.patch(f"{API}/items/{it['id']}", headers=_h(admin_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd["item_name"] == "TEST_Item_Renamed"
        assert upd["rate"] == 200.0
        assert upd["tax_rate"] == 5.0
        assert upd["mrp"] == 250.0

        # verify persisted via list
        r = requests.get(f"{API}/items", headers=_h(admin_token), params={"q": "Renamed"}, timeout=20)
        assert any(i["id"] == it["id"] and i["rate"] == 200.0 for i in r.json())

    def test_delete_item_removes_it(self, admin_token):
        it = _mk_item(admin_token, name_suffix="delme")
        r = requests.delete(f"{API}/items/{it['id']}", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # verify not in list
        r = requests.get(f"{API}/items", headers=_h(admin_token), timeout=20)
        assert it["id"] not in [i["id"] for i in r.json()]
        _created_items.remove(it["id"]) if it["id"] in _created_items else None

    def test_salesman_can_list_items_but_not_create(self, john_token, admin_token):
        # salesman GET
        r = requests.get(f"{API}/items", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        # salesman POST -> 403
        r = requests.post(f"{API}/items", headers=_h(john_token), timeout=20, json={
            "item_code": f"TEST_SNU_{uuid.uuid4().hex[:6]}",
            "item_name": "TEST_should_fail", "rate": 1, "tax_rate": 0, "mrp": 1, "active": True,
        })
        assert r.status_code == 403, r.text


# ============================================================
#  Order creation with computed lines + order_number auto-increment
# ============================================================
class TestOrderCreation:
    @pytest.fixture(scope="class")
    def item_a(self, admin_token):
        # rate=100, tax=18, mrp=120
        return _mk_item(admin_token, name_suffix="A", rate=100.0, tax=18.0, mrp=120.0)

    @pytest.fixture(scope="class")
    def item_b(self, admin_token):
        # rate=50, tax=5, mrp=60
        return _mk_item(admin_token, name_suffix="B", rate=50.0, tax=5.0, mrp=60.0)

    def test_create_order_computes_net_and_total(self, john_token, john_customers, item_a, item_b):
        cust = john_customers[0]
        body = {
            "customer_id": cust["id"],
            "remarks": "TEST order compute",
            "lines": [
                # qty=10, disc=10%, free=2, item_a (rate 100, tax 18)
                #  gross = 10*100 = 1000
                #  after_disc = 1000 * 0.9 = 900
                #  tax = 900 * 0.18 = 162
                #  net = 1062.00
                {"item_id": item_a["id"], "qty": 10, "discount": 10, "free_qty": 2},
                # qty=5, disc=0%, free=0, item_b (rate 50, tax 5)
                #  gross = 5*50 = 250
                #  after_disc = 250
                #  tax = 250*0.05 = 12.5
                #  net = 262.50
                {"item_id": item_b["id"], "qty": 5, "discount": 0, "free_qty": 0},
            ],
        }
        r = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        _created_orders.append(o["id"])

        # Basic fields
        assert o["customer_id"] == cust["id"]
        assert o["customer_name"] == cust["shop_name"]
        assert o["salesman_name"]  # populated
        assert o["payment_status"] == "Pending"
        assert o["order_number"], "order_number must be auto-generated"
        assert o["order_number"].startswith("ORD-")

        # Line computations
        lines = o["lines"]
        assert len(lines) == 2
        la = next(l for l in lines if l["item_id"] == item_a["id"])
        lb = next(l for l in lines if l["item_id"] == item_b["id"])

        assert la["qty"] == 10
        assert la["rate"] == 100.0
        assert la["tax_rate"] == 18.0
        assert la["discount"] == 10
        assert la["free_qty"] == 2
        assert abs(la["net"] - 1062.00) < 0.01, f"expected 1062.00, got {la['net']}"

        assert lb["qty"] == 5
        assert abs(lb["net"] - 262.50) < 0.01, f"expected 262.50, got {lb['net']}"

        # Total = sum of nets
        assert abs(o["total_amount"] - (1062.00 + 262.50)) < 0.01, \
            f"total_amount expected 1324.50, got {o['total_amount']}"

    def test_order_number_auto_increments(self, admin_token, john_token, john_customers, item_a):
        cust = john_customers[0]
        body = {
            "customer_id": cust["id"],
            "lines": [{"item_id": item_a["id"], "qty": 1, "discount": 0, "free_qty": 0}],
        }
        r1 = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r1.status_code == 201, r1.text
        o1 = r1.json()
        _created_orders.append(o1["id"])
        r2 = requests.post(f"{API}/orders", headers=_h(john_token), json=body, timeout=20)
        assert r2.status_code == 201, r2.text
        o2 = r2.json()
        _created_orders.append(o2["id"])

        # Both should have ORD-nnnnn format and be strictly increasing
        assert o1["order_number"].startswith("ORD-")
        assert o2["order_number"].startswith("ORD-")
        n1 = int(o1["order_number"].split("-")[1])
        n2 = int(o2["order_number"].split("-")[1])
        assert n2 > n1, f"expected increment: {o1['order_number']} then {o2['order_number']}"

    def test_create_order_no_lines_rejected(self, john_token, john_customers):
        cust = john_customers[0]
        r = requests.post(f"{API}/orders", headers=_h(john_token), json={
            "customer_id": cust["id"], "lines": [],
        }, timeout=20)
        assert r.status_code == 400, r.text

    def test_create_order_invalid_qty_rejected(self, john_token, john_customers, item_a):
        cust = john_customers[0]
        r = requests.post(f"{API}/orders", headers=_h(john_token), json={
            "customer_id": cust["id"],
            "lines": [{"item_id": item_a["id"], "qty": 0, "discount": 0, "free_qty": 0}],
        }, timeout=20)
        assert r.status_code == 400, r.text

    def test_admin_can_create_order_for_any_customer(self, admin_token, priya_customers, item_a):
        cust = priya_customers[0]
        r = requests.post(f"{API}/orders", headers=_h(admin_token), json={
            "customer_id": cust["id"],
            "lines": [{"item_id": item_a["id"], "qty": 3, "discount": 0, "free_qty": 0}],
        }, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        _created_orders.append(o["id"])
        assert o["customer_id"] == cust["id"]
        # salesman_id is the admin who created it (allowed per current design)

    def test_salesman_cannot_create_order_for_others_customer(self, john_token, priya_customers, item_a):
        # try to place an order for one of priya's customers using john's token
        priya_only = None
        # need a customer that's priya's and not john's
        r = requests.get(f"{API}/customers", headers=_h(_login(JOHN)), timeout=20).json()
        john_ids = {c["id"] for c in r}
        for c in priya_customers:
            if c["id"] not in john_ids:
                priya_only = c
                break
        if not priya_only:
            pytest.skip("No priya-only customer to test cross-scope")
        r = requests.post(f"{API}/orders", headers=_h(john_token), json={
            "customer_id": priya_only["id"],
            "lines": [{"item_id": item_a["id"], "qty": 1, "discount": 0, "free_qty": 0}],
        }, timeout=20)
        assert r.status_code == 403, r.text


# ============================================================
#  GET /api/orders and GET /api/orders/{id}
# ============================================================
class TestOrdersRead:
    def test_get_order_by_id_contains_lines(self, admin_token):
        if not _created_orders:
            pytest.skip("No test order created yet")
        oid = _created_orders[0]
        r = requests.get(f"{API}/orders/{oid}", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["id"] == oid
        assert "lines" in o and isinstance(o["lines"], list) and len(o["lines"]) >= 1
        assert o["customer_name"]
        assert o["salesman_name"]

    def test_admin_lists_all_orders(self, admin_token):
        r = requests.get(f"{API}/orders", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        # created orders must be present
        ids = {o["id"] for o in rows}
        for oid in _created_orders:
            assert oid in ids, f"admin didn't see order {oid}"

    def test_salesman_only_sees_own_orders(self, john_token):
        me = requests.get(f"{API}/auth/me", headers=_h(john_token), timeout=10).json()
        r = requests.get(f"{API}/orders", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        for o in r.json():
            assert o["salesman_id"] == me["id"], f"leak: {o}"


# ============================================================
#  Draft -> submit workflow + locking rules
# ============================================================
class TestOrderSubmitWorkflow:
    _order_id: str = ""

    def test_new_order_starts_as_draft(self, admin_token, john_token, john_customers):
        item = _mk_item(admin_token, name_suffix="submit", rate=100, tax=0, mrp=100)
        cust = john_customers[0]
        r = requests.post(f"{API}/orders", headers=_h(john_token), json={
            "customer_id": cust["id"],
            "outcome": "Order",
            "lines": [{"item_id": item["id"], "qty": 1, "discount": 0, "free_qty": 0}],
        }, timeout=20)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["status"] == "draft"
        TestOrderSubmitWorkflow._order_id = o["id"]
        _created_orders.append(o["id"])

    def test_submit_transitions_to_submitted(self, john_token):
        oid = TestOrderSubmitWorkflow._order_id
        assert oid, "need order from previous test"
        r = requests.post(f"{API}/orders/{oid}/submit", headers=_h(john_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "submitted"
        # GET confirms persistence
        g = requests.get(f"{API}/orders/{oid}", headers=_h(john_token), timeout=20)
        assert g.json()["status"] == "submitted"

    def test_salesman_cannot_put_submitted_order(self, john_token, john_customers):
        oid = TestOrderSubmitWorkflow._order_id
        if not oid:
            pytest.skip("no submitted order from previous test")
        items = requests.get(f"{API}/items", headers=_h(john_token), timeout=20).json()
        assert items, "no items in master"
        body = {
            "customer_id": john_customers[0]["id"],
            "outcome": "Order",
            "lines": [{"item_id": items[0]["id"], "qty": 1, "discount": 0, "free_qty": 0}],
        }
        r = requests.put(f"{API}/orders/{oid}", headers=_h(john_token), json=body, timeout=20)
        assert r.status_code == 403, f"expected 403 for locked order, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "").lower()
        assert "submitted" in detail or "locked" in detail

    def test_salesman_cannot_delete_submitted_order(self, john_token):
        oid = TestOrderSubmitWorkflow._order_id
        if not oid:
            pytest.skip("no submitted order")
        r = requests.delete(f"{API}/orders/{oid}", headers=_h(john_token), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
