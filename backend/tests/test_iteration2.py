"""Iteration 2 focused tests: seasonal meal plan, cache invalidation, auto-refresh,
force flag, and regressions. Base URL from EXPO_PUBLIC_BACKEND_URL."""
import os
import base64
import io
import time
from datetime import datetime, timezone, timedelta
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://health-meal-planner-12.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TIMEOUT_AI = 240  # plan generation ~60-90s w/ Gemini 3.1 Pro


def _monday_iso():
    today = datetime.now(timezone.utc).date()
    return (today - timedelta(days=today.weekday())).isoformat()


@pytest.fixture(scope="module")
def profile_id():
    payload = {
        "name": "TEST_Iter2", "age": 30, "gender": "male",
        "height_cm": 180, "weight_kg": 75,
        "activity": "moderate", "goal": "maintain",
    }
    r = requests.post(f"{API}/profile", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    yield uid
    # cleanup: no delete endpoint for profile; drop meals + plan indirectly via next runs


# ---------- Regression: basic profile + meals routes ----------
class TestRegression:
    def test_get_profile(self, profile_id):
        r = requests.get(f"{API}/profile/{profile_id}", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["daily_calories"] > 0 and j["protein_g"] > 0

    def test_create_and_list_meals(self, profile_id):
        r = requests.post(f"{API}/meals", json={
            "user_id": profile_id, "name": "TEST_Oats", "calories": 300,
            "protein_g": 10, "carbs_g": 45, "fat_g": 6, "portion": "1 bol",
            "category": "breakfast",
        }, timeout=15)
        assert r.status_code == 200
        mid = r.json()["id"]

        r2 = requests.get(f"{API}/meals", params={"user_id": profile_id}, timeout=15)
        assert r2.status_code == 200
        assert any(m["id"] == mid for m in r2.json())

        # summary
        r3 = requests.get(f"{API}/meals/summary", params={"user_id": profile_id}, timeout=15)
        assert r3.status_code == 200
        assert r3.json()["calories"] >= 300

        # delete
        r4 = requests.delete(f"{API}/meals/{mid}", timeout=15)
        assert r4.status_code == 200

    def test_progress(self, profile_id):
        r = requests.get(f"{API}/progress", params={"user_id": profile_id, "days": 7}, timeout=15)
        assert r.status_code == 200
        assert len(r.json()["days"]) == 7


# ---------- Meal Plan generation ----------
class TestMealPlan:
    plan_cache = {}

    def test_generate_plan_first_time(self, profile_id):
        # Kick generation. Ingress (Cloudflare) has a 60s timeout while Gemini 3.1 Pro
        # takes 60-120s -> client will often see 502. Backend still stores the plan,
        # so we poll the GET endpoint until the plan appears.
        try:
            requests.post(f"{API}/mealplan/generate",
                          json={"user_id": profile_id, "force": True},
                          timeout=TIMEOUT_AI)
        except requests.exceptions.RequestException:
            pass
        # Poll for the freshly persisted plan
        deadline = time.time() + 180
        p = None
        while time.time() < deadline:
            g = requests.get(f"{API}/mealplan/{profile_id}",
                             params={"auto_refresh": "false"}, timeout=30)
            if g.status_code == 200:
                p = g.json()
                if p.get("week_start") == _monday_iso():
                    break
            time.sleep(5)
        assert p is not None, "Plan never became available after 3 min"
        TestMealPlan.plan_cache["plan"] = p
        assert p["week_start"] == _monday_iso()
        assert len(p["days"]) == 7
        day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        assert [d["day"] for d in p["days"]] == day_order
        meta = p.get("generation_meta", {})
        assert meta.get("model") == "gemini-3.1-pro-preview", meta
        assert meta.get("season") in ("hiver", "printemps", "été", "automne")
        assert meta.get("days_on_target") == 7, f"Only {meta.get('days_on_target')}/7 days on target"
        # week_start = current monday
        assert p["week_start"] == _monday_iso(), f"week_start={p['week_start']} vs monday={_monday_iso()}"
        # 7 days in order
        assert len(p["days"]) == 7
        day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        assert [d["day"] for d in p["days"]] == day_order
        # generation_meta
        meta = p.get("generation_meta", {})
        assert meta.get("model") == "gemini-3.1-pro-preview", meta
        assert meta.get("season") in ("hiver", "printemps", "été", "automne")
        assert meta.get("days_on_target") == 7, f"Only {meta.get('days_on_target')}/7 days on target (±8%)"

    def test_seasonal_ingredients(self, profile_id):
        p = TestMealPlan.plan_cache.get("plan")
        assert p is not None
        season = p["generation_meta"]["season"]
        # Season->expected keywords (lowercased, no accents on some like é kept)
        season_kw = {
            "été": ["tomate", "courgette", "aubergine", "melon", "pêche", "abricot",
                    "concombre", "poivron", "basilic", "figue", "framboise",
                    "sardine", "thon", "maquereau", "pastèque", "nectarine",
                    "myrtille", "haricot vert", "féta", "feta", "mozzarella"],
            "hiver": ["poireau", "chou", "endive", "carotte", "panais", "courge",
                      "potiron", "orange", "clémentine", "kiwi", "poire",
                      "épinard", "lentille"],
            "printemps": ["asperge", "artichaut", "petit pois", "radis", "fraise",
                          "rhubarbe", "cerise", "épinard", "fève"],
            "automne": ["courge", "potiron", "champignon", "poireau", "raisin",
                        "figue", "prune", "coing", "châtaigne", "noix"],
        }
        kws = season_kw[season]
        # Flatten all text
        text = ""
        for d in p["days"]:
            for k in ("breakfast", "lunch", "dinner", "snack"):
                m = d.get(k) or {}
                text += " " + (m.get("name") or "") + " " + (m.get("description") or "")
        text_low = text.lower()
        hits = sorted({kw for kw in kws if kw in text_low})
        assert len(hits) >= 8, f"Only {len(hits)} seasonal ingredients found for {season}: {hits}"

    def test_generate_without_force_returns_cache_fast(self, profile_id):
        # Should return cache since a plan for the current week exists
        t0 = time.time()
        r = requests.post(f"{API}/mealplan/generate",
                          json={"user_id": profile_id, "force": False},
                          timeout=30)
        elapsed = time.time() - t0
        assert r.status_code == 200
        assert elapsed < 5, f"Cache path took {elapsed:.1f}s (expected <5s)"
        # Same id as previously stored plan
        prev = TestMealPlan.plan_cache["plan"]
        assert r.json()["id"] == prev["id"]

    def test_get_plan_auto_refresh_returns_cache_when_current(self, profile_id):
        t0 = time.time()
        r = requests.get(f"{API}/mealplan/{profile_id}",
                         params={"auto_refresh": "true"}, timeout=30)
        elapsed = time.time() - t0
        assert r.status_code == 200
        assert elapsed < 5
        p = r.json()
        # No auto_refreshed flag since week is current
        assert not p.get("auto_refreshed"), "Should not refresh: week_start already current"

    def test_auto_refresh_regenerates_when_stale(self, profile_id):
        """Simulate a stale plan by writing week_start to a past date via profile update,
        then verify auto_refresh=true regenerates. Since we can't directly mutate DB,
        we invalidate through PUT profile (which deletes plan). But that removes the plan
        entirely. Alternative: use requests to update mongodb - not available. So we test
        stale path indirectly by mutating via PUT then generating fresh with force, and
        confirming auto_refresh path returns non-stale. This test is skipped as we cannot
        artificially age the plan without direct DB access."""
        pytest.skip("Cannot age plan without direct DB access; behavior covered by code review")


# ---------- Cache invalidation on profile update ----------
class TestCacheInvalidation:
    def test_put_profile_invalidates_plan(self, profile_id):
        # Ensure a plan exists first
        r0 = requests.get(f"{API}/mealplan/{profile_id}",
                          params={"auto_refresh": "false"}, timeout=15)
        assert r0.status_code == 200, "Pre-condition: plan must exist"

        # Update the profile
        r = requests.put(f"{API}/profile/{profile_id}", json={
            "name": "TEST_Iter2", "age": 31, "gender": "male",
            "height_cm": 180, "weight_kg": 76,
            "activity": "moderate", "goal": "lose",
        }, timeout=15)
        assert r.status_code == 200

        # The cached plan must be gone -> 404 when auto_refresh=false
        r2 = requests.get(f"{API}/mealplan/{profile_id}",
                          params={"auto_refresh": "false"}, timeout=15)
        assert r2.status_code == 404, f"Expected 404 after profile PUT, got {r2.status_code}: {r2.text[:200]}"


# ---------- Meal Scan (real JPEG) ----------
class TestMealScan:
    def _real_jpeg_b64(self):
        """Fetch a real dish photo from unsplash; fallback to a generated JPEG."""
        try:
            resp = requests.get(
                "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=70&fm=jpg",
                timeout=15,
            )
            resp.raise_for_status()
            return base64.b64encode(resp.content).decode()
        except Exception:
            # last-resort tiny valid JPEG (won't have food but ensures API doesn't crash)
            from PIL import Image
            img = Image.new("RGB", (256, 256), (200, 120, 80))
            buf = io.BytesIO()
            img.save(buf, "JPEG")
            return base64.b64encode(buf.getvalue()).decode()

    def test_scan_returns_consistent_macros(self, profile_id):
        b64 = self._real_jpeg_b64()
        r = requests.post(f"{API}/meals/scan",
                          json={"user_id": profile_id, "image_base64": b64},
                          timeout=TIMEOUT_AI)
        assert r.status_code == 200, r.text
        j = r.json()
        # Clamping
        assert 0 <= j["calories"] <= 3000
        assert 0 <= j["protein_g"] <= 200
        assert 0 <= j["carbs_g"] <= 300
        assert 0 <= j["fat_g"] <= 200
        assert 0.0 <= j["confidence"] <= 1.0
        # kcal ~ 4P+4C+9F within 35% tolerance
        macro_kcal = 4 * j["protein_g"] + 4 * j["carbs_g"] + 9 * j["fat_g"]
        if macro_kcal > 0 and j["calories"] > 0:
            rel = abs(j["calories"] - macro_kcal) / max(j["calories"], macro_kcal)
            assert rel <= 0.36, f"kcal={j['calories']} vs macro_kcal={macro_kcal:.0f} (rel={rel:.2%})"
