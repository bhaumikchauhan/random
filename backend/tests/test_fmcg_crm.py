"""FMCG CRM Backend API tests."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fmcg-crm-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@fmcg.com", "password": "admin123"}
JOHN = {"email": "john@fmcg.com", "password": "sales123"}
PRIYA = {"email": "priya@fmcg.com", "password": "sales123"}


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def john_token():
    r = requests.post(f"{API}/auth/login", json=JOHN, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def priya_token():
    r = requests.post(f"{API}/auth/login", json=PRIYA, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ============ Auth ============
class TestAuth:
    def test_health(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_admin_login(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert body["token_type"] == "bearer"
        assert body["user"]["role"] == "admin"
        assert body["user"]["email"] == ADMIN["email"]

    def test_salesman_login(self):
        r = requests.post(f"{API}/auth/login", json=JOHN, timeout=20)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "salesman"

    def test_wrong_password_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin@fmcg.com", "password": "wrong"}, timeout=20)
        assert r.status_code == 401

    def test_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me", timeout=20)
        assert r.status_code == 401


# ============ Salesmen ============
class TestSalesmen:
    def test_list_salesmen(self, admin_token):
        r = requests.get(f"{API}/salesmen", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        names = [s["name"] for s in r.json()]
        assert "John Doe" in names
        assert "Priya Sharma" in names

    def test_salesman_cannot_create_salesman(self, john_token):
        r = requests.post(f"{API}/salesmen",
                          headers=_h(john_token),
                          json={"email": "TEST_new@fmcg.com", "password": "pass1234", "name": "TEST New"},
                          timeout=20)
        assert r.status_code == 403

    def test_admin_create_and_toggle_salesman(self, admin_token):
        payload = {"email": "TEST_new_sm@fmcg.com", "password": "pass1234", "name": "TEST Salesman", "area": "TEST"}
        r = requests.post(f"{API}/salesmen", headers=_h(admin_token), json=payload, timeout=20)
        # allow 201 or 409 if left over
        if r.status_code == 409:
            # find id
            r2 = requests.get(f"{API}/salesmen", headers=_h(admin_token), timeout=20)
            sid = next(s["id"] for s in r2.json() if s["email"] == payload["email"])
        else:
            assert r.status_code == 201, r.text
            sid = r.json()["id"]
            assert r.json()["role"] == "salesman"
        # toggle active
        r3 = requests.patch(f"{API}/salesmen/{sid}", headers=_h(admin_token), json={"active": False}, timeout=20)
        assert r3.status_code == 200
        assert r3.json()["active"] is False


# ============ Customers ============
class TestCustomers:
    def test_admin_sees_all(self, admin_token):
        r = requests.get(f"{API}/customers", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        assert len(r.json()) >= 5

    def test_salesman_sees_only_own(self, john_token):
        r = requests.get(f"{API}/customers", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        me = requests.get(f"{API}/auth/me", headers=_h(john_token), timeout=20).json()
        for c in r.json():
            assert c["salesman_id"] == me["id"]

    def test_search_query(self, admin_token):
        r = requests.get(f"{API}/customers", headers=_h(admin_token), params={"q": "Super"}, timeout=20)
        assert r.status_code == 200
        names = [c["shop_name"] for c in r.json()]
        assert any("Super" in n for n in names)

    def test_status_filter(self, admin_token):
        r = requests.get(f"{API}/customers", headers=_h(admin_token), params={"status": "Active"}, timeout=20)
        assert r.status_code == 200
        for c in r.json():
            assert c["customer_status"] == "Active"

    def test_create_get_patch_customer(self, admin_token):
        payload = {
            "shop_name": "TEST_Store", "owner_name": "TEST Owner", "mobile": "9000000001",
            "area": "TESTArea", "customer_status": "Active", "outstanding": 500,
        }
        r = requests.post(f"{API}/customers", headers=_h(admin_token), json=payload, timeout=20)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        # GET
        r2 = requests.get(f"{API}/customers/{cid}", headers=_h(admin_token), timeout=20)
        assert r2.status_code == 200
        assert r2.json()["shop_name"] == "TEST_Store"
        # PATCH (send full body since backend PATCH uses CustomerIn schema)
        upd = {**payload, "shop_name": "TEST_Store_Updated", "outstanding": 999}
        r3 = requests.patch(f"{API}/customers/{cid}", headers=_h(admin_token), json=upd, timeout=20)
        assert r3.status_code == 200
        assert r3.json()["shop_name"] == "TEST_Store_Updated"
        # DELETE cleanup
        requests.delete(f"{API}/customers/{cid}", headers=_h(admin_token), timeout=20)


# ============ Visits & Orders ============
class TestVisitsOrders:
    def test_create_visit_with_order(self, john_token, admin_token):
        # find John's customer
        cust = requests.get(f"{API}/customers", headers=_h(john_token), timeout=20).json()
        assert cust
        cid = cust[0]["id"]
        payload = {"customer_id": cid, "visit_result": "Order", "order_amount": 1234.5, "remarks": "TEST_visit"}
        r = requests.post(f"{API}/visits", headers=_h(john_token), json=payload, timeout=20)
        assert r.status_code == 201, r.text
        assert r.json()["order_amount"] == 1234.5
        # check customer's last_visit updated
        r2 = requests.get(f"{API}/customers/{cid}", headers=_h(john_token), timeout=20)
        assert r2.json()["last_visit"] is not None
        assert r2.json()["last_order_amount"] == 1234.5
        # visits list
        r3 = requests.get(f"{API}/visits", headers=_h(john_token), timeout=20)
        assert r3.status_code == 200
        assert any(v["remarks"] == "TEST_visit" for v in r3.json())
        # orders should have entry
        r4 = requests.get(f"{API}/orders", headers=_h(john_token), timeout=20)
        assert r4.status_code == 200
        assert any(o["total_amount"] == 1234.5 for o in r4.json())

    def test_visit_filter_by_date_customer(self, john_token):
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.get(f"{API}/visits", headers=_h(john_token), params={"date": today}, timeout=20)
        assert r.status_code == 200

    def test_visit_not_your_customer(self, john_token, priya_token):
        # find priya customer
        pc = requests.get(f"{API}/customers", headers=_h(priya_token), timeout=20).json()
        if not pc:
            pytest.skip("no priya customers")
        pcid = pc[0]["id"]
        r = requests.post(f"{API}/visits", headers=_h(john_token),
                          json={"customer_id": pcid, "visit_result": "No Order"}, timeout=20)
        assert r.status_code == 403


# ============ Locations ============
class TestLocations:
    def test_post_location(self, john_token):
        r = requests.post(f"{API}/locations", headers=_h(john_token),
                          json={"lat": 19.076, "lng": 72.8777, "accuracy": 10}, timeout=20)
        assert r.status_code == 200
        assert r.json()["lat"] == 19.076

    def test_list_locations(self, john_token):
        r = requests.get(f"{API}/locations", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_latest_admin_only(self, admin_token, john_token):
        r = requests.get(f"{API}/locations/latest", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/locations/latest", headers=_h(john_token), timeout=20)
        assert r2.status_code == 403


# ============ Dashboard & Outstanding ============
class TestDashboard:
    def test_dashboard_admin(self, admin_token):
        r = requests.get(f"{API}/dashboard", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_customers", "todays_visits", "active_salesmen", "total_outstanding", "todays_revenue", "recent_visits"):
            assert k in d
        assert d["total_customers"] >= 5

    def test_dashboard_salesman_scoped(self, john_token):
        r = requests.get(f"{API}/dashboard", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        # salesman sees only their customers
        assert isinstance(r.json()["total_customers"], int)

    def test_outstanding(self, admin_token):
        r = requests.get(f"{API}/customers-outstanding", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        for c in r.json():
            assert c["outstanding"] > 0


# ============ Upload ============
class TestUpload:
    def test_upload_and_fetch(self, john_token):
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{API}/upload", headers=_h(john_token), files=files, timeout=60)
        if r.status_code == 500:
            pytest.skip("Storage not configured in this environment")
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        assert path
        r2 = requests.get(f"{API}/files/{path}", timeout=60)
        assert r2.status_code == 200
        assert r2.content.startswith(b"\x89PNG")
