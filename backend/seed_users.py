"""
One-time / as-needed script to create or update CRM login users.

Usage (from the backend/ folder, with your .env / MONGO_URL configured):

    python seed_users.py add super@stepsolar.in "Admin User" Admin
    python seed_users.py add sales@stepsolar.in "Sales Person" Sales
    python seed_users.py list
    python seed_users.py disable sales@stepsolar.in
    python seed_users.py delete sales@stepsolar.in

Roles must be one of: Admin, Sales, Site Survey, Installation, Accounts
(these match the CRM pipeline stage owners in server.py / crm.html).

The password is prompted for interactively (not passed as a CLI arg, so it
doesn't end up in shell history).
"""
from __future__ import annotations

import asyncio
import getpass
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
VALID_ROLES = {"Admin", "Sales", "Site Survey", "Installation", "Accounts"}


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    mongo_url = os.environ["MONGO_URL"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ["DB_NAME"]]
    users = db["users"]

    cmd = sys.argv[1]

    if cmd == "add":
        if len(sys.argv) != 5:
            print("Usage: python seed_users.py add <email> <full_name> <role>")
            return
        email, full_name, role = sys.argv[2].strip().lower(), sys.argv[3], sys.argv[4]
        if role not in VALID_ROLES:
            print(f"Role must be one of: {sorted(VALID_ROLES)}")
            return
        password = getpass.getpass(f"Password for {email}: ")
        if len(password) < 8:
            print("Password should be at least 8 characters.")
            return
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords did not match.")
            return

        existing = await users.find_one({"email": email})
        doc = {
            "id": existing["id"] if existing else str(uuid.uuid4()),
            "email": email,
            "full_name": full_name,
            "role": role,
            "password_hash": pwd_context.hash(password),
            "active": True,
        }
        await users.update_one({"email": email}, {"$set": doc}, upsert=True)
        print(f"{'Updated' if existing else 'Created'} user {email} ({role}).")

    elif cmd == "list":
        async for u in users.find({}, {"_id": 0, "password_hash": 0}):
            print(f"{u['email']:<30} {u['role']:<14} active={u.get('active', True)}  {u.get('full_name','')}")

    elif cmd == "disable":
        email = sys.argv[2].strip().lower()
        r = await users.update_one({"email": email}, {"$set": {"active": False}})
        print("Disabled." if r.matched_count else "User not found.")

    elif cmd == "enable":
        email = sys.argv[2].strip().lower()
        r = await users.update_one({"email": email}, {"$set": {"active": True}})
        print("Enabled." if r.matched_count else "User not found.")

    elif cmd == "delete":
        email = sys.argv[2].strip().lower()
        r = await users.delete_one({"email": email})
        print("Deleted." if r.deleted_count else "User not found.")

    else:
        print(__doc__)

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
