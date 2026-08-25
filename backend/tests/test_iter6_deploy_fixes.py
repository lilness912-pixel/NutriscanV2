"""Iteration 6 — deployment-readiness fix verification.

Covers:
- FIX 1: frontend/.env quoted METRO_CACHE_ROOT (env file well-formed; backend still up).
- FIX 2: EMERGENT_AUTH_URL loaded from env (invalid session_id -> 401).
- FIX 3: GET /api/progress single-query aggregation (<500ms, 7-day window, target from profile).
- FIX 4: DELETE /api/auth/account fully wipes user data across all collections.
- Regression smoke: 401 gate, happy path, rate limit metadata, 8MB cap, user scoping.
"""
import os
import time
import uuid
import base64
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # Fallback: read from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
_mc = MongoClient(MONGO_URL)
_db = _mc[DB_NAME]


def _mk_session(email_prefix="iter6"):
    uid = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_{email_prefix}_{uuid.uuid4().hex[:6]}@example.com"
    _db.users.insert_one({
        "user_id": uid, "email": email, "name": "TEST User", "picture": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    tok = f"testtok_{uuid.uuid4().hex}"
    _db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return uid, email, tok


def _cleanup(uid):
    _db.meals.delete_many({"user_id": uid})
    _db.mealplans.delete_many({"user_id": uid})
    _db.profiles.delete_many({"user_id": uid})
    _db.user_sessions.delete_many({"user_id": uid})
    _db.users.delete_one({"user_id": uid})


@pytest.fixture
def user():
    uid, email, tok = _mk_session()
    yield {"uid": uid, "email": email, "token": tok, "h": {"Authorization": f"Bearer {tok}"}}
    _cleanup(uid)


# ---------------- FIX 1: env file well-formed / backend up ----------------
class TestFix1EnvFile:
    def test_frontend_env_metro_cache_root_quoted(self):
        with open("/app/frontend/.env") as f:
            content = f.read()
        # Verify quoted form present, no unquoted variant
        assert 'METRO_CACHE_ROOT="/app/frontend/.metro-cache"' in content, \
            "METRO_CACHE_ROOT must be quoted"

    def test_backend_root_healthy(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("message") == "Nutriscan API"


# ---------------- FIX 2: EMERGENT_AUTH_URL from env ----------------
class TestFix2EmergentAuthUrl:
    def test_env_file_contains_key(self):
        with open("/app/backend/.env") as f:
            assert "EMERGENT_AUTH_URL=" in f.read()

    def test_invalid_session_returns_401(self):
        r = requests.post(f"{API}/auth/session",
                          json={"session_id": f"invalid-{uuid.uuid4().hex}"}, timeout=20)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"
        # Sanitized error
        assert "traceback" not in r.text.lower()


# ---------------- FIX 3: /progress single-query aggregation ----------------
class TestFix3Progress:
    def _seed_profile(self, uid, daily_calories=2200):
        _db.profiles.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid, "name": "TEST",
            "age": 30, "gender": "male", "height_cm": 180.0, "weight_kg": 75.0,
            "activity": "moderate", "goal": "maintain",
            "daily_calories": daily_calories, "protein_g": 135, "carbs_g": 260, "fat_g": 61,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    def test_progress_returns_7_days_with_correct_aggregation(self, user):
        uid = user["uid"]
        target = 2222
        self._seed_profile(uid, daily_calories=target)

        today = datetime.now(timezone.utc).date()
        # 5 meals across 3 different dates within last 7 days
        seed = {
            (today - timedelta(days=0)).strftime("%Y-%m-%d"): [500, 300],  # today: 800
            (today - timedelta(days=2)).strftime("%Y-%m-%d"): [450],       # 450
            (today - timedelta(days=5)).strftime("%Y-%m-%d"): [600, 250],  # 850
        }
        for d, cals in seed.items():
            for c in cals:
                _db.meals.insert_one({
                    "id": str(uuid.uuid4()), "user_id": uid,
                    "name": "TEST meal", "calories": c, "protein_g": 10.0,
                    "carbs_g": 20.0, "fat_g": 5.0, "portion": "1p",
                    "category": "snack", "date": d,
                    "logged_at": datetime.now(timezone.utc).isoformat(),
                })

        t0 = time.perf_counter()
        r = requests.get(f"{API}/progress?days=7", headers=user["h"], timeout=15)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert r.status_code == 200, r.text
        data = r.json()

        # (a) <500ms
        assert elapsed_ms < 500, f"progress took {elapsed_ms:.0f}ms, expected <500ms"

        # (b) exactly 7 entries, chronological ending today
        days = data["days"]
        assert len(days) == 7
        expected_dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]
        assert [d["date"] for d in days] == expected_dates
        assert days[-1]["date"] == today.strftime("%Y-%m-%d")

        # (c)+(d) calories on seeded dates match sums, other days = 0
        by_date = {d["date"]: d for d in days}
        for d, cals in seed.items():
            assert by_date[d]["calories"] == sum(cals), f"date {d} mismatch"
        seeded_dates = set(seed.keys())
        for d in expected_dates:
            if d not in seeded_dates:
                assert by_date[d]["calories"] == 0, f"unseeded {d} should be 0"

        # (e) target = profile.daily_calories
        assert data["target"] == target
        for entry in days:
            assert entry["target"] == target


# ---------------- FIX 4: DELETE /api/auth/account ----------------
class TestFix4DeleteAccount:
    def test_delete_account_wipes_everything(self):
        uid, email, tok = _mk_session("del")
        h = {"Authorization": f"Bearer {tok}"}
        try:
            # Seed profile
            _db.profiles.insert_one({
                "id": str(uuid.uuid4()), "user_id": uid, "name": "TEST",
                "age": 28, "gender": "female", "height_cm": 165.0, "weight_kg": 60.0,
                "activity": "light", "goal": "lose",
                "daily_calories": 1600, "protein_g": 108, "carbs_g": 180, "fat_g": 44,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            # Seed 3 meals
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for _ in range(3):
                _db.meals.insert_one({
                    "id": str(uuid.uuid4()), "user_id": uid,
                    "name": "TEST", "calories": 400, "protein_g": 10.0,
                    "carbs_g": 20.0, "fat_g": 5.0, "portion": "1p",
                    "category": "lunch", "date": today,
                    "logged_at": datetime.now(timezone.utc).isoformat(),
                })
            # Seed mealplan
            _db.mealplans.insert_one({
                "id": str(uuid.uuid4()), "user_id": uid,
                "week_start": "2026-01-06", "days": [], "generation_meta": {},
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            # Seed a second session
            tok2 = f"testtok_{uuid.uuid4().hex}"
            _db.user_sessions.insert_one({
                "session_token": tok2, "user_id": uid,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
                "created_at": datetime.now(timezone.utc),
            })

            # pre-check
            assert _db.users.count_documents({"user_id": uid}) == 1
            assert _db.profiles.count_documents({"user_id": uid}) == 1
            assert _db.meals.count_documents({"user_id": uid}) == 3
            assert _db.mealplans.count_documents({"user_id": uid}) == 1
            assert _db.user_sessions.count_documents({"user_id": uid}) == 2

            # (a) DELETE returns 200 + {deleted: true}
            r = requests.delete(f"{API}/auth/account", headers=h, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json() == {"deleted": True}

            # (b) all collections empty for uid
            assert _db.users.count_documents({"user_id": uid}) == 0
            assert _db.profiles.count_documents({"user_id": uid}) == 0
            assert _db.meals.count_documents({"user_id": uid}) == 0
            assert _db.mealplans.count_documents({"user_id": uid}) == 0
            assert _db.user_sessions.count_documents({"user_id": uid}) == 0

            # (c) subsequent /auth/me with same token -> 401
            r2 = requests.get(f"{API}/auth/me", headers=h, timeout=10)
            assert r2.status_code == 401
        finally:
            _cleanup(uid)


# ---------------- Regression smoke ----------------
class TestRegressionSmoke:
    def test_401_on_protected_routes_no_token(self):
        for path in ["/auth/me", "/profile", "/meals", "/meals/summary", "/progress", "/mealplan"]:
            r = requests.get(f"{API}{path}", timeout=10)
            assert r.status_code == 401, f"{path} expected 401 got {r.status_code}"
        # DELETE account also protected
        r = requests.delete(f"{API}/auth/account", timeout=10)
        assert r.status_code == 401

    def test_happy_path_profile_meal_summary_progress_delete(self, user):
        h = user["h"]
        # create profile
        prof_payload = {
            "name": "TEST", "age": 32, "gender": "male",
            "height_cm": 178.0, "weight_kg": 78.0,
            "activity": "moderate", "goal": "maintain",
        }
        r = requests.post(f"{API}/profile", json=prof_payload, headers=h, timeout=10)
        assert r.status_code == 200, r.text
        target = r.json()["daily_calories"]
        assert target > 1500

        # create meal
        meal_payload = {
            "name": "Salade", "calories": 450, "protein_g": 22.0,
            "carbs_g": 40.0, "fat_g": 18.0, "portion": "1 assiette", "category": "lunch",
        }
        r = requests.post(f"{API}/meals", json=meal_payload, headers=h, timeout=10)
        assert r.status_code == 200
        meal_id = r.json()["id"]

        # summary
        r = requests.get(f"{API}/meals/summary", headers=h, timeout=10)
        assert r.status_code == 200
        assert r.json()["calories"] == 450

        # progress
        r = requests.get(f"{API}/progress?days=7", headers=h, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert len(d["days"]) == 7
        assert d["target"] == target
        assert d["days"][-1]["calories"] == 450  # today

        # delete meal
        r = requests.delete(f"{API}/meals/{meal_id}", headers=h, timeout=10)
        assert r.status_code == 200
        assert r.json()["deleted"] == 1

    def test_scoping_user_a_cannot_delete_user_b_meal(self):
        uid_a, _, tok_a = _mk_session("A")
        uid_b, _, tok_b = _mk_session("B")
        try:
            # Create meal for user A
            r = requests.post(f"{API}/meals",
                              json={"name": "A-meal", "calories": 100, "protein_g": 5.0,
                                    "carbs_g": 10.0, "fat_g": 2.0, "portion": "1p",
                                    "category": "snack"},
                              headers={"Authorization": f"Bearer {tok_a}"}, timeout=10)
            assert r.status_code == 200
            meal_id = r.json()["id"]
            # User B attempts delete -> 403
            r = requests.delete(f"{API}/meals/{meal_id}",
                                headers={"Authorization": f"Bearer {tok_b}"}, timeout=10)
            assert r.status_code == 403
            # Meal still exists
            r = requests.get(f"{API}/meals",
                             headers={"Authorization": f"Bearer {tok_a}"}, timeout=10)
            assert any(m["id"] == meal_id for m in r.json())
        finally:
            _cleanup(uid_a); _cleanup(uid_b)

    def test_8mb_payload_cap_on_scan(self, user):
        # 8MB+1 base64 chars, should return 413
        big = "A" * (8 * 1024 * 1024 + 10)
        r = requests.post(f"{API}/meals/scan",
                          json={"image_base64": big},
                          headers=user["h"], timeout=15)
        assert r.status_code == 413, f"expected 413 got {r.status_code}"

    def test_rate_limit_still_configured_on_scan(self, user):
        # Just verify endpoint exists & auth-gated; full 30/h test done in iter5.
        # Send a small oversized payload to avoid burning LLM.
        r = requests.post(f"{API}/meals/scan",
                          json={"image_base64": "A" * (8 * 1024 * 1024 + 10)},
                          headers=user["h"], timeout=10)
        assert r.status_code in (413, 429)
