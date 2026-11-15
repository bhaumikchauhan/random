"""FMCG CRM — Iteration 4 tests for the 4 NEW capabilities:
1) Customer Approval workflow (pending/approved, admin approve, salesman edit rules)
2) Geo-fence Check-In (flag when far from territory centroid)
3) Salesman geofence_radius_km persistence + PATCH
4) Attendance Export (XLSX, admin only)

Also spot-checks approval scoping (list filter, salesman-cannot-approve).
"""
import io
import os
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
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
def john_id(john_token):
    return requests.get(f"{API}/auth/me", headers=_h(john_token), timeout=10).json()["id"]


# ==================== Approval workflow ====================
class TestApprovalWorkflow:
    _created_ids: list = []

    @classmethod
    def teardown_class(cls):
        # Best effort admin cleanup of any test customers still around
        try:
            tok = _login(ADMIN)
            for cid in cls._created_ids:
                requests.delete(f"{API}/customers/{cid}", headers=_h(tok), timeout=10)
        except Exception:
            pass

    def test_salesman_create_is_pending(self, john_token):
        body = {
            "shop_name": "TEST_iter4_pending_shop",
            "owner_name": "TEST Owner",
            "mobile": "9990000001",
            "area": "TEST",
            "customer_type": "Retailer",
            "outstanding": 0,
        }
        r = requests.post(f"{API}/customers", headers=_h(john_token), timeout=20, json=body)
        assert r.status_code == 201, r.text
        c = r.json()
        assert c["approval_status"] == "pending", f"expected pending, got {c.get('approval_status')}"
        assert c["shop_name"] == body["shop_name"]
        TestApprovalWorkflow._created_ids.append(c["id"])

        # GET verify persistence
        g = requests.get(f"{API}/customers/{c['id']}", headers=_h(john_token), timeout=10)
        assert g.status_code == 200
        assert g.json()["approval_status"] == "pending"

    def test_admin_create_is_auto_approved(self, admin_token, john_id):
        body = {
            "shop_name": "TEST_iter4_admin_shop",
            "owner_name": "TEST Admin-Created",
            "mobile": "9990000002",
            "area": "TEST",
            "customer_type": "Retailer",
            "outstanding": 0,
            "salesman_id": john_id,
        }
        r = requests.post(f"{API}/customers", headers=_h(admin_token), timeout=20, json=body)
        assert r.status_code == 201, r.text
        c = r.json()
        assert c["approval_status"] == "approved"
        TestApprovalWorkflow._created_ids.append(c["id"])

    def test_salesman_can_edit_own_pending(self, john_token):
        assert TestApprovalWorkflow._created_ids, "need pending customer from earlier test"
        cid = TestApprovalWorkflow._created_ids[0]
        upd = {
            "shop_name": "TEST_iter4_pending_shop_EDIT",
            "owner_name": "TEST Owner Edited",
            "mobile": "9990000001",
            "area": "TEST",
            "customer_type": "Retailer",
            "outstanding": 0,
        }
        r = requests.patch(f"{API}/customers/{cid}", headers=_h(john_token), timeout=20, json=upd)
        assert r.status_code == 200, r.text
        assert r.json()["shop_name"] == "TEST_iter4_pending_shop_EDIT"
        assert r.json()["approval_status"] == "pending"

    def test_salesman_cannot_approve(self, john_token):
        assert TestApprovalWorkflow._created_ids
        cid = TestApprovalWorkflow._created_ids[0]
        r = requests.patch(f"{API}/customers/{cid}/approve", headers=_h(john_token), timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_admin_can_approve(self, admin_token):
        assert TestApprovalWorkflow._created_ids
        cid = TestApprovalWorkflow._created_ids[0]
        r = requests.patch(f"{API}/customers/{cid}/approve", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["approval_status"] == "approved"
        # GET verify
        g = requests.get(f"{API}/customers/{cid}", headers=_h(admin_token), timeout=10)
        assert g.json()["approval_status"] == "approved"

    def test_salesman_edit_locked_after_approval(self, john_token):
        cid = TestApprovalWorkflow._created_ids[0]
        upd = {
            "shop_name": "TEST_iter4_should_fail",
            "mobile": "9990000001",
            "area": "TEST",
            "customer_type": "Retailer",
            "outstanding": 0,
        }
        r = requests.patch(f"{API}/customers/{cid}", headers=_h(john_token), timeout=10, json=upd)
        assert r.status_code == 403, f"expected 403 lock, got {r.status_code} {r.text}"
        msg = (r.json().get("detail") or "").lower()
        assert "approved" in msg and "lock" in msg, f"unexpected lock message: {msg}"

    def test_admin_can_edit_approved(self, admin_token):
        cid = TestApprovalWorkflow._created_ids[0]
        upd = {
            "shop_name": "TEST_iter4_admin_edit",
            "mobile": "9990000001",
            "area": "TEST",
            "customer_type": "Retailer",
            "outstanding": 0,
        }
        r = requests.patch(f"{API}/customers/{cid}", headers=_h(admin_token), timeout=10, json=upd)
        assert r.status_code == 200, r.text
        assert r.json()["shop_name"] == "TEST_iter4_admin_edit"

    def test_list_filter_pending_vs_approved(self, admin_token, john_token):
        # Create a fresh pending customer via John so the pending list is non-empty
        body = {
            "shop_name": "TEST_iter4_pending_filter",
            "owner_name": "TEST",
            "mobile": "9990000009",
            "area": "TEST",
            "customer_type": "Retailer",
            "outstanding": 0,
        }
        r = requests.post(f"{API}/customers", headers=_h(john_token), timeout=15, json=body)
        assert r.status_code == 201
        pending_id = r.json()["id"]
        TestApprovalWorkflow._created_ids.append(pending_id)

        r = requests.get(f"{API}/customers?approval=pending", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        pending_list = r.json()
        assert any(c["id"] == pending_id for c in pending_list), "pending list missing new pending"
        assert all(c["approval_status"] == "pending" for c in pending_list), "non-pending in pending list"

        r = requests.get(f"{API}/customers?approval=approved", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        approved_list = r.json()
        assert all(c["approval_status"] != "pending" for c in approved_list), "pending leaked into approved"
        # The pending one must NOT be in approved
        assert not any(c["id"] == pending_id for c in approved_list)

    def test_salesman_scoping_sees_only_own(self, john_token, priya_token):
        john_ids = {c["id"] for c in requests.get(f"{API}/customers", headers=_h(john_token), timeout=10).json()}
        priya_ids = {c["id"] for c in requests.get(f"{API}/customers", headers=_h(priya_token), timeout=10).json()}
        assert john_ids.isdisjoint(priya_ids), "salesman customer scoping leak"


# ==================== Salesman geofence_radius_km ====================
class TestSalesmanGeofenceRadius:
    _created_id: str = ""

    @classmethod
    def teardown_class(cls):
        # No DELETE /api/salesmen endpoint exists — leave as-is (email prefixed TEST_)
        pass

    def test_create_with_radius_persists(self, admin_token):
        ts = datetime.now().strftime("%H%M%S")
        body = {
            "email": f"TEST_iter4_geo_{ts}@fmcg.com",
            "password": "sales123",
            "name": "TEST GeoRadius User",
            "mobile": "9998887777",
            "area": "TEST",
            "geofence_radius_km": 25,
        }
        r = requests.post(f"{API}/salesmen", headers=_h(admin_token), timeout=15, json=body)
        assert r.status_code in (200, 201), r.text
        u = r.json()
        assert u.get("geofence_radius_km") == 25
        TestSalesmanGeofenceRadius._created_id = u["id"]

        # GET /api/salesmen returns it
        listing = requests.get(f"{API}/salesmen", headers=_h(admin_token), timeout=10).json()
        found = next((x for x in listing if x["id"] == u["id"]), None)
        assert found and found.get("geofence_radius_km") == 25

    def test_patch_radius(self, admin_token):
        sid = TestSalesmanGeofenceRadius._created_id
        assert sid, "created id missing"
        r = requests.patch(f"{API}/salesmen/{sid}", headers=_h(admin_token), timeout=10,
                           json={"geofence_radius_km": 7})
        assert r.status_code == 200, r.text
        assert r.json().get("geofence_radius_km") == 7


# ==================== Geo-fence check-in ====================
class TestGeoFenceCheckIn:
    """Uses Priya (South) who — per seed — has customers ~ Mumbai area.
    We first verify her territory centroid works by check-in near it (no flag),
    then reset today's attendance and check-in far away (flag).
    """

    def _reset_today(self, admin_uri_hint=None, salesman_email="priya@fmcg.com"):
        # No admin delete endpoint for attendance; we rely on Mongo directly via a helper endpoint if any.
        # Since none exists, we do the FLAG test first (single check-in), then reset via test-only:
        # Instead, we run the two cases on different salesmen (Priya=far, John=near) to avoid the
        # "already checked in today" 400.
        pass

    def test_near_center_not_flagged(self, priya_token, priya_customers_fixture):
        # Use centroid of Priya customers
        cs = [c for c in priya_customers_fixture if c.get("gps_lat") and c.get("gps_lng")]
        if not cs:
            pytest.skip("Priya has no GPS customers")
        lat = sum(c["gps_lat"] for c in cs) / len(cs)
        lng = sum(c["gps_lng"] for c in cs) / len(cs)

        # Was Priya already checked in today (iter3 tests may have done so)?
        today = requests.get(f"{API}/attendance/today", headers=_h(priya_token), timeout=10).json()
        if today.get("checked_in"):
            rec = today.get("record") or {}
            # if already checked in, we can only inspect what was stored
            assert rec.get("check_in_flagged") in (False, True)
            # If it's flagged, we can't verify near-center behaviour on this test run
            if rec.get("check_in_flagged"):
                pytest.skip("Priya already flagged-checked-in today; can't retest near-center")
            assert rec["check_in_flagged"] is False
            assert isinstance(rec.get("check_in_distance_km"), (int, float))
            return

        r = requests.post(f"{API}/attendance/check-in", headers=_h(priya_token), timeout=15,
                          json={"lat": lat, "lng": lng, "photo": "TEST_iter4_near.jpg"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("check_in_flagged") is False
        assert isinstance(body.get("check_in_distance_km"), (int, float))
        # Warning should be None when not flagged
        assert body.get("warning") in (None, "")

    def test_far_from_center_flagged(self, admin_token, john_id):
        """Use a fresh, disposable salesman with same territory (assign customers via admin)
        so we don't clobber Priya/John's real today records. Simpler approach:
        create a new salesman, assign a small radius, add ONE customer w/ GPS at Mumbai,
        then check-in from Delhi and expect flagged.
        """
        ts = datetime.now().strftime("%H%M%S")
        # 1. create the salesman
        s_body = {
            "email": f"TEST_iter4_geoflag_{ts}@fmcg.com",
            "password": "pw123456",
            "name": "TEST GeoFlag User",
            "mobile": "9998880000",
            "area": "TEST",
            "geofence_radius_km": 10,
        }
        rs = requests.post(f"{API}/salesmen", headers=_h(admin_token), timeout=15, json=s_body)
        assert rs.status_code in (200, 201), rs.text
        sid = rs.json()["id"]

        # 2. create a customer for that salesman at Mumbai (admin creates -> assigned, approved)
        c_body = {
            "shop_name": f"TEST_iter4_geo_c_{ts}",
            "owner_name": "TEST",
            "mobile": "9990000099",
            "area": "TEST",
            "customer_type": "Retailer",
            "outstanding": 0,
            "salesman_id": sid,
            "gps_lat": 19.076,
            "gps_lng": 72.877,
        }
        rc = requests.post(f"{API}/customers", headers=_h(admin_token), timeout=15, json=c_body)
        assert rc.status_code == 201, rc.text
        cid = rc.json()["id"]

        # 3. login as new salesman and check-in from Delhi (~1150 km away)
        tok = _login({"email": s_body["email"], "password": "pw123456"})
        r = requests.post(f"{API}/attendance/check-in", headers=_h(tok), timeout=15,
                          json={"lat": 28.6139, "lng": 77.2090, "photo": "TEST_iter4_far.jpg"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("check_in_flagged") is True, f"expected flagged, got {body}"
        assert isinstance(body.get("check_in_distance_km"), (int, float))
        assert body["check_in_distance_km"] > 10
        assert isinstance(body.get("warning"), str) and body["warning"], "warning string missing"
        assert "km" in body["warning"].lower()

        # cleanup: delete the test customer (admin)
        requests.delete(f"{API}/customers/{cid}", headers=_h(admin_token), timeout=10)


@pytest.fixture(scope="session")
def priya_customers_fixture(priya_token):
    return requests.get(f"{API}/customers", headers=_h(priya_token), timeout=10).json()


# ==================== Attendance export ====================
class TestAttendanceExport:
    def test_admin_export_current_month(self, admin_token):
        r = requests.get(f"{API}/attendance/export", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ), f"unexpected content-type: {r.headers.get('content-type')}"
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower() and "filename" in cd.lower(), f"bad CD: {cd}"
        # XLSX magic bytes = PK\x03\x04 (zip)
        assert r.content[:2] == b"PK", "not a valid XLSX (missing PK zip header)"

        # Try to open with openpyxl to double-check
        try:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(r.content))
            assert "Daily" in wb.sheetnames
            assert "Summary" in wb.sheetnames
        except ImportError:
            pass  # openpyxl not installed here — magic bytes already asserted

    def test_admin_export_with_month_param(self, admin_token):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{API}/attendance/export?month={month}", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    def test_salesman_forbidden(self, john_token):
        r = requests.get(f"{API}/attendance/export", headers=_h(john_token), timeout=15)
        assert r.status_code == 403, f"expected 403 salesman, got {r.status_code}"
