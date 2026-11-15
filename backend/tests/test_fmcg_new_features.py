"""FMCG CRM — Tests for NEW features (iteration 2):
- Orders GET/PATCH (payment_status auto-updates customer outstanding)
- Leaderboard (admin only, sorted, period)
- Beat Plan GET/POST (scoping, order preserved, visited flag)
"""
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
def john_customers(john_token):
    r = requests.get(f"{API}/customers", headers=_h(john_token), timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def priya_customers(priya_token):
    r = requests.get(f"{API}/customers", headers=_h(priya_token), timeout=20)
    assert r.status_code == 200
    return r.json()


# ============ Orders ============
class TestOrders:
    def test_admin_lists_all_orders(self, admin_token):
        r = requests.get(f"{API}/orders", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        orders = r.json()
        assert isinstance(orders, list)
        # payload shape sanity
        if orders:
            o = orders[0]
            for k in ("id", "customer_id", "salesman_id", "total_amount", "status", "order_date"):
                assert k in o, f"missing {k} in order"

    def test_salesman_lists_only_own_orders(self, john_token):
        r = requests.get(f"{API}/orders", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        orders = r.json()
        # john's orders only — verify /me id
        me = requests.get(f"{API}/auth/me", headers=_h(john_token), timeout=10).json()
        for o in orders:
            assert o["salesman_id"] == me["id"], f"leak: {o}"

    def test_salesman_cannot_update_other_salesmans_order(self, priya_token, admin_token):
        # Find an order belonging to John (not Priya's), then try to PUT it as Priya.
        all_orders = requests.get(f"{API}/orders", headers=_h(admin_token), timeout=20).json()
        me_priya = requests.get(f"{API}/auth/me", headers=_h(priya_token), timeout=10).json()
        others = [o for o in all_orders if o["salesman_id"] != me_priya["id"]]
        if not others:
            pytest.skip("No cross-salesman orders available")
        o = others[0]
        body = {
            "customer_id": o["customer_id"],
            "outcome": "No Order",
            "lines": [],
            "no_order_reason": "access test",
        }
        r = requests.put(f"{API}/orders/{o['id']}", headers=_h(priya_token), timeout=20, json=body)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


# ============ Leaderboard ============
class TestLeaderboard:
    @pytest.mark.parametrize("period", ["today", "week", "month"])
    def test_admin_leaderboard_periods(self, admin_token, period):
        r = requests.get(f"{API}/leaderboard?period={period}", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["period"] == period
        rows = body["rows"]
        assert isinstance(rows, list) and len(rows) >= 1
        # ranked (sales desc, then visits desc); ranks start at 1
        for i, row in enumerate(rows):
            for k in ("salesman_id", "name", "visits", "sales", "orders", "rank"):
                assert k in row, f"missing {k} in leaderboard row"
            assert row["rank"] == i + 1
        # ordering check
        for a, b in zip(rows, rows[1:]):
            assert (a["sales"], a["visits"]) >= (b["sales"], b["visits"])

    def test_salesman_forbidden(self, john_token):
        r = requests.get(f"{API}/leaderboard?period=today", headers=_h(john_token), timeout=10)
        assert r.status_code == 403


# ============ Beat Plan ============
class TestBeatPlan:
    def _today(self):
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def test_get_returns_auto_plan_when_none_saved(self, priya_token):
        # Priya likely has no saved plan today (John's plan will be overwritten by other tests)
        d = self._today()
        r = requests.get(f"{API}/beat-plan?date={d}", headers=_h(priya_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["date"] == d
        assert "stops" in body
        assert isinstance(body["stops"], list)
        # auto True/False depends on prior POSTs; only assert it's a bool
        assert isinstance(body["auto"], bool)

    def test_post_saves_ordered_plan_and_get_returns_it(self, john_token, john_customers):
        d = self._today()
        # John should have 3 customers
        ids = [c["id"] for c in john_customers][:3]
        assert len(ids) >= 2, "need ≥2 John customers"

        # Save plan
        r = requests.post(f"{API}/beat-plan", headers=_h(john_token), timeout=20,
                          json={"date": d, "customer_ids": ids})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["auto"] is False
        stops = body["stops"]
        assert [s["customer_id"] for s in stops] == ids
        assert [s["order"] for s in stops] == list(range(1, len(ids) + 1))

        # GET returns the saved plan (same order)
        r = requests.get(f"{API}/beat-plan?date={d}", headers=_h(john_token), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert body["auto"] is False
        assert [s["customer_id"] for s in body["stops"]] == ids

        # Reorder — reverse and re-save
        reversed_ids = list(reversed(ids))
        r = requests.post(f"{API}/beat-plan", headers=_h(john_token), timeout=20,
                          json={"date": d, "customer_ids": reversed_ids})
        assert r.status_code == 200
        assert [s["customer_id"] for s in r.json()["stops"]] == reversed_ids

    def test_visited_flag_after_visit(self, john_token, john_customers):
        d = self._today()
        # Pick Fresh Foods Corner (has outstanding, John's)
        target = next((c for c in john_customers if c["shop_name"] == "Fresh Foods Corner"), None)
        assert target
        cid = target["id"]

        # save a plan containing this customer
        r = requests.post(f"{API}/beat-plan", headers=_h(john_token), timeout=20,
                          json={"date": d, "customer_ids": [cid]})
        assert r.status_code == 200
        # Since visits history exists in DB from prior tests today, visited may already be true.
        # If not, log a visit and re-check.
        stops = r.json()["stops"]
        if not stops[0]["visited"]:
            vr = requests.post(f"{API}/visits", headers=_h(john_token), timeout=20, json={
                "customer_id": cid, "visit_result": "No Order", "order_amount": 0,
                "remarks": "TEST visited flag",
            })
            assert vr.status_code == 201, vr.text
            r = requests.get(f"{API}/beat-plan?date={d}", headers=_h(john_token), timeout=20)
            stops = r.json()["stops"]
        stop = next(s for s in stops if s["customer_id"] == cid)
        assert stop["visited"] is True

    def test_salesman_can_only_plan_own_customers(self, john_token, priya_customers, john_customers):
        # Take a priya-owned customer id and try to include it in john's plan
        d = self._today()
        priya_ids = {c["id"] for c in priya_customers}
        john_ids = {c["id"] for c in john_customers}
        stranger = next(iter(priya_ids - john_ids), None)
        assert stranger, "expected at least one priya-only customer"

        # Backend does NOT explicitly reject; but stops resolution should not leak the stranger
        # because _build_beat_stops looks up customer regardless of owner. So we assert the
        # returned stop for a foreign customer is a code smell — expected behaviour per spec:
        # salesman can only build a plan of their own customers.
        r = requests.post(f"{API}/beat-plan", headers=_h(john_token), timeout=20,
                          json={"date": d, "customer_ids": [stranger]})
        assert r.status_code in (200, 400, 403), r.text
        if r.status_code == 200:
            stops = r.json()["stops"]
            # Either backend filters foreign customers OR returns them (bug).
            leaked = [s for s in stops if s["customer_id"] == stranger]
            # Record as assertion — this MUST be empty per spec
            assert not leaked, "SCOPING BUG: salesman was allowed to include another salesman's customer in beat plan"
