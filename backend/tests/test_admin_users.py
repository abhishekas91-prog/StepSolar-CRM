"""Admin user management API tests.

These exercise the JWT-protected /api/admin/users endpoints plus the
bootstrap admin that server.py seeds on startup (super@stepsolar.in /
Abhi@93047 by default). They require a running, seeded backend — configure
REACT_APP_BACKEND_URL, ADMIN_EMAIL and ADMIN_PASSWORD to point at one, or
set SKIP_ADMIN_TESTS=1 to disable.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://leads-engine.preview.emergentagent.com"
).rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "super@stepsolar.in").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Abhi@93047")
TEST_USER_PASSWORD = os.environ.get("ADMIN_TEST_USER_PASSWORD", f"Test@{uuid.uuid4().hex[:8]}")

pytestmark = pytest.mark.skipif(
    os.environ.get("SKIP_ADMIN_TESTS", "0").strip().lower() in {"1", "true", "yes", "on"},
    reason="Admin integration tests disabled via SKIP_ADMIN_TESTS",
)


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login as default admin failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    assert token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _rand_email():
    return f"admin_test_{uuid.uuid4().hex[:10]}@example.com"


class TestDefaultAdmin:
    def test_login_returns_must_change_password_flag(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "must_change_password" in data
        assert isinstance(data["must_change_password"], bool)
        assert data["role"] == "Admin"

    def test_seeded_admin_is_listed(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        assert any(u["email"] == ADMIN_EMAIL for u in users), (
            "Seeded default admin should be present in /api/admin/users"
        )
        for u in users:
            assert "password_hash" not in u, "password hashes must never be exposed"
            for key in ("id", "email", "full_name", "role", "active", "must_change_password"):
                assert key in u


class TestAdminProtection:
    def test_list_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/users", timeout=15)
        assert r.status_code == 401

    def test_create_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            json={"email": _rand_email(), "full_name": "X", "role": "Sales", "temp_password": "LongEnough1"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_non_admin_is_forbidden(self, admin_headers):
        # Create a non-admin user, sign in as them, confirm they can't hit /admin.
        email = _rand_email()
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            json={
                "email": email,
                "full_name": "Admin Test Sales",
                "role": "Sales",
                "temp_password": TEST_USER_PASSWORD,
            },
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 201, r.text
        user = r.json()
        try:
            login = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"email": email, "password": TEST_USER_PASSWORD},
                timeout=15,
            )
            assert login.status_code == 200
            sales_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
            r2 = requests.get(f"{BASE_URL}/api/admin/users", headers=sales_headers, timeout=15)
            assert r2.status_code == 403
            r3 = requests.post(
                f"{BASE_URL}/api/admin/users",
                json={"email": _rand_email(), "full_name": "Y", "role": "Sales", "temp_password": "LongEnough1"},
                headers=sales_headers,
                timeout=15,
            )
            assert r3.status_code == 403
        finally:
            # No delete endpoint; leave the account disabled so it can't be used.
            requests.patch(
                f"{BASE_URL}/api/admin/users/{user['id']}",
                json={"active": False},
                headers=admin_headers,
                timeout=15,
            )


class TestAdminUserCRUD:
    def test_create_list_patch_disable(self, admin_headers):
        email = _rand_email()
        r = requests.post(
            f"{BASE_URL}/api/admin/users",
            json={
                "email": email,
                "full_name": "New Hire",
                "role": "Sales",
                "temp_password": TEST_USER_PASSWORD,
            },
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 201, r.text
        user = r.json()
        uid = user["id"]
        assert user["email"] == email
        assert user["must_change_password"] is True, "new users must change password on first login"

        # Appears in the list.
        listed = requests.get(f"{BASE_URL}/api/admin/users", headers=admin_headers, timeout=15).json()
        assert any(u["id"] == uid for u in listed)

        # Duplicate email rejected.
        dup = requests.post(
            f"{BASE_URL}/api/admin/users",
            json={
                "email": email,
                "full_name": "New Hire",
                "role": "Sales",
                "temp_password": TEST_USER_PASSWORD,
            },
            headers=admin_headers,
            timeout=15,
        )
        assert dup.status_code == 409

        # Patch role + name.
        rp = requests.patch(
            f"{BASE_URL}/api/admin/users/{uid}",
            json={"role": "Installation", "full_name": "New Hire II"},
            headers=admin_headers,
            timeout=15,
        )
        assert rp.status_code == 200
        updated = rp.json()
        assert updated["role"] == "Installation"
        assert updated["full_name"] == "New Hire II"

        # Disable, then confirm a login attempt is rejected (403 Account disabled).
        rd = requests.patch(
            f"{BASE_URL}/api/admin/users/{uid}",
            json={"active": False},
            headers=admin_headers,
            timeout=15,
        )
        assert rd.status_code == 200
        assert rd.json()["active"] is False

        login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": TEST_USER_PASSWORD},
            timeout=15,
        )
        assert login.status_code == 403
