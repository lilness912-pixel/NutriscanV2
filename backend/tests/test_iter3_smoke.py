"""Iteration 3 smoke tests: verify backend still passes iteration-2 contract at a glance.
No re-run of all 9 tests; just a fast health-check pass on the critical endpoints."""
import os
import time
from datetime import datetime, timezone, timedelta
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://health-meal-planner-12.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _monday_iso():
    today = datetime.now(timezone.utc).date()
    return (today - timedelta(days=today.weekday())).isoformat()


@pytest.fixture(scope="module")
def uid():
    r = requests.post(f"{API}/profile", json={
        "name": "TEST_Iter3", "age": 30, "gender": "male",
        "height_cm": 180, "weight_kg": 75,
        "activity": "moderate", "goal": "maintain",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


class TestSmoke:
    def test_profile_get(self, uid):
        r = requests.get(f"{API}/profile/{uid}", timeout=15)
        assert r.status_code == 200
        assert r.json()["daily_calories"] > 0

    def test_meal_crud_and_summary(self, uid):
        r = requests.post(f"{API}/meals", json={
            "user_id": uid, "name": "TEST_Smoke", "calories": 250,
            "protein_g": 12, "carbs_g": 30, "fat_g": 8, "portion": "1",
            "category": "lunch",
        }, timeout=15)
        assert r.status_code == 200
        mid = r.json()["id"]
        s = requests.get(f"{API}/meals/summary", params={"user_id": uid}, timeout=15)
        assert s.status_code == 200 and s.json()["calories"] >= 250
        d = requests.delete(f"{API}/meals/{mid}", timeout=15)
        assert d.status_code == 200

    def test_progress(self, uid):
        r = requests.get(f"{API}/progress", params={"user_id": uid, "days": 7}, timeout=15)
        assert r.status_code == 200
        assert len(r.json()["days"]) == 7

    def test_mealplan_no_refresh_404_when_absent(self, uid):
        r = requests.get(f"{API}/mealplan/{uid}", params={"auto_refresh": "false"}, timeout=15)
        assert r.status_code in (200, 404)

    def test_mealplan_generate_polling_fallback(self, uid):
        """Simulate the frontend flow: fire generate (may 502 at 60s), then poll GET."""
        try:
            requests.post(f"{API}/mealplan/generate",
                          json={"user_id": uid, "force": True},
                          timeout=55)  # match the frontend 55s cut
        except requests.exceptions.RequestException:
            pass
        deadline = time.time() + 180
        p = None
        while time.time() < deadline:
            g = requests.get(f"{API}/mealplan/{uid}",
                             params={"auto_refresh": "false"}, timeout=30)
            if g.status_code == 200 and g.json().get("week_start") == _monday_iso():
                p = g.json()
                break
            time.sleep(5)
        assert p is not None, "Plan not persisted after 3 min of polling"
        assert len(p["days"]) == 7
        assert p["generation_meta"]["model"] == "gemini-3.1-pro-preview"

    def test_generate_force_false_cache_hit(self, uid):
        t0 = time.time()
        r = requests.post(f"{API}/mealplan/generate",
                          json={"user_id": uid, "force": False}, timeout=30)
        elapsed = time.time() - t0
        assert r.status_code == 200
        assert elapsed < 5, f"cache path {elapsed:.1f}s"

    def test_put_profile_invalidates_plan(self, uid):
        r = requests.put(f"{API}/profile/{uid}", json={
            "name": "TEST_Iter3", "age": 31, "gender": "male",
            "height_cm": 180, "weight_kg": 76,
            "activity": "moderate", "goal": "lose",
        }, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{API}/mealplan/{uid}",
                         params={"auto_refresh": "false"}, timeout=15)
        assert g.status_code == 404
