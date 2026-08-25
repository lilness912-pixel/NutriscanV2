"""Iteration 7 smoke test — EMERGENT_AUTH_URL no-fallback env fix.
Verifies:
  1. Backend booted (no KeyError) → GET /api/ returns 200 with Nutriscan message.
  2. POST /api/auth/session with invalid session_id → 401 sanitized (proves env value loaded).
  3. GET /api/profile without token → 401.
  4. GET /api/auth/me with a seeded valid session → 200 with user payload.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_BACKEND_URL"].rstrip("/") if "EXPO_BACKEND_URL" in os.environ else "https://health-meal-planner-12.preview.emergentagent.com"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def seeded_session():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    uid = f"user_TEST_{uuid.uuid4().hex[:12]}"
    db.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{uid}@example.com",
        "name": "TEST User",
        "picture": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = f"testtok_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    yield {"token": token, "user_id": uid}
    # cleanup
    db.user_sessions.delete_one({"session_token": token})
    db.users.delete_one({"user_id": uid})
    client.close()


# 1. root endpoint — proves backend booted (no startup KeyError)
def test_root_returns_nutriscan_message(api):
    r = api.get(f"{BASE_URL}/api/")
    assert r.status_code == 200, r.text
    body = r.json()
    # accept any reasonable field containing Nutriscan-ish message
    msg = str(body).lower()
    assert "nutriscan" in msg or "message" in body, f"unexpected root body: {body}"


# 2. invalid session_id → 401 sanitized
def test_auth_session_invalid_returns_401(api):
    r = api.post(f"{BASE_URL}/api/auth/session",
                 json={"session_id": "invalid_test_session_xyz"})
    assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"
    body = r.text.lower()
    # sanitized: no stack trace / no raw upstream leak
    assert "traceback" not in body
    assert "keyerror" not in body


# 3. protected endpoint without token → 401
def test_profile_without_token_401(api):
    r = api.get(f"{BASE_URL}/api/profile")
    assert r.status_code == 401, r.text


# 4. /api/auth/me with seeded valid session → 200 with user payload
def test_auth_me_with_seeded_session(api, seeded_session):
    r = api.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {seeded_session['token']}"},
    )
    assert r.status_code == 200, f"got {r.status_code}: {r.text}"
    body = r.json()
    # should surface user info
    assert body.get("user_id") == seeded_session["user_id"] or \
           body.get("id") == seeded_session["user_id"] or \
           (isinstance(body.get("user"), dict) and
            body["user"].get("user_id") == seeded_session["user_id"]), \
        f"user payload missing user_id: {body}"
