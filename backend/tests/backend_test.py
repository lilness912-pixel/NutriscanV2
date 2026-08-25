"""Backend tests for Nutriscan API.

Covers: profile CRUD (with BMR/TDEE), meals CRUD/summary/progress,
meal scan via Gemini (real food image), and meal plan generation via Gemini.
"""
import base64
import os
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://health-meal-planner-12.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def food_image_b64():
    """Fetch a real food image and return base64."""
    urls = [
        "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=640&q=70&fm=jpg",  # salad bowl
        "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=640&q=70&fm=jpg",  # burger
    ]
    for u in urls:
        try:
            r = requests.get(u, timeout=15)
            if r.status_code == 200 and len(r.content) > 5000:
                return base64.b64encode(r.content).decode("ascii")
        except Exception:
            continue
    pytest.skip("Could not fetch real food image for scan test")


@pytest.fixture(scope="session")
def profile(api_client):
    payload = {
        "name": "TEST_User",
        "age": 30,
        "gender": "male",
        "height_cm": 180,
        "weight_kg": 75,
        "activity": "moderate",
        "goal": "maintain",
    }
    r = api_client.post(f"{API}/profile", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    yield data
    # cleanup handled at session end via mongo not needed; leave data


# ---------- Health ----------
def test_root(api_client):
    r = api_client.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("message") == "Nutriscan API"


# ---------- Profile ----------
class TestProfile:
    def test_create_profile_computes_targets(self, profile):
        # Mifflin: 10*75 + 6.25*180 - 5*30 + 5 = 750+1125-150+5 = 1730 * 1.55 = 2681.5
        assert profile["daily_calories"] == 2682 or profile["daily_calories"] == 2681
        assert profile["protein_g"] == 135  # 75*1.8
        assert profile["fat_g"] > 0
        assert profile["carbs_g"] > 0
        assert profile["id"]

    def test_get_profile(self, api_client, profile):
        r = api_client.get(f"{API}/profile/{profile['id']}")
        assert r.status_code == 200
        data = r.json()
        assert "_id" not in data
        assert data["id"] == profile["id"]
        assert data["name"] == "TEST_User"

    def test_get_profile_not_found(self, api_client):
        r = api_client.get(f"{API}/profile/nonexistent-id-xyz")
        assert r.status_code == 404

    def test_update_profile_recomputes(self, api_client, profile):
        payload = {
            "name": "TEST_User",
            "age": 30,
            "gender": "male",
            "height_cm": 180,
            "weight_kg": 80,
            "activity": "active",
            "goal": "lose",
        }
        r = api_client.put(f"{API}/profile/{profile['id']}", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert data["weight_kg"] == 80
        # Verify persistence
        r2 = api_client.get(f"{API}/profile/{profile['id']}")
        assert r2.json()["weight_kg"] == 80
        assert r2.json()["daily_calories"] == data["daily_calories"]


# ---------- Meals ----------
class TestMeals:
    meal_id = None

    def test_create_meal(self, api_client, profile):
        payload = {
            "user_id": profile["id"],
            "name": "TEST_Oatmeal",
            "calories": 350,
            "protein_g": 12.0,
            "carbs_g": 55.0,
            "fat_g": 8.0,
            "portion": "1 bowl",
            "category": "breakfast",
        }
        r = api_client.post(f"{API}/meals", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Oatmeal"
        assert data["date"]  # auto-populated
        TestMeals.meal_id = data["id"]

    def test_list_meals(self, api_client, profile):
        r = api_client.get(f"{API}/meals", params={"user_id": profile["id"]})
        assert r.status_code == 200
        meals = r.json()
        assert any(m["id"] == TestMeals.meal_id for m in meals)

    def test_meals_summary(self, api_client, profile):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = api_client.get(f"{API}/meals/summary", params={"user_id": profile["id"], "date": today})
        assert r.status_code == 200
        d = r.json()
        assert d["calories"] >= 350
        assert d["count"] >= 1

    def test_progress_7_days(self, api_client, profile):
        r = api_client.get(f"{API}/progress", params={"user_id": profile["id"], "days": 7})
        assert r.status_code == 200
        d = r.json()
        assert len(d["days"]) == 7
        assert d["target"] > 0
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        today_entry = [x for x in d["days"] if x["date"] == today_str]
        assert today_entry and today_entry[0]["calories"] >= 350

    def test_delete_meal(self, api_client):
        r = api_client.delete(f"{API}/meals/{TestMeals.meal_id}")
        assert r.status_code == 200
        assert r.json()["deleted"] == 1


# ---------- AI: Meal scan ----------
class TestAIScan:
    def test_scan_meal_real_image(self, api_client, profile, food_image_b64):
        payload = {"user_id": profile["id"], "image_base64": food_image_b64}
        r = api_client.post(f"{API}/meals/scan", json=payload, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"]
        assert isinstance(d["calories"], int) and d["calories"] > 0
        assert d["protein_g"] >= 0
        assert d["carbs_g"] >= 0
        assert d["fat_g"] >= 0
        assert 0 <= d["confidence"] <= 1
        assert isinstance(d["ingredients"], list)


# ---------- AI: Meal plan ----------
class TestAIMealPlan:
    def test_generate_plan(self, api_client, profile):
        r = api_client.post(f"{API}/mealplan/generate", json={"user_id": profile["id"]}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["days"]) >= 5  # ideally 7
        first = d["days"][0]
        assert "breakfast" in first and "lunch" in first
        assert first["breakfast"].get("name")

    def test_get_plan(self, api_client, profile):
        r = api_client.get(f"{API}/mealplan/{profile['id']}")
        assert r.status_code == 200
        assert r.json()["user_id"] == profile["id"]
