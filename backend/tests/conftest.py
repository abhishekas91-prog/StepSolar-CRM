import os
import uuid
import logging
from datetime import datetime

import pytest
import requests

logger = logging.getLogger(__name__)

# Generate or reuse a test admin token. This will be used by tests and (optionally)
# written into the backend DB if a Mongo URL is available. Tests will pick up the
# token via env vars STEPSOLAR_ADMIN_TOKEN or REACT_APP_ADMIN_TOKEN.
TEST_ADMIN_TOKEN = (
    os.environ.get("STEPSOLAR_ADMIN_TOKEN")
    or os.environ.get("REACT_APP_ADMIN_TOKEN")
    or f"test-admin-{uuid.uuid4().hex[:8]}"
)

# Expose token to the environment so any in-process server started under the
# same pytest run can pick it up via os.environ.get('STEPSOLAR_ADMIN_TOKEN').
os.environ.setdefault("STEPSOLAR_ADMIN_TOKEN", TEST_ADMIN_TOKEN)
os.environ.setdefault("REACT_APP_ADMIN_TOKEN", TEST_ADMIN_TOKEN)

# Try to seed an "admins" document in MongoDB if possible. This is a best-effort
# convenience for test environments where the backend reads admin tokens from
# a collection. If pymongo isn't available or MONGO_URL is not set, we skip.
def _seed_admin_to_mongo(token: str):
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME") or "stepsolar"
    if not mongo_url:
        logger.debug("MONGO_URL not set; skipping admin seed in MongoDB")
        return False

    try:
        from pymongo import MongoClient
    except Exception as e:  # pragma: no cover - optional dependency
        logger.warning("pymongo not available; cannot seed admin token into DB: %s", e)
        return False

    try:
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
        db = client[db_name]
        admins = db.get_collection("admins")
        # Upsert a predictable test admin document
        admins.update_one(
            {"name": "pytest-admin"},
            {
                "$set": {
                    "name": "pytest-admin",
                    "token": token,
                    "created_at": datetime.utcnow(),
                    "notes": "seeded-by-pytest-conftest",
                }
            },
            upsert=True,
        )
        logger.info("Seeded test admin token into MongoDB collection 'admins' in DB '%s'", db_name)
        return True
    except Exception as e:
        logger.warning("Failed to seed admin token into MongoDB: %s", e)
        return False
    finally:
        try:
            client.close()
        except Exception:
            pass

# Run seeding now (best-effort). Tests can rely on pytest fixtures below regardless
# of whether the DB write succeeded.
_seed_admin_to_mongo(TEST_ADMIN_TOKEN)


# Provide a session-scoped fixture that returns the test admin token.
@pytest.fixture(scope="session")
def test_admin_token():
    """Return the admin token that should be used by tests.

    The test suite (backend/tests/backend_test.py) was modified to read the
    ADMIN_TOKEN from environment variables (STEPSOLAR_ADMIN_TOKEN or
    REACT_APP_ADMIN_TOKEN). This fixture returns that token so tests or other
    fixtures can use it programmatically.
    """
    return TEST_ADMIN_TOKEN


@pytest.fixture(scope="session")
def admin_s(test_admin_token):
    """Return a requests.Session pre-configured with the admin header.

    This overrides the local admin_s fixture in backend_test.py so tests will
    automatically use the seeded token when calling the backend admin endpoints.
    """
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json", "X-Admin-Token": test_admin_token})
    return sess


@pytest.fixture(scope="session")
def s():
    """Return a basic requests.Session for non-admin requests."""
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess
