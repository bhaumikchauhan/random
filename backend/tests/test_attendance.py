"""
Tests for the NEW Attendance feature (FMCG CRM).
Endpoints under test:
- GET  /api/attendance/today
- POST /api/attendance/check-in
- POST /api/attendance/check-out
- GET  /api/attendance         (admin sees all, salesman only self)
- GET  /api/attendance/summary (admin only)
"""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read from frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

ADMIN = {"email": "admin@fmcg.com", "password": "admin123"}
JOHN = {"email": "john@fmcg.com", "password": "sales123"}     # already checked in AND out
PRIYA = {"email": "priya@fmcg.com", "password": "sales123"}   # not marked


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token"), j.get("user")


@pytest.fixture(scope="module")
def admin_token():
    tok, _ = _login(ADMIN)
    return tok


@pytest.fixture(scope="module")
def john_token():
    tok, _ = _login(JOHN)
    return tok


@pytest.fixture(scope="module")
def priya_token():
    tok, _ = _login(PRIYA)
    return tok


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- /api/attendance/today ---------------------------------------------------
class TestAttendanceToday:
    def test_john_today_shows_full_shift(self, john_token):
        r = requests.get(f"{BASE_URL}/api/attendance/today", headers=H(john_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert set(j.keys()) >= {"date", "checked_in", "checked_out", "record"}
        assert j["checked_in"] is True, f"John should already be checked in today: {j}"
        assert j["checked_out"] is True, f"John should already be checked out today: {j}"
        rec = j["record"]
        assert rec is not None
        assert rec.get("check_in_time")
        assert rec.get("check_out_time")
        assert rec.get("total_hours") is not None

    def test_priya_today_initially_not_marked(self, priya_token):
        r = requests.get(f"{BASE_URL}/api/attendance/today", headers=H(priya_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        # Priya may have been marked by a previous run of this test suite; if so,
        # the check-in tests below will detect that as "Already checked in today".
        assert "checked_in" in j
        assert "checked_out" in j
        assert j["date"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")


# --- /api/attendance/check-in ------------------------------------------------
class TestCheckIn:
    def test_second_checkin_returns_400_for_john(self, john_token):
        # John is already checked in; a second check-in must be rejected.
        body = {"lat": 12.9, "lng": 77.6, "photo": "test/selfie.jpg"}
        r = requests.post(f"{BASE_URL}/api/attendance/check-in", headers=H(john_token), json=body, timeout=15)
        assert r.status_code == 400, f"Expected 400 for duplicate check-in, got {r.status_code}: {r.text}"
        assert "Already checked in" in r.text or "already" in r.text.lower()

    def test_priya_fresh_checkin_flow(self, priya_token):
        # If already checked in from a prior test-run, skip the fresh-flow assertion.
        pre = requests.get(f"{BASE_URL}/api/attendance/today", headers=H(priya_token), timeout=15).json()
        body = {"lat": 12.9716, "lng": 77.5946, "photo": "TEST_selfie_in.jpg"}
        r = requests.post(f"{BASE_URL}/api/attendance/check-in", headers=H(priya_token), json=body, timeout=15)

        if pre.get("checked_in"):
            assert r.status_code == 400, f"Expected 400 duplicate, got {r.status_code}"
            pytest.skip("Priya was already checked in from earlier run; duplicate 400 confirmed.")
        assert r.status_code == 200, f"check-in failed: {r.status_code} {r.text}"
        rec = r.json()
        assert rec["check_in_time"] is not None
        assert rec["check_in_lat"] == 12.9716
        assert rec["check_in_lng"] == 77.5946
        assert rec["check_in_photo"] == "TEST_selfie_in.jpg"
        assert rec.get("check_out_time") in (None, "")

        # GET verify persistence
        today = requests.get(f"{BASE_URL}/api/attendance/today", headers=H(priya_token), timeout=15).json()
        assert today["checked_in"] is True
        assert today["checked_out"] is False
        assert today["record"]["check_in_photo"] == "TEST_selfie_in.jpg"

    def test_priya_duplicate_checkin_after_flow(self, priya_token):
        body = {"lat": 12.9, "lng": 77.6, "photo": "TEST_selfie_in2.jpg"}
        r = requests.post(f"{BASE_URL}/api/attendance/check-in", headers=H(priya_token), json=body, timeout=15)
        assert r.status_code == 400
        assert "already" in r.text.lower()


# --- /api/attendance/check-out -----------------------------------------------
class TestCheckOut:
    def test_second_checkout_for_john_returns_400(self, john_token):
        body = {"lat": 12.9, "lng": 77.6, "photo": "TEST_selfie_out.jpg"}
        r = requests.post(f"{BASE_URL}/api/attendance/check-out", headers=H(john_token), json=body, timeout=15)
        assert r.status_code == 400, f"Expected 400 for duplicate check-out, got {r.status_code}: {r.text}"

    def test_priya_checkout_success_and_total_hours(self, priya_token):
        # Priya must be checked in from the prior test class.
        today = requests.get(f"{BASE_URL}/api/attendance/today", headers=H(priya_token), timeout=15).json()
        if not today.get("checked_in"):
            pytest.skip("Priya not checked in; cannot test check-out.")
        if today.get("checked_out"):
            # verify duplicate returns 400
            r = requests.post(f"{BASE_URL}/api/attendance/check-out", headers=H(priya_token),
                              json={"photo": "x"}, timeout=15)
            assert r.status_code == 400
            return

        body = {"lat": 12.9720, "lng": 77.5950, "photo": "TEST_selfie_out.jpg"}
        r = requests.post(f"{BASE_URL}/api/attendance/check-out", headers=H(priya_token), json=body, timeout=15)
        assert r.status_code == 200, f"check-out failed: {r.status_code} {r.text}"
        rec = r.json()
        assert rec.get("check_out_time") is not None
        assert rec.get("check_out_photo") == "TEST_selfie_out.jpg"
        assert rec.get("total_hours") is not None
        assert isinstance(rec["total_hours"], (int, float))
        assert rec["total_hours"] >= 0

    def test_checkout_without_checkin_returns_400(self, admin_token):
        # We create a brand-new salesman and immediately try check-out (no check-in).
        # If admin cannot create users on this env, we skip.
        payload = {
            "email": f"TEST_att_{int(datetime.now().timestamp())}@fmcg.com",
            "password": "pw123456",
            "name": "TEST Attendance User",
            "area": "TEST",
        }
        cr = requests.post(f"{BASE_URL}/api/salesmen", headers=H(admin_token), json=payload, timeout=15)
        if cr.status_code not in (200, 201):
            pytest.skip(f"Cannot create test salesman for negative check-out ({cr.status_code}).")

        # login as new user
        login = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": payload["email"], "password": payload["password"]}, timeout=15)
        assert login.status_code == 200, login.text
        lj = login.json()
        new_tok = lj.get("access_token") or lj.get("token")

        r = requests.post(f"{BASE_URL}/api/attendance/check-out",
                          headers=H(new_tok), json={"photo": "x"}, timeout=15)
        assert r.status_code == 400, f"Expected 400 for check-out without check-in, got {r.status_code}: {r.text}"


# --- /api/attendance (list) --------------------------------------------------
class TestAttendanceList:
    def test_admin_sees_all_salesmen(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/attendance", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "date" in j and "rows" in j
        assert isinstance(j["rows"], list) and len(j["rows"]) >= 2

        # Should include both John and Priya
        names = [r.get("salesman_name") for r in j["rows"]]
        assert any("John" in (n or "") for n in names), names
        assert any("Priya" in (n or "") for n in names), names

        # Every row must have required keys
        for row in j["rows"]:
            assert set(row.keys()) >= {"salesman_id", "salesman_name", "present", "record"}
            assert isinstance(row["present"], bool)

        # John must be present today
        john_row = next(r for r in j["rows"] if "John" in (r.get("salesman_name") or ""))
        assert john_row["present"] is True
        assert john_row["record"]["check_in_time"]
        assert john_row["record"]["check_out_time"]

    def test_salesman_sees_only_self(self, john_token, priya_token):
        for tok, expected_name in [(john_token, "John"), (priya_token, "Priya")]:
            r = requests.get(f"{BASE_URL}/api/attendance", headers=H(tok), timeout=15)
            assert r.status_code == 200, r.text
            j = r.json()
            assert len(j["rows"]) == 1, f"Salesman should see only self, got {len(j['rows'])} rows"
            assert expected_name in (j["rows"][0].get("salesman_name") or "")


# --- /api/attendance/summary -------------------------------------------------
class TestAttendanceSummary:
    def test_admin_gets_monthly_summary(self, admin_token):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{BASE_URL}/api/attendance/summary?month={month}",
                         headers=H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["month"] == month
        assert isinstance(j["rows"], list) and len(j["rows"]) >= 2
        for row in j["rows"]:
            assert set(row.keys()) >= {"salesman_id", "salesman_name", "days_present", "total_hours"}
            assert isinstance(row["days_present"], int)
            assert isinstance(row["total_hours"], (int, float))
            assert row["days_present"] >= 0
            assert row["total_hours"] >= 0

        # John should have ≥1 day and ≥0 hours (completed shift today)
        john = next(r for r in j["rows"] if "John" in (r.get("salesman_name") or ""))
        assert john["days_present"] >= 1

    def test_summary_defaults_to_current_month(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/attendance/summary", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["month"] == datetime.now(timezone.utc).strftime("%Y-%m")

    def test_salesman_forbidden_from_summary(self, john_token):
        r = requests.get(f"{BASE_URL}/api/attendance/summary", headers=H(john_token), timeout=15)
        assert r.status_code == 403, f"Expected 403 for salesman on summary, got {r.status_code}: {r.text}"
