"""Security hardening iteration tests for Nutriscan (auth, ownership, size cap, rate limit, sanitized errors)."""
import os
import uuid
import time
import json
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://health-meal-planner-12.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def _mk_session(email_prefix: str):
    """Directly seed a user + session in Mongo, return (user_id, token)."""
    uid = f"user_{uuid.uuid4().hex[:12]}"
    token = f"tok_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{email_prefix}_{uid}@example.com",
        "name": f"TEST {email_prefix}",
        "created_at": now.isoformat(),
        "last_login_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    return uid, token


@pytest.fixture(scope="module")
def user_a():
    uid, tok = _mk_session("A")
    yield {"user_id": uid, "token": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.profiles.delete_many({"user_id": uid})
    db.meals.delete_many({"user_id": uid})
    db.mealplans.delete_many({"user_id": uid})


@pytest.fixture(scope="module")
def user_b():
    uid, tok = _mk_session("B")
    yield {"user_id": uid, "token": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.profiles.delete_many({"user_id": uid})
    db.meals.delete_many({"user_id": uid})


def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============ AUTH GATE ============
class TestAuthGate:
    """All protected endpoints must return 401 without a valid token."""

    PROTECTED_GET = ["/profile", "/meals", "/meals/summary", "/progress", "/mealplan", "/auth/me"]
    PROTECTED_POST = ["/profile", "/meals", "/meals/scan", "/mealplan/generate"]

    @pytest.mark.parametrize("path", PROTECTED_GET)
    def test_get_no_auth_returns_401(self, path):
        r = requests.get(f"{BASE_URL}/api{path}")
        assert r.status_code == 401, f"GET {path} should be 401, got {r.status_code} body={r.text[:200]}"

    @pytest.mark.parametrize("path", PROTECTED_POST)
    def test_post_no_auth_returns_401(self, path):
        r = requests.post(f"{BASE_URL}/api{path}", json={})
        assert r.status_code == 401, f"POST {path} should be 401, got {r.status_code}"

    def test_put_profile_no_auth(self):
        r = requests.put(f"{BASE_URL}/api/profile", json={})
        assert r.status_code == 401

    def test_delete_meal_no_auth(self):
        r = requests.delete(f"{BASE_URL}/api/meals/nonexistent")
        assert r.status_code == 401

    def test_random_invalid_bearer_401(self):
        r = requests.get(f"{BASE_URL}/api/profile", headers={"Authorization": "Bearer totally-bogus-token"})
        assert r.status_code == 401

    def test_root_public(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("message")


# ============ AUTH EXCHANGE ============
class TestAuthExchange:
    def test_session_invalid_id_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "invalid-fake-session-id-xyz"})
        assert r.status_code == 401
        body = r.text.lower()
        assert "traceback" not in body
        assert "gemini" not in body
        assert "emergent_llm_key" not in body

    def test_auth_me_with_seeded_session(self, user_a):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h(user_a["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == user_a["user_id"]
        assert "email" in data
        assert data["has_profile"] is False


# ============ USER SCOPING (IDOR) ============
class TestUserScoping:
    def test_isolation_flow(self, user_a, user_b):
        # A creates profile
        prof = {"name": "TEST_A", "age": 30, "gender": "male", "height_cm": 180,
                "weight_kg": 75, "activity": "moderate", "goal": "maintain"}
        r = requests.post(f"{BASE_URL}/api/profile", json=prof, headers=h(user_a["token"]))
        assert r.status_code == 200, r.text

        # A creates a meal
        meal = {"name": "TEST_A_meal", "calories": 400, "protein_g": 20, "carbs_g": 40,
                "fat_g": 10, "portion": "1 bol"}
        r = requests.post(f"{BASE_URL}/api/meals", json=meal, headers=h(user_a["token"]))
        assert r.status_code == 200, r.text
        meal_a_id = r.json()["id"]
        assert r.json()["user_id"] == user_a["user_id"]

        # B tries to delete A's meal → 403 or 404
        r = requests.delete(f"{BASE_URL}/api/meals/{meal_a_id}", headers=h(user_b["token"]))
        assert r.status_code in (403, 404), f"IDOR: B could delete A's meal ({r.status_code})"

        # B lists meals — should not contain A's
        r = requests.get(f"{BASE_URL}/api/meals", headers=h(user_b["token"]))
        assert r.status_code == 200
        for m in r.json():
            assert m["user_id"] == user_b["user_id"]
            assert m["id"] != meal_a_id

        # B has no profile → 404
        r = requests.get(f"{BASE_URL}/api/profile", headers=h(user_b["token"]))
        assert r.status_code == 404

        # Verify A's meal still exists
        r = requests.get(f"{BASE_URL}/api/meals", headers=h(user_a["token"]))
        assert r.status_code == 200
        assert any(m["id"] == meal_a_id for m in r.json())


# ============ MongoDB INJECTION SAFETY ============
class TestInjectionSafety:
    def test_user_id_in_body_ignored(self, user_a):
        # Ensure profile exists
        prof = {"name": "TEST_A", "age": 30, "gender": "male", "height_cm": 180,
                "weight_kg": 75, "activity": "moderate", "goal": "maintain"}
        requests.post(f"{BASE_URL}/api/profile", json=prof, headers=h(user_a["token"]))

        meal = {"name": "TEST_INJ", "calories": 100, "protein_g": 5, "carbs_g": 10,
                "fat_g": 2, "portion": "1", "user_id": "attacker-injected-id"}
        r = requests.post(f"{BASE_URL}/api/meals", json=meal, headers=h(user_a["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["user_id"] == user_a["user_id"]
        # DB check
        doc = db.meals.find_one({"id": r.json()["id"]})
        assert doc["user_id"] == user_a["user_id"]


# ============ PROFILE INVALIDATION ============
class TestProfileInvalidation:
    def test_put_profile_invalidates_plan(self, user_a):
        # Seed a mealplan for user_a
        db.mealplans.delete_many({"user_id": user_a["user_id"]})
        db.mealplans.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_a["user_id"],
            "week_start": "2025-01-06",
            "days": [],
            "generation_meta": {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        # Ensure plan exists via API
        r = requests.get(f"{BASE_URL}/api/mealplan?auto_refresh=false", headers=h(user_a["token"]))
        assert r.status_code == 200, f"Seeded plan not found: {r.status_code} {r.text[:200]}"

        # PUT profile → must invalidate
        new = {"name": "TEST_A_upd", "age": 31, "gender": "male", "height_cm": 180,
               "weight_kg": 76, "activity": "moderate", "goal": "maintain"}
        r = requests.put(f"{BASE_URL}/api/profile", json=new, headers=h(user_a["token"]))
        assert r.status_code == 200

        r = requests.get(f"{BASE_URL}/api/mealplan?auto_refresh=false", headers=h(user_a["token"]))
        assert r.status_code == 404, f"Plan should be invalidated, got {r.status_code}"


# ============ PAYLOAD SIZE CAP ============
class TestPayloadCap:
    def test_scan_over_8mb_returns_413(self, user_a):
        big = "A" * 8_400_000
        r = requests.post(f"{BASE_URL}/api/meals/scan", json={"image_base64": big}, headers=h(user_a["token"]))
        assert r.status_code == 413, f"Expected 413 for oversized payload, got {r.status_code}"

    def test_scan_empty_returns_413(self, user_a):
        r = requests.post(f"{BASE_URL}/api/meals/scan", json={"image_base64": ""}, headers=h(user_a["token"]))
        assert r.status_code == 413


# ============ RATE LIMIT ============
class TestRateLimit:
    def test_scan_rate_limit_30_per_hour(self):
        # Fresh user to avoid pollution
        uid, tok = _mk_session("RL")
        try:
            big = "A" * 8_400_000  # will 413 but limiter runs first
            statuses = []
            hit_429 = False
            for i in range(35):
                r = requests.post(f"{BASE_URL}/api/meals/scan",
                                  json={"image_base64": big}, headers=h(tok))
                statuses.append(r.status_code)
                if r.status_code == 429:
                    hit_429 = True
                    break
            assert hit_429, f"Expected 429 within 35 calls; statuses={statuses}"
            # Ensure 429 came after ~30 successful non-429 calls
            idx = statuses.index(429)
            assert idx >= 25, f"429 came too early at idx={idx}: {statuses}"
        finally:
            db.users.delete_one({"user_id": uid})
            db.user_sessions.delete_many({"user_id": uid})


# ============ ERROR SANITIZATION ============
class TestErrorSanitization:
    def test_malformed_body_no_leak(self, user_a):
        # Send invalid JSON body
        r = requests.post(f"{BASE_URL}/api/profile",
                          data="not-json{{",
                          headers={"Authorization": f"Bearer {user_a['token']}",
                                   "Content-Type": "application/json"})
        assert r.status_code in (400, 422)
        body = r.text.lower()
        assert "traceback" not in body
        assert "gemini" not in body
        assert "emergent_llm_key" not in body
        assert "sk-emergent" not in body

    def test_validation_error_no_leak(self, user_a):
        # missing required fields
        r = requests.post(f"{BASE_URL}/api/profile", json={"name": "X"}, headers=h(user_a["token"]))
        assert r.status_code in (400, 422)
        body = r.text.lower()
        assert "traceback" not in body
        assert "emergent_llm_key" not in body


# ============ REGRESSION HAPPY PATH ============
class TestRegression:
    def test_happy_path(self):
        uid, tok = _mk_session("HP")
        try:
            prof = {"name": "TEST_HP", "age": 25, "gender": "female", "height_cm": 165,
                    "weight_kg": 60, "activity": "light", "goal": "lose"}
            r = requests.post(f"{BASE_URL}/api/profile", json=prof, headers=h(tok))
            assert r.status_code == 200, r.text
            assert r.json()["daily_calories"] > 0

            r = requests.get(f"{BASE_URL}/api/profile", headers=h(tok))
            assert r.status_code == 200
            assert r.json()["name"] == "TEST_HP"

            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            meal = {"name": "TEST_HP_meal", "calories": 500, "protein_g": 25,
                    "carbs_g": 50, "fat_g": 15, "portion": "1 bol"}
            r = requests.post(f"{BASE_URL}/api/meals", json=meal, headers=h(tok))
            assert r.status_code == 200
            mid = r.json()["id"]

            r = requests.get(f"{BASE_URL}/api/meals/summary", headers=h(tok))
            assert r.status_code == 200
            s = r.json()
            assert s["count"] >= 1
            assert s["calories"] >= 500

            r = requests.delete(f"{BASE_URL}/api/meals/{mid}", headers=h(tok))
            assert r.status_code == 200

            r = requests.get(f"{BASE_URL}/api/meals/summary?date={today}", headers=h(tok))
            assert r.status_code == 200
            s = r.json()
            # After deletion, this specific meal's cals should not be counted
            # (there might be other meals in same day but our meal is gone)
            r2 = requests.get(f"{BASE_URL}/api/meals", headers=h(tok))
            assert all(m["id"] != mid for m in r2.json())
        finally:
            db.users.delete_one({"user_id": uid})
            db.user_sessions.delete_many({"user_id": uid})
            db.profiles.delete_many({"user_id": uid})
            db.meals.delete_many({"user_id": uid})
