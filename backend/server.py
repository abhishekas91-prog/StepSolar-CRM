"""Step Solar — Lead Capture + CRM Backend

- POST /api/leads             public: quotation form submission (auto-assigns code + stages)
- GET  /api/leads             logged-in user: list leads (recent 100)
- GET  /api/leads/stats       logged-in user: totals
- GET  /api/health            integration status

Auth:
- POST /api/auth/login        email + password -> JWT access token (with role claim)

CRM (valid JWT required for all /api/crm/*; stage edits are further
restricted server-side to the stage's owner role, or Admin):
- GET   /api/crm/leads        return every lead (full CRM shape)
- POST  /api/crm/leads        add lead from CRM (auto-code, stages, source=Admin)
- PATCH /api/crm/leads/{id}   partial update (any of: stages, quotation, invoice, contact fields)
- GET   /api/crm/meta         return {nextLeadCode} for display

Admin user management (Admin role only — /api/admin/*):
- GET   /api/admin/users              list all login users (no password hashes)
- POST  /api/admin/users              create user with temp password (forces change on first login)
- PATCH /api/admin/users/{id}         update full_name / role / active / reset_password

Auth flags:
- must_change_password is set on bootstrap admin + newly created users and
  cleared by POST /api/auth/change-password ("force password change on first
  login"). A default admin (super@stepsolar.in / Abhi@93047, env-configurable)
  is auto-seeded idempotently at startup.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pymongo import ReturnDocument
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

from lead_service import (
    SHEET_HEADERS,
    append_lead_to_sheet,
    gmail_enabled,
    send_lead_email,
    sheets_enabled,
)
from services.whatsapp_service import (
    WHATSAPP_EVENTS,
    base_url,
    effective_config,
    fetch_chat_thread,
    notify_stage_event,
    retry_failed_messages,
    send_chat_text,
    send_whatsapp,
    set_runtime_config,
    whatsapp_enabled,
)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("stepsolar")

# --------------------------------------------------------------------------- #
# Mongo
# --------------------------------------------------------------------------- #
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
leads_collection = db["leads"]
meta_collection = db["meta"]
users_collection = db["users"]
documents_collection = db["documents"]
whatsapp_logs_collection = db["whatsapp_logs"]
inventory_collection = db["inventory"]
settings_collection = db["settings"]


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
def _dup_window_min() -> int:
    try:
        return max(0, int(os.environ.get("DUPLICATE_WINDOW_MIN", "10")))
    except ValueError:
        return 10


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# --------------------------------------------------------------------------- #
# CRM pipeline template
# --------------------------------------------------------------------------- #
STAGE_TEMPLATE: List[Dict[str, str]] = [
    {"key": "reg",         "label": "Consumer Registration",     "actor": "Consumer", "owner": "Sales"},
    {"key": "app",         "label": "Consumer Application",       "actor": "Consumer", "owner": "Sales"},
    {"key": "feas",        "label": "Discom Feasibility",         "actor": "Discom",   "owner": "Site Survey"},
    {"key": "vendor",      "label": "Consumer Vendor Selection",  "actor": "Consumer", "owner": "Sales"},
    {"key": "agreement",   "label": "Vendor Upload Agreement",    "actor": "Vendor",   "owner": "Accounts"},
    {"key": "install",     "label": "Vendor Installation",        "actor": "Vendor",   "owner": "Installation"},
    {"key": "inspection",  "label": "Discom Inspection",          "actor": "Discom",   "owner": "Installation"},
    {"key": "commission",  "label": "Project Commissioning",      "actor": "Discom",   "owner": "Installation"},
    {"key": "subsidyreq",  "label": "Consumer Subsidy Request",   "actor": "Consumer", "owner": "Accounts"},
    {"key": "subsidydisb", "label": "Subsidy Disbursal",          "actor": "REC",      "owner": "Accounts"},
]

# Enterprise solar-installation life-cycle pipeline (new leads). Existing
# leads keep whatever stages they were created with (backward compatible).
SOLAR_PIPELINE: List[Dict[str, str]] = [
    {"key": "lead_captured",           "label": "Lead Captured",             "actor": "Customer", "owner": "Sales"},
    {"key": "site_survey_scheduled",   "label": "Site Survey Scheduled",     "actor": "Engineer", "owner": "Sales"},
    {"key": "survey_completed",        "label": "Site Survey Completed",     "actor": "Engineer", "owner": "Site Survey"},
    {"key": "quotation_sent",          "label": "Quotation Sent",            "actor": "Sales",    "owner": "Sales"},
    {"key": "docs_verified",           "label": "Documents Verified",        "actor": "Accounts", "owner": "Accounts"},
    {"key": "discom_applied",          "label": "DISCOM Application",        "actor": "Discom",   "owner": "Accounts"},
    {"key": "material_dispatched",     "label": "Material Dispatched",       "actor": "Vendor",   "owner": "Installation"},
    {"key": "installation_in_progress", "label": "Installation In Progress", "actor": "Engineer", "owner": "Installation"},
    {"key": "net_metering_pending",    "label": "Net Metering Pending",      "actor": "Discom",   "owner": "Installation"},
    {"key": "commissioned",            "label": "Commissioned",              "actor": "Discom",   "owner": "Installation"},
    {"key": "subsidy_disbursed",       "label": "Subsidy Disbursed",         "actor": "REC",      "owner": "Accounts"},
]

PIPELINES = {"solar": SOLAR_PIPELINE, "legacy": STAGE_TEMPLATE}


def _fresh_stages(pipeline: str = "solar") -> List[Dict[str, Any]]:
    template = PIPELINES.get(pipeline, SOLAR_PIPELINE)
    return [
        {**t, "status": "Pending", "updatedAt": None, "notes": "", "documents": []}
        for t in template
    ]


# Life-cycle milestones that fire a WhatsApp notification to the customer.
# key -> (event, trigger_status). site_survey_scheduled fires as soon as the
# slot is set (In Progress); everything else fires on completion.
_WHATSAPP_STAGE_EVENTS: Dict[str, tuple] = {
    "lead_captured":            ("LEAD_CAPTURED", "In Progress"),
    "site_survey_scheduled":    ("SITE_SURVEY_SCHEDULED", "In Progress"),
    "survey_completed":         ("SURVEY_COMPLETED", "Completed"),
    "quotation_sent":           ("QUOTATION_SENT", "Completed"),
    "docs_verified":            ("DOCS_VERIFIED", "Completed"),
    "discom_applied":           ("DISCOM_APPLIED", "Completed"),
    "material_dispatched":      ("MATERIAL_DISPATCHED", "Completed"),
    "installation_in_progress": ("INSTALLATION_IN_PROGRESS", "Completed"),
    "net_metering_pending":     ("NET_METERING_PENDING", "Completed"),
    "commissioned":             ("COMMISSIONED", "Completed"),
    "subsidy_disbursed":        ("SUBSIDY_DISBURSED", "Completed"),
}


VALID_ROLES = {"Admin", "Sales", "Site Survey", "Installation", "Accounts"}


async def _next_lead_code() -> str:
    """Atomically increment the lead counter and return the formatted code."""
    doc = await meta_collection.find_one_and_update(
        {"_id": "counters"},
        {"$inc": {"nextLeadNo": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    # If it was just upserted, $inc set it to 1; that becomes SSE-0001
    n = int(doc.get("nextLeadNo", 1))
    return f"SSE-{n:04d}"


def _current_fy(now: datetime) -> str:
    """Indian financial year string, e.g. 2025-26 (Apr 2025 .. Mar 2026)."""
    if now.month >= 4:
        return f"{now.year}-{str(now.year + 1)[-2:]}"
    return f"{now.year - 1}-{str(now.year)[-2:]}"


async def _next_invoice_no() -> str:
    """Atomically increment the invoice counter and return SSE/FY/SEQ."""
    now = datetime.now(timezone.utc)
    fy = _current_fy(now)
    counter_id = f"invoice-{fy}"
    doc = await meta_collection.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = int(doc.get("seq", 1))
    return f"SSE/{fy}/{seq:04d}"


async def _next_payment_receipt_no() -> str:
    now = datetime.now(timezone.utc)
    fy = _current_fy(now)
    counter_id = f"receipt-{fy}"
    doc = await meta_collection.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = int(doc.get("seq", 1))
    return f"REC/{fy}/{seq:04d}"


async def _get_lead_or_404(lead_id: str) -> Dict[str, Any]:
    lead = await leads_collection.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


def _log_activity(
    user: CurrentUser,
    action: str,
    detail: str,
) -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "user_id": user.id,
        "user_name": user.full_name or user.email,
        "role": user.role,
        "action": action,
        "detail": detail,
        "at": datetime.now(timezone.utc).isoformat(),
    }


async def _push_activity(lead_id: str, user: CurrentUser, action: str, detail: str) -> None:
    await leads_collection.update_one(
        {"id": lead_id},
        {"$push": {"activity": _log_activity(user, action, detail)}},
    )


def _new_tracking_token() -> str:
    """Random, unguessable token for the customer-facing tracking portal."""
    return uuid.uuid4().hex + uuid.uuid4().hex


async def _notify_whatsapp(
    lead: Dict[str, Any],
    event: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fire a WhatsApp notification safely — never breaks the CRM call."""
    try:
        return await notify_stage_event(
            whatsapp_logs_collection, lead, event, extra
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("WhatsApp notify(%s) raised: %s", event, e)
        return {"ok": False, "status": "ERROR", "error": str(e)}


def _tracking_url(lead: Dict[str, Any]) -> Optional[str]:
    token = lead.get("tracking_token")
    if not token:
        return None
    return f"{base_url()}/track/{token}"


def _can_assign(role: str) -> bool:
    return role in {"Admin", "Sales"}


def _can_quotation(role: str) -> bool:
    """Create/edit/approve quotations."""
    return role in {"Admin", "Sales", "Accounts"}


def _can_invoice(role: str) -> bool:
    """Create invoices and record payments."""
    return role in {"Admin", "Accounts", "Sales"}


def _can_manage_docs(role: str) -> bool:
    return role in {"Admin", "Sales", "Site Survey", "Installation", "Accounts"}


# --------------------------------------------------------------------------- #
# Auth — per-user login with JWT (replaces the old shared ADMIN_TOKEN)
# --------------------------------------------------------------------------- #
JWT_SECRET = os.environ["JWT_SECRET"]  # required — generate with `openssl rand -hex 32`
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))  # 8h default

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    id: str
    email: str
    full_name: str
    role: str
    must_change_password: bool = False
    expires_in_minutes: int


class CurrentUser(BaseModel):
    id: str
    email: str
    full_name: str
    role: str


def _create_access_token(user: Dict[str, Any]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "full_name": user.get("full_name", ""),
        "role": user["role"],
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> CurrentUser:
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    role = payload.get("role")
    if role not in VALID_ROLES:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token role")
    return CurrentUser(
        id=payload.get("sub", ""),
        email=payload.get("email", ""),
        full_name=payload.get("full_name", ""),
        role=role,
    )


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role != "Admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
PHONE_RE = re.compile(r"^[6-9]\d{9}$")
PIN_RE = re.compile(r"^\d{6}$")

PROPERTY_TYPES = {
    "Residential",
    "Commercial / Office",
    "Industrial / Factory",
    "Agricultural / Pump",
}
ROOF_TYPES = {
    "Rented Roof / No Roof",
    "Small Space (100-200 sq. ft.)",
    "Medium Space (300-500 sq. ft.)",
    "Large Open Roof (500+ sq. ft.)",
}
TIMELINES = {
    "Immediately",
    "Within 1-2 months",
    "Sirf jankari aur quotation chahiye",
}


class LeadCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(..., min_length=2, max_length=120)
    phone: str
    email: EmailStr
    state: str = Field(..., min_length=2, max_length=80)
    city: str = Field(..., min_length=2, max_length=80)
    pincode: str
    property_type: str
    monthly_bill: int = Field(..., ge=0, le=10_000_000)
    roof_type: str
    timeline: str
    source: Optional[str] = Field(default="website", max_length=60)

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v: str) -> str:
        v = re.sub(r"\D", "", v or "")
        if not PHONE_RE.match(v):
            raise ValueError("phone must be a valid 10-digit Indian mobile number")
        return v

    @field_validator("pincode")
    @classmethod
    def _v_pin(cls, v: str) -> str:
        v = (v or "").strip()
        if not PIN_RE.match(v):
            raise ValueError("pincode must be exactly 6 digits")
        return v

    @field_validator("property_type")
    @classmethod
    def _v_prop(cls, v: str) -> str:
        if v not in PROPERTY_TYPES:
            raise ValueError(f"property_type must be one of {sorted(PROPERTY_TYPES)}")
        return v

    @field_validator("roof_type")
    @classmethod
    def _v_roof(cls, v: str) -> str:
        v = v.replace("\u2013", "-").replace("\u2014", "-")
        if v not in ROOF_TYPES:
            raise ValueError(f"roof_type must be one of {sorted(ROOF_TYPES)}")
        return v

    @field_validator("timeline")
    @classmethod
    def _v_timeline(cls, v: str) -> str:
        v = v.replace("\u2013", "-").replace("\u2014", "-")
        if v not in TIMELINES:
            raise ValueError(f"timeline must be one of {sorted(TIMELINES)}")
        return v


class LeadResponse(BaseModel):
    ok: bool
    id: str
    code: str
    message: str
    sheet_synced: bool
    email_sent: bool


# --------------------------------------------------------------------------- #
# FastAPI app
# --------------------------------------------------------------------------- #
app = FastAPI(title="Step Solar — Lead Capture + CRM API")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"service": "Step Solar Lead + CRM API", "status": "ok"}


@api.get("/health")
async def health():
    return {
        "status": "ok",
        "integrations": {
            "mongodb": True,
            "google_sheets": sheets_enabled(),
            "gmail": gmail_enabled(),
            "whatsapp": whatsapp_enabled(),
        },
        "duplicate_window_min": _dup_window_min(),
    }


# --------------------------------------------------------------------------- #
# Auth endpoints
# --------------------------------------------------------------------------- #
@api.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest):
    user = await users_collection.find_one({"email": payload.email.lower()})
    if not user or not pwd_context.verify(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account is disabled")
    token = _create_access_token(
        {"id": user["id"], "email": user["email"], "full_name": user.get("full_name", ""), "role": user["role"]}
    )
    return LoginResponse(
        access_token=token,
        id=user["id"],
        email=user["email"],
        full_name=user.get("full_name", ""),
        role=user["role"],
        must_change_password=bool(user.get("must_change_password", False)),
        expires_in_minutes=JWT_EXPIRE_MINUTES,
    )


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=8, max_length=200)


@api.post("/auth/change-password")
async def change_password(payload: ChangePasswordRequest, user: CurrentUser = Depends(get_current_user)):
    doc = await users_collection.find_one({"id": user.id})
    if not doc or not pwd_context.verify(payload.current_password, doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    await users_collection.update_one(
        {"id": user.id},
        {"$set": {"password_hash": pwd_context.hash(payload.new_password), "must_change_password": False}},
    )
    return {"ok": True}


@api.get("/auth/me", response_model=CurrentUser)
async def me(user: CurrentUser = Depends(get_current_user)):
    return user


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _is_duplicate(phone: str, email: str, window_min: int) -> bool:
    if window_min <= 0:
        return False
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=window_min)).isoformat()
    existing = await leads_collection.find_one(
        {
            "$and": [
                {"$or": [{"phone": phone}, {"email": email.lower()}]},
                {"created_at": {"$gte": cutoff}},
            ]
        },
        {"_id": 0, "id": 1},
    )
    return existing is not None


def _clean(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc.pop("_id", None)
    return doc


def _json_safe(value: Any) -> Any:
    """Make Mongo documents JSON-serializable so the CRM list never 500s."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, bytes):
        return None
    return str(value)


# --------------------------------------------------------------------------- #
# Public: website form
# --------------------------------------------------------------------------- #
@api.post("/leads", response_model=LeadResponse, status_code=status.HTTP_201_CREATED)
async def create_lead(payload: LeadCreate, request: Request):
    if await _is_duplicate(payload.phone, payload.email, _dup_window_min()):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "We already received a request from this phone/email a few minutes ago. "
                "Our team will call you shortly."
            ),
        )

    lead_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    ip = _client_ip(request)
    ua = request.headers.get("user-agent", "")[:400]
    code = await _next_lead_code()

    stages = _fresh_stages()
    stages[0]["status"] = "In Progress"
    stages[0]["updatedAt"] = now_iso
    stages[0]["notes"] = "Auto-created from website enquiry form."

    doc = {
        "id": lead_id,
        "code": code,
        "full_name": payload.full_name,
        "phone": payload.phone,
        "email": payload.email.lower(),
        "state": payload.state,
        "city": payload.city,
        "pincode": payload.pincode,
        "property_type": payload.property_type,
        "monthly_bill": payload.monthly_bill,
        "roof_type": payload.roof_type,
        "timeline": payload.timeline,
        "source": payload.source or "website",
        "ip": ip,
        "user_agent": ua,
        "created_at": now_iso,
        "updated_at": now_iso,
        "stages": stages,
        "quotation": None,
        "invoice": None,
        "assigned_to": None,
        "assigned_name": None,
        "comments": [],
        "tasks": [],
        "activity": [],
        "sheet_synced": False,
        "email_sent": False,
        "sheet_error": None,
        "email_error": None,
    }
    await leads_collection.insert_one(doc)

    # External sync (feature-flagged) — parallel
    row = [
        now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        doc["full_name"], doc["phone"], doc["email"],
        doc["state"], doc["city"], doc["pincode"],
        doc["property_type"], doc["monthly_bill"],
        doc["roof_type"], doc["timeline"],
        doc["source"], doc["ip"],
    ]
    sheet_task = asyncio.to_thread(append_lead_to_sheet, row)
    email_task = asyncio.to_thread(send_lead_email, doc)
    sheet_result, email_result = await asyncio.gather(sheet_task, email_task)

    update_fields = {
        "sheet_synced": bool(sheet_result.get("ok")),
        "email_sent": bool(email_result.get("ok")),
        "sheet_error": None if sheet_result.get("ok") else sheet_result.get("error"),
        "email_error": None if email_result.get("ok") else email_result.get("error"),
    }
    await leads_collection.update_one({"id": lead_id}, {"$set": update_fields})

    return LeadResponse(
        ok=True,
        id=lead_id,
        code=code,
        message="Thank you! Our team will contact you shortly to schedule a free site survey.",
        sheet_synced=update_fields["sheet_synced"],
        email_sent=update_fields["email_sent"],
    )


# --------------------------------------------------------------------------- #
# Service-to-service: WhatsApp bot lead lookup
#
# Separate from the JWT-based CurrentUser auth used everywhere else — the
# WA bot (WaCrmStepSolar_Live) has no human login, just a shared secret
# in the X-Service-Key header. Set LEAD_LOOKUP_SERVICE_KEY in .env to a
# random string and give the bot the same value. Leave it unset to keep
# this endpoint disabled (every call 401s).
# --------------------------------------------------------------------------- #
LEAD_LOOKUP_SERVICE_KEY = os.environ.get("LEAD_LOOKUP_SERVICE_KEY", "")


def _verify_service_key(x_service_key: Optional[str] = Header(default=None)):
    if not LEAD_LOOKUP_SERVICE_KEY or x_service_key != LEAD_LOOKUP_SERVICE_KEY:
        raise HTTPException(status_code=401, detail="invalid service key")


@api.get("/leads/lookup")
async def lookup_lead_by_phone(
    phone: str = Query(..., min_length=10, max_length=10),
    _: None = Depends(_verify_service_key),
):
    """Most-recent lead for this phone number, any age (unlike the
    website form's `_is_duplicate`, which only looks back a few
    minutes). Used by the WA bot to decide: start the lead-capture
    flow, or reply with the existing lead's status."""
    clean_phone = re.sub(r"\D", "", phone)
    lead = await leads_collection.find_one(
        {"phone": clean_phone},
        {
            "_id": 0,
            "id": 1,
            "code": 1,
            "full_name": 1,
            "stages": 1,
            "assigned_name": 1,
            "created_at": 1,
        },
        sort=[("created_at", -1)],
    )
    if not lead:
        raise HTTPException(status_code=404, detail="no lead found")
    return lead


# --------------------------------------------------------------------------- #
# Legacy admin endpoints
# --------------------------------------------------------------------------- #
@api.get("/leads")
async def list_leads(
    limit: int = Query(default=100, ge=1, le=500),
    user: CurrentUser = Depends(get_current_user),
):
    cursor = leads_collection.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return [_json_safe(item) for item in items]


@api.get("/leads/stats")
async def leads_stats(user: CurrentUser = Depends(get_current_user)):
    total = await leads_collection.count_documents({})
    today_start = (
        datetime.now(timezone.utc)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .isoformat()
    )
    today = await leads_collection.count_documents({"created_at": {"$gte": today_start}})
    return {"total": total, "today": today, "sheet_headers": SHEET_HEADERS}


# --------------------------------------------------------------------------- #
# CRM endpoints
# --------------------------------------------------------------------------- #
crm = APIRouter(prefix="/crm")

# Field allow-list for PATCH updates
_PATCHABLE = {
    "full_name", "phone", "email", "state", "city", "pincode",
    "property_type", "monthly_bill", "roof_type", "timeline",
    "source", "stages", "quotation", "invoice", "notes",
}

_VALID_STAGE_STATUSES = {"Pending", "In Progress", "Completed"}
_STAGE_KEYS_BY_INDEX = [t["key"] for t in STAGE_TEMPLATE]


class LeadPatch(BaseModel):
    """Validated shape for PATCH /crm/leads/{id}. Only fields the client
    actually sent are applied (exclude_unset), so a partial patch still
    works — but whatever IS sent must have the right shape. This replaces
    accepting a raw Dict[str, Any], which let a caller send e.g. stages as
    a string/number and silently corrupt the document the frontend expects
    to always be an array of stage objects."""

    model_config = ConfigDict(extra="ignore")

    full_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    state: Optional[str] = Field(default=None, min_length=2, max_length=80)
    city: Optional[str] = Field(default=None, min_length=2, max_length=80)
    pincode: Optional[str] = None
    property_type: Optional[str] = None
    monthly_bill: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    roof_type: Optional[str] = None
    timeline: Optional[str] = None
    source: Optional[str] = Field(default=None, max_length=60)
    notes: Optional[str] = Field(default=None, max_length=4000)
    stages: Optional[List[Dict[str, Any]]] = None
    quotation: Optional[Dict[str, Any]] = None
    invoice: Optional[Dict[str, Any]] = None

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        digits = re.sub(r"\D", "", v)
        if not PHONE_RE.match(digits):
            raise ValueError("phone must be a valid 10-digit Indian mobile number")
        return digits

    @field_validator("pincode")
    @classmethod
    def _v_pin(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not PIN_RE.match(v.strip()):
            raise ValueError("pincode must be exactly 6 digits")
        return v.strip()

    @field_validator("property_type")
    @classmethod
    def _v_prop(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in PROPERTY_TYPES:
            raise ValueError(f"property_type must be one of {sorted(PROPERTY_TYPES)}")
        return v

    @field_validator("stages")
    @classmethod
    def _v_stages(cls, v: Optional[List[Dict[str, Any]]]) -> Optional[List[Dict[str, Any]]]:
        if v is None:
            return v
        if not v:
            raise ValueError("stages must be a non-empty array")
        keys = [t["key"] for t in STAGE_TEMPLATE] + [t["key"] for t in SOLAR_PIPELINE]
        if len(v) != len(STAGE_TEMPLATE) and len(v) != len(SOLAR_PIPELINE):
            raise ValueError(
                f"stages must contain {len(STAGE_TEMPLATE)} or {len(SOLAR_PIPELINE)} entries"
            )
        for idx, stage in enumerate(v):
            if not isinstance(stage, dict):
                raise ValueError(f"stages[{idx}] must be an object")
            key = stage.get("key")
            if key not in keys:
                raise ValueError(f"stages[{idx}].key '{key}' is not a known stage key")
            status_val = stage.get("status")
            if status_val not in _VALID_STAGE_STATUSES:
                raise ValueError(f"stages[{idx}].status must be one of {sorted(_VALID_STAGE_STATUSES)}")
        return v


# --------------------------------------------------------------------------- #
# CRM v2 models — assignment, comments, tasks, quotation status, payments
# --------------------------------------------------------------------------- #
class AssignRequest(BaseModel):
    assigned_to: Optional[str] = Field(default=None, max_length=80)
    note: Optional[str] = Field(default=None, max_length=1000)


class CommentCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    due_at: Optional[str] = Field(default=None, max_length=40)
    assigned_to: Optional[str] = Field(default=None, max_length=80)


class TaskPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    due_at: Optional[str] = Field(default=None, max_length=40)
    assigned_to: Optional[str] = Field(default=None, max_length=80)
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _v_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in {"open", "done"}:
            raise ValueError("task status must be 'open' or 'done'")
        return v


class QuotationStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _v_status(cls, v: str) -> str:
        if v not in {"Draft", "Sent", "Approved", "Rejected"}:
            raise ValueError("quotation status must be one of Draft, Sent, Approved, Rejected")
        return v


class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    mode: str = Field(..., min_length=1, max_length=40)
    reference: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=1000)


@crm.get("/meta")
async def crm_meta(user: CurrentUser = Depends(get_current_user)):
    m = await meta_collection.find_one({"_id": "counters"})
    last = int((m or {}).get("nextLeadNo", 0))
    next_no = last + 1
    return {
        "lastIssuedLeadNo": last,
        "lastIssuedLeadCode": f"SSE-{last:04d}" if last > 0 else None,
        "nextLeadNo": next_no,
        "nextLeadCode": f"SSE-{next_no:04d}",
    }


@crm.get("/leads")
async def crm_list_leads(
    limit: int = Query(default=500, ge=1, le=5000),
    user: CurrentUser = Depends(get_current_user),
):
    cursor = leads_collection.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return [_json_safe(item) for item in items]


class CRMLeadCreate(BaseModel):
    """CRM lead intake — name/phone/email required; rest can be filled later."""
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(..., min_length=2, max_length=120)
    phone: str
    email: EmailStr
    state: Optional[str] = Field(default="", max_length=80)
    city: Optional[str] = Field(default="", max_length=80)
    pincode: Optional[str] = Field(default="")
    property_type: Optional[str] = None
    monthly_bill: int = Field(default=0, ge=0, le=10_000_000)
    roof_type: Optional[str] = None
    timeline: Optional[str] = None
    source: Optional[str] = Field(default="Admin", max_length=60)
    notes: Optional[str] = Field(default="", max_length=4000)

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v: str) -> str:
        v = re.sub(r"\D", "", v or "")
        if not PHONE_RE.match(v):
            raise ValueError("phone must be a valid 10-digit Indian mobile number")
        return v

    @field_validator("pincode")
    @classmethod
    def _v_pin(cls, v: Optional[str]) -> str:
        v = (v or "").strip()
        if not v:
            return ""
        if not PIN_RE.match(v):
            raise ValueError("pincode must be exactly 6 digits")
        return v

    @field_validator("property_type")
    @classmethod
    def _v_prop(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        if v not in PROPERTY_TYPES:
            raise ValueError(f"property_type must be one of {sorted(PROPERTY_TYPES)}")
        return v

    @field_validator("roof_type")
    @classmethod
    def _v_roof(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        v = v.replace("\u2013", "-").replace("\u2014", "-")
        if v not in ROOF_TYPES:
            raise ValueError(f"roof_type must be one of {sorted(ROOF_TYPES)}")
        return v

    @field_validator("timeline")
    @classmethod
    def _v_timeline(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        v = v.replace("\u2013", "-").replace("\u2014", "-")
        if v not in TIMELINES:
            raise ValueError(f"timeline must be one of {sorted(TIMELINES)}")
        return v


@crm.post("/leads")
async def crm_create_lead(
    payload: CRMLeadCreate,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    lead_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    code = await _next_lead_code()

    stages = _fresh_stages("solar")
    stages[0]["status"] = "In Progress"
    stages[0]["updatedAt"] = now_iso

    doc = {
        "id": lead_id,
        "code": code,
        "pipeline": "solar",
        "tracking_token": _new_tracking_token(),
        "tracking_visible": True,
        "full_name": payload.full_name,
        "phone": payload.phone,
        "email": payload.email.lower(),
        "state": payload.state,
        "city": payload.city,
        "pincode": payload.pincode,
        "property_type": payload.property_type,
        "monthly_bill": payload.monthly_bill,
        "roof_type": payload.roof_type,
        "timeline": payload.timeline,
        "source": payload.source or "Admin",
        "notes": payload.notes or "",
        "ip": _client_ip(request),
        "user_agent": request.headers.get("user-agent", "")[:400],
        "created_at": now_iso,
        "updated_at": now_iso,
        "stages": stages,
        "solar": None,
        "site_survey": None,
        "inventory": [],
        "quotation": None,
        "invoice": None,
        "assigned_to": None,
        "assigned_name": None,
        "comments": [],
        "tasks": [],
        "activity": [],
        "sheet_synced": False,
        "email_sent": False,
        "sheet_error": None,
        "email_error": None,
    }
    await leads_collection.insert_one(doc)
    await _notify_whatsapp(doc, "LEAD_CAPTURED")
    return _clean(doc)


@crm.patch("/leads/{lead_id}")
async def crm_patch_lead(
    lead_id: str,
    body: LeadPatch,
    user: CurrentUser = Depends(get_current_user),
):
    update = {
        k: v for k, v in body.model_dump(exclude_unset=True).items() if k in _PATCHABLE
    }
    if "email" in update and update["email"] is not None:
        update["email"] = str(update["email"]).lower()
    if not update:
        raise HTTPException(status_code=400, detail="No patchable fields provided")

    # Non-Admin, non-contact-detail fields (stages) are further restricted:
    # a user may only change the stage(s) owned by their own role. This is
    # the real enforcement — the "Viewing as" role picker in the UI is only
    # a convenience; without this check any authenticated user could edit
    # any stage regardless of who owns it.
    existing_lead = None
    if "stages" in update:
        existing_lead = await leads_collection.find_one(
            {"id": lead_id}, {"_id": 0, "stages": 1, "pipeline": 1}
        )
        if not existing_lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        existing_stages = existing_lead.get("stages") or []

        # The submitted stage keys must exactly match the lead's own pipeline
        # (in order) so a caller cannot reorder stages to bypass ownership.
        submitted_keys = [s.get("key") for s in update["stages"]]
        existing_keys = [s.get("key") for s in existing_stages]
        if submitted_keys != existing_keys:
            raise HTTPException(
                status_code=400,
                detail="stages must preserve the lead's pipeline order",
            )

        if user.role != "Admin":
            for idx, new_stage in enumerate(update["stages"]):
                old_stage = existing_stages[idx] if idx < len(existing_stages) else {}
                if new_stage != old_stage and new_stage.get("owner") != user.role:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=(
                            f"Stage '{new_stage.get('label', new_stage.get('key'))}' is owned by "
                            f"'{new_stage.get('owner')}' team — your role '{user.role}' cannot edit it."
                        ),
                    )

    # Quotation edits are restricted to quotation-capable roles and bump the
    # revision counter so every substantive change is versioned.
    if "quotation" in update:
        if not _can_quotation(user.role):
            raise HTTPException(status_code=403, detail="Quotation edits require Sales, Accounts or Admin")
        existing = await leads_collection.find_one({"id": lead_id}, {"_id": 0, "quotation": 1})
        if existing and existing.get("quotation") and existing["quotation"] != update["quotation"]:
            old_rev = int(existing["quotation"].get("revision", 1))
            update["quotation"]["revision"] = old_rev + 1
            update["quotation"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
        elif existing and not existing.get("quotation"):
            update["quotation"]["revision"] = 1
            update["quotation"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
        update["quotation"] = _finalize_quotation(update["quotation"])

    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": update},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Activity trail for the changed bits
    for key in ("stages", "quotation", "invoice", "notes"):
        if key in update:
            if key == "stages":
                changed = [
                    f"{s.get('label', s.get('key'))}:{s.get('status', '')}"
                    for s in update["stages"] if s.get("status")
                ]
                detail = ", ".join(changed[:8]) or "stage fields updated"
            elif key == "quotation":
                detail = f"Quotation updated (revision {update['quotation'].get('revision', '?')})"
            elif key == "invoice":
                detail = "Invoice details updated"
            else:
                detail = "Lead notes updated"
            await _push_activity(lead_id, user, f"{key}.updated", detail)

    # WhatsApp notifications for life-cycle milestone transitions.
    if "stages" in update and existing_lead is not None:
        old_stages = existing_lead.get("stages") or []
        new_stages = update["stages"]
        survey_extra: Dict[str, Any] = {}
        if result.get("site_survey") and result["site_survey"].get("scheduled_at"):
            survey_extra["when"] = result["site_survey"]["scheduled_at"]
        survey_extra["link"] = _tracking_url(result) or ""
        for idx, new_stage in enumerate(new_stages):
            old_status = (old_stages[idx] or {}).get("status") if idx < len(old_stages) else None
            new_status = new_stage.get("status")
            if new_status == old_status:
                continue
            evt = _WHATSAPP_STAGE_EVENTS.get(new_stage.get("key"))
            if evt and new_status == evt[1]:
                await _notify_whatsapp(result, evt[0], survey_extra)
    return result


# --------------------------------------------------------------------------- #
# CRM v2 — team directory, assignment, comments, tasks
# --------------------------------------------------------------------------- #
@crm.get("/users")
async def crm_list_users(user: CurrentUser = Depends(get_current_user)):
    """Active team directory used for lead assignment / task assignment."""
    cursor = users_collection.find(
        {"active": True}, {"_id": 0, "id": 1, "full_name": 1, "email": 1, "role": 1}
    )
    out = []
    async for d in cursor:
        out.append(
            {"id": d["id"], "full_name": d.get("full_name", ""), "email": d["email"], "role": d["role"]}
        )
    out.sort(key=lambda u: (u["role"], u["full_name"]))
    return out


@crm.post("/leads/{lead_id}/assign")
async def crm_assign_lead(
    lead_id: str,
    payload: AssignRequest,
    user: CurrentUser = Depends(get_current_user),
):
    if not _can_assign(user.role):
        raise HTTPException(status_code=403, detail="Only Admin or Sales can assign leads")

    lead = await _get_lead_or_404(lead_id)
    assigned_name = None
    if payload.assigned_to:
        target = await users_collection.find_one(
            {"id": payload.assigned_to, "active": True},
            {"_id": 0, "full_name": 1, "email": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="Assigned team member not found or inactive")
        assigned_name = target.get("full_name") or target["email"]

    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": {
            "assigned_to": payload.assigned_to or None,
            "assigned_name": assigned_name,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")

    detail = (
        f"Assigned to {assigned_name or 'nobody'}"
        + (f" — {payload.note}" if payload.note else "")
    )
    await _push_activity(lead_id, user, "lead.assigned", detail)
    return result


@crm.post("/leads/{lead_id}/comments")
async def crm_add_comment(
    lead_id: str,
    payload: CommentCreate,
    user: CurrentUser = Depends(get_current_user),
):
    await _get_lead_or_404(lead_id)
    comment = {
        "id": str(uuid.uuid4()),
        "user_id": user.id,
        "user_name": user.full_name or user.email,
        "role": user.role,
        "text": payload.text,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$push": {"comments": comment}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "comment.added", payload.text[:200])
    return result


@crm.post("/leads/{lead_id}/tasks")
async def crm_create_task(
    lead_id: str,
    payload: TaskCreate,
    user: CurrentUser = Depends(get_current_user),
):
    await _get_lead_or_404(lead_id)
    task = {
        "id": str(uuid.uuid4()),
        "title": payload.title,
        "due_at": payload.due_at,
        "assigned_to": payload.assigned_to,
        "assigned_name": None,
        "status": "open",
        "created_by": user.id,
        "created_by_name": user.full_name or user.email,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "completed_by": None,
    }
    if payload.assigned_to:
        target = await users_collection.find_one(
            {"id": payload.assigned_to, "active": True},
            {"_id": 0, "full_name": 1, "email": 1},
        )
        if target:
            task["assigned_name"] = target.get("full_name") or target["email"]
    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$push": {"tasks": task}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "task.created", payload.title[:200])
    return result


@crm.patch("/leads/{lead_id}/tasks/{task_id}")
async def crm_update_task(
    lead_id: str,
    task_id: str,
    payload: TaskPatch,
    user: CurrentUser = Depends(get_current_user),
):
    lead = await _get_lead_or_404(lead_id)
    tasks = lead.get("tasks") or []
    task = next((t for t in tasks if t.get("id") == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_dict = payload.model_dump(exclude_unset=True)
    update_dict.pop("assigned_to", None)
    if payload.assigned_to is not None:
        if payload.assigned_to:
            target = await users_collection.find_one(
                {"id": payload.assigned_to, "active": True},
                {"_id": 0, "full_name": 1, "email": 1},
            )
            update_dict["assigned_to"] = payload.assigned_to
            update_dict["assigned_name"] = (target or {}).get("full_name") or (
                (target or {}).get("email") if target else None
            )
        else:
            update_dict["assigned_to"] = None
            update_dict["assigned_name"] = None

    now_iso = datetime.now(timezone.utc).isoformat()
    if payload.status == "done" and task.get("status") != "done":
        update_dict["completed_at"] = now_iso
        update_dict["completed_by"] = user.id
    if payload.status == "open" and task.get("status") == "done":
        update_dict["completed_at"] = None
        update_dict["completed_by"] = None

    result = await leads_collection.find_one_and_update(
        {"id": lead_id, "tasks.id": task_id},
        {"$set": {**{f"tasks.$.{k}": v for k, v in update_dict.items()},
                  "updated_at": now_iso}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    await _push_activity(
        lead_id, user, "task.updated",
        f"{task.get('title', 'Task')[:120]} → {update_dict.get('status', 'updated')}",
    )
    return result


@crm.delete("/leads/{lead_id}/tasks/{task_id}")
async def crm_delete_task(
    lead_id: str,
    task_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    lead = await _get_lead_or_404(lead_id)
    task = next((t for t in (lead.get("tasks") or []) if t.get("id") == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if user.role != "Admin" and task.get("created_by") != user.id:
        raise HTTPException(status_code=403, detail="Only Admin or the task creator can delete this task")
    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$pull": {"tasks": {"id": task_id}},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "task.deleted", task.get("title", "Task")[:200])
    return result


# --------------------------------------------------------------------------- #
# CRM v2 — quotation approval workflow
# --------------------------------------------------------------------------- #
@crm.post("/leads/{lead_id}/quotation/status")
async def crm_quotation_status(
    lead_id: str,
    payload: QuotationStatusUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    if not _can_quotation(user.role):
        raise HTTPException(status_code=403, detail="Quotation workflow requires Sales, Accounts or Admin")
    lead = await _get_lead_or_404(lead_id)
    if not lead.get("quotation"):
        raise HTTPException(status_code=400, detail="Create a quotation first")

    new_q = dict(lead["quotation"])
    new_q["status"] = payload.status
    new_q["statusChangedBy"] = user.full_name or user.email
    new_q["statusChangedAt"] = datetime.now(timezone.utc).isoformat()

    # Keep a version snapshot whenever the quotation is sent/approved/rejected.
    history = list(lead.get("quotation_history") or [])
    history.append({
        "id": str(uuid.uuid4()),
        "revision": int(new_q.get("revision", 1)),
        "status": payload.status,
        "by": user.full_name or user.email,
        "at": new_q["statusChangedAt"],
        "snapshot": new_q,
    })
    # Cap history to last 20 snapshots to keep lead docs small.
    history = history[-20:]

    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": {"quotation": new_q, "quotation_history": history,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "quotation.status", f"Quotation marked {payload.status}")
    if payload.status == "Sent":
        await _notify_whatsapp(result, "QUOTATION_SENT", {"link": _tracking_url(result) or ""})
    return result


# --------------------------------------------------------------------------- #
# CRM v2 — invoice creation (atomic number) + payment ledger
# --------------------------------------------------------------------------- #
@crm.post("/leads/{lead_id}/invoice")
async def crm_create_invoice(
    lead_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    if not _can_invoice(user.role):
        raise HTTPException(status_code=403, detail="Invoice creation requires Accounts, Sales or Admin")
    lead = await _get_lead_or_404(lead_id)
    if not lead.get("quotation"):
        raise HTTPException(status_code=400, detail="Create a quotation before generating an invoice")

    # Require quotation approval (unless Admin overrides for legacy flow).
    q_status = lead["quotation"].get("status")
    if q_status != "Approved" and user.role != "Admin":
        raise HTTPException(
            status_code=400,
            detail="Quotation must be Approved before generating the invoice (or ask an Admin).",
        )

    q = lead["quotation"]
    items = q.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="Quotation has no line items to invoice")

    gst_percent = float(q.get("gstPercent") or q.get("gstPct") or 0)
    totals = _document_totals(items, gst_percent)
    if q.get("kind") == "commercial":
        ct = _commercial_totals(q)
        totals["subtotal"] = ct["subtotal"]
        totals["gstAmount"] = ct["gstAmount"]
        totals["grandTotal"] = ct["grandTotal"]
        gst_percent = ct["gstPercent"]

    number = await _next_invoice_no()
    now_iso = datetime.now(timezone.utc).isoformat()
    invoice = {
        "number": number,
        "createdAt": now_iso,
        "kind": "invoice",
        "items": totals["items"],
        "gstPercent": gst_percent,
        "subtotal": totals["subtotal"],
        "gstAmount": totals["gstAmount"],
        "grandTotal": totals["grandTotal"],
        "custAddress": q.get("custAddress"),
        "branchAddress": q.get("branchAddress"),
        "branchPhone": q.get("branchPhone"),
        "payMode": q.get("payMode") or "Online",
        "paymentStatus": "Unpaid",
        "payments": [],
        "paidAmount": 0.0,
        "basedOnQuotationRevision": int(q.get("revision", 1)),
        "template": "invoice.html",
    }

    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": {"invoice": invoice, "updated_at": now_iso}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "invoice.created", f"Invoice {number} generated")
    return result


def _item_price(it: Dict[str, Any]) -> float:
    if it.get("price") is not None and it.get("price") != "":
        try:
            return float(it.get("price") or 0)
        except (TypeError, ValueError):
            return 0.0
    try:
        return float(it.get("rate") or 0)
    except (TypeError, ValueError):
        return 0.0


def _item_gst(it: Dict[str, Any], fallback: float = 0.0) -> float:
    if it.get("gst") is not None and it.get("gst") != "":
        try:
            return float(it.get("gst") or 0)
        except (TypeError, ValueError):
            return fallback
    return fallback


def _normalize_line_item(it: Dict[str, Any], gst_fallback: float = 0.0) -> Dict[str, Any]:
    qty = float(it.get("qty") or 0)
    price = _item_price(it)
    gst = _item_gst(it, gst_fallback)
    amount = qty * price
    gst_amt = amount * gst / 100
    return {
        "desc": it.get("desc") or "",
        "hsn": it.get("hsn") or "",
        "qty": qty,
        "unit": it.get("unit") or "Nos",
        "price": round(price, 2),
        "rate": round(price, 2),
        "gst": gst,
        "amount": round(amount, 2),
        "gstAmt": round(gst_amt, 2),
        "total": round(amount + gst_amt, 2),
    }


def _document_totals(items: List[Any], gst_percent: float = 0.0) -> Dict[str, Any]:
    rows = [_normalize_line_item(it if isinstance(it, dict) else {}, gst_percent) for it in (items or [])]
    subtotal = round(sum(r["amount"] for r in rows), 2)
    gst_amount = round(sum(r["gstAmt"] for r in rows), 2)
    grand = round(subtotal + gst_amount, 2)
    return {"items": rows, "subtotal": subtotal, "gstAmount": gst_amount, "grandTotal": grand}


def _commercial_totals(q: Dict[str, Any]) -> Dict[str, float]:
    capacity = float(q.get("capacity") or q.get("capacityKwp") or 0)
    rate = float(q.get("rate") or q.get("ratePerWp") or 0)
    gst_pct = float(q.get("gstPct") or q.get("gstPercent") or 0)
    wp = capacity * 1000
    base = wp * rate
    gst_amt = base * gst_pct / 100
    grand = base + gst_amt
    return {
        "subtotal": round(base, 2),
        "gstAmount": round(gst_amt, 2),
        "grandTotal": round(grand, 2),
        "gstPercent": gst_pct,
    }


def _finalize_quotation(quotation: Dict[str, Any]) -> Dict[str, Any]:
    q = dict(quotation or {})
    kind = q.get("kind") or "quotation"
    q["kind"] = kind
    items = q.get("items") if isinstance(q.get("items"), list) else []
    if kind == "commercial":
        totals = _commercial_totals(q)
        q["items"] = [_normalize_line_item(it if isinstance(it, dict) else {}, 0.0) for it in items]
        q["subtotal"] = totals["subtotal"]
        q["gstAmount"] = totals["gstAmount"]
        q["grandTotal"] = totals["grandTotal"]
        q["gstPercent"] = totals["gstPercent"]
        q["gstPct"] = totals["gstPercent"]
        q["netPayable"] = totals["grandTotal"]
        return q
    gst_fallback = float(q.get("gstPercent") or 0)
    totals = _document_totals(items, gst_fallback)
    q["items"] = totals["items"]
    q["subtotal"] = totals["subtotal"]
    q["gstAmount"] = totals["gstAmount"]
    q["grandTotal"] = totals["grandTotal"]
    subsidy_c = float(q.get("subsidyCentral") or 0)
    subsidy_s = float(q.get("subsidyState") or 0)
    q["subsidyCentral"] = subsidy_c
    q["subsidyState"] = subsidy_s
    q["netPayable"] = round(totals["grandTotal"] - subsidy_c - subsidy_s, 2)
    return q


def _invoice_payment_status(invoice: Dict[str, Any]) -> str:
    total = float(invoice.get("grandTotal", 0))
    paid = float(invoice.get("paidAmount", 0))
    if total <= 0:
        return "Paid"
    if paid >= total - 0.005:
        return "Paid"
    if paid > 0:
        return "Partial"
    return "Unpaid"


@crm.post("/leads/{lead_id}/invoice/payments")
async def crm_add_payment(
    lead_id: str,
    payload: PaymentCreate,
    user: CurrentUser = Depends(get_current_user),
):
    if not _can_invoice(user.role):
        raise HTTPException(status_code=403, detail="Recording payments requires Accounts, Sales or Admin")
    lead = await _get_lead_or_404(lead_id)
    if not lead.get("invoice"):
        raise HTTPException(status_code=400, detail="Create an invoice before recording payments")

    receipt_no = await _next_payment_receipt_no()
    payment = {
        "id": str(uuid.uuid4()),
        "receiptNo": receipt_no,
        "amount": round(float(payload.amount), 2),
        "mode": payload.mode,
        "reference": payload.reference,
        "note": payload.note,
        "received_by": user.full_name or user.email,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    inv = dict(lead["invoice"])
    payments = list(inv.get("payments") or [])
    payments.append(payment)
    paid = round(sum(float(p.get("amount", 0)) for p in payments), 2)
    inv["payments"] = payments
    inv["paidAmount"] = paid
    inv["paymentStatus"] = _invoice_payment_status(inv)

    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": {"invoice": inv, "updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(
        lead_id, user, "payment.recorded",
        f"₹{payment['amount']:,.2f} via {payload.mode} ({receipt_no})",
    )
    return result


@crm.delete("/leads/{lead_id}/invoice/payments/{payment_id}")
async def crm_delete_payment(
    lead_id: str,
    payment_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    if user.role not in {"Admin", "Accounts"}:
        raise HTTPException(status_code=403, detail="Only Admin or Accounts can remove payments")
    lead = await _get_lead_or_404(lead_id)
    if not lead.get("invoice"):
        raise HTTPException(status_code=400, detail="No invoice on this lead")

    inv = dict(lead["invoice"])
    payments = [p for p in (inv.get("payments") or []) if p.get("id") != payment_id]
    if len(payments) == len(inv.get("payments") or []):
        raise HTTPException(status_code=404, detail="Payment not found")
    inv["payments"] = payments
    inv["paidAmount"] = round(sum(float(p.get("amount", 0)) for p in payments), 2)
    inv["paymentStatus"] = _invoice_payment_status(inv)

    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": {"invoice": inv, "updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "payment.deleted", f"Payment {payment_id[:8]} removed")
    return result


# --------------------------------------------------------------------------- #
# CRM v2 — real document storage (GridFS-style via documents collection)
# --------------------------------------------------------------------------- #
MAX_DOC_SIZE = 10 * 1024 * 1024  # 10 MB per file
ALLOWED_DOC_TYPES = {
    "application/pdf", "image/jpeg", "image/png", "image/webp",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain", "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@crm.post("/leads/{lead_id}/stages/{stage_key}/documents")
async def crm_upload_document(
    lead_id: str,
    stage_key: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    if not _can_manage_docs(user.role):
        raise HTTPException(status_code=403, detail="Your role cannot upload documents")
    if file.content_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Use PDF, image, Word, Excel or text.",
        )
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_DOC_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    lead = await _get_lead_or_404(lead_id)
    stage_keys = [s.get("key") for s in (lead.get("stages") or [])]
    if stage_key not in stage_keys:
        raise HTTPException(status_code=404, detail=f"Unknown stage '{stage_key}'")

    from bson import Binary
    doc_id = str(uuid.uuid4())
    at = datetime.now(timezone.utc).isoformat()
    meta = {
        "id": doc_id,
        "lead_id": lead_id,
        "stage_key": stage_key,
        "name": (file.filename or "document")[:255],
        "content_type": file.content_type,
        "size": len(data),
        "data": Binary(data),
        "uploaded_by": user.full_name or user.email,
        "at": at,
    }
    await documents_collection.insert_one(meta)

    doc_meta = {k: v for k, v in meta.items() if k not in ("data", "_id")}
    # Attach metadata to the stage's documents array.
    stage_index = stage_keys.index(stage_key)
    stages = list(lead.get("stages") or [])
    if stage_index >= len(stages):
        raise HTTPException(status_code=400, detail="Lead stages missing")
    stage_docs = list(stages[stage_index].get("documents") or [])
    stage_docs.append(doc_meta)
    stages[stage_index]["documents"] = stage_docs

    await leads_collection.update_one(
        {"id": lead_id},
        {"$set": {"stages": stages, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await _push_activity(lead_id, user, "document.uploaded", f"{doc_meta['name']} → {stage_key}")
    return doc_meta


@crm.get("/leads/{lead_id}/stages/{stage_key}/documents/{doc_id}")
async def crm_download_document(
    lead_id: str,
    stage_key: str,
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    doc = await documents_collection.find_one(
        {"id": doc_id, "lead_id": lead_id, "stage_key": stage_key},
        {"_id": 0, "data": 1, "name": 1, "content_type": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    from io import BytesIO
    return StreamingResponse(
        BytesIO(doc["data"]),
        media_type=doc.get("content_type", "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{doc.get("name", "document")}"'},
    )


@crm.delete("/leads/{lead_id}/stages/{stage_key}/documents/{doc_id}")
async def crm_delete_document(
    lead_id: str,
    stage_key: str,
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    lead = await _get_lead_or_404(lead_id)
    stage = next((s for s in (lead.get("stages") or []) if s.get("key") == stage_key), None)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    docs = list(stage.get("documents") or [])
    meta = next((d for d in docs if d.get("id") == doc_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Document not found")

    await documents_collection.delete_one({"id": doc_id})
    stage["documents"] = [d for d in docs if d.get("id") != doc_id]
    await leads_collection.update_one(
        {"id": lead_id},
        {"$set": {"stages": lead.get("stages"), "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await _push_activity(lead_id, user, "document.deleted", meta.get("name", "Document"))
    return {"ok": True}


@crm.delete("/leads/{lead_id}")
async def crm_delete_lead(lead_id: str, user: CurrentUser = Depends(require_admin)):
    r = await leads_collection.delete_one({"id": lead_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Enterprise solar modules — site survey, technical design, inventory, ROI
# --------------------------------------------------------------------------- #
class SiteSurveyCreate(BaseModel):
    """Engineer's site-survey record for a lead."""
    model_config = ConfigDict(extra="ignore")

    scheduled_at: Optional[str] = Field(default=None, max_length=60)
    engineer_name: Optional[str] = Field(default=None, max_length=120)
    engineer_phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=1000)
    roof_structure: Optional[str] = Field(default=None, max_length=200)
    roof_condition: Optional[str] = Field(default=None, max_length=200)
    shadow_analysis: Optional[str] = Field(default=None, max_length=2000)
    accessible_area_sqft: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    load_assessment: Optional[str] = Field(default=None, max_length=2000)
    recommendations: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[str] = Field(default=None, max_length=40)


class SolarDesignCreate(BaseModel):
    """Technical solar design + DISCOM/subsidy metadata for a lead."""
    model_config = ConfigDict(extra="ignore")

    sanctioned_load_kw: Optional[float] = Field(default=None, ge=0, le=10_000)
    proposed_size_kw: Optional[float] = Field(default=None, ge=0, le=10_000)
    monthly_bill: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    roof_type: Optional[str] = Field(default=None, max_length=200)
    usable_area_sqft: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    discom_consumer_no: Optional[str] = Field(default=None, max_length=80)
    discom_app_id: Optional[str] = Field(default=None, max_length=80)
    meter_serial: Optional[str] = Field(default=None, max_length=80)
    subsidy_status: Optional[str] = Field(default=None, max_length=40)
    subsidy_amount: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    panel_serials: Optional[List[str]] = None
    inverter_serial: Optional[str] = Field(default=None, max_length=80)
    structure_type: Optional[str] = Field(default=None, max_length=200)
    bos_notes: Optional[str] = Field(default=None, max_length=2000)


class InventoryItemCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    item_type: str  # panel | inverter | structure | bos | other
    name: str = Field(..., min_length=1, max_length=200)
    serial: Optional[str] = Field(default=None, max_length=120)
    quantity: int = Field(default=1, ge=1, le=1_000_000)
    status: Optional[str] = Field(default="allocated", max_length=40)


class ROICalc(BaseModel):
    monthly_bill: float = Field(..., ge=0, le=10_000_000)
    size_kw: Optional[float] = Field(default=None, ge=0, le=10_000)
    capex_rate_per_kw: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    subsidy_percent: Optional[float] = Field(default=0, ge=0, le=100)
    tariff_escalation_pct: Optional[float] = Field(default=3, ge=-20, le=50)


class WhatsAppConfigUpdate(BaseModel):
    """Partial update for the DB-backed WhatsApp provider config (Admin)."""
    api_url: Optional[str] = Field(default=None, max_length=2000)
    api_key: Optional[str] = Field(default=None, max_length=2000)
    key_header: Optional[str] = Field(default=None, max_length=200)
    auth_mode: Optional[str] = Field(default=None, max_length=20)
    sender_id: Optional[str] = Field(default=None, max_length=200)
    max_attempts: Optional[int] = Field(default=None, ge=1, le=50)
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=300)
    payload_template: Optional[str] = Field(default=None, max_length=50_000)
    base_url: Optional[str] = Field(default=None, max_length=1000)
    wacrm_base_url: Optional[str] = Field(default=None, max_length=1000)
    wacrm_api_key: Optional[str] = Field(default=None, max_length=2000)


class WhatsAppTestSend(BaseModel):
    phone: str = Field(..., min_length=8, max_length=20)
    event: Optional[str] = Field(default=None, max_length=60)


class WhatsAppDocumentSend(BaseModel):
    document_type: Optional[str] = Field(default="document", max_length=40)
    document_no: Optional[str] = Field(default="", max_length=80)
    message: Optional[str] = Field(default=None, max_length=2000)


class WhatsAppChatSend(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    phone: Optional[str] = Field(default=None, max_length=20)


_SUBSIDY_STATUSES = {"Not Applied", "Applied", "Approved", "Disbursed", "Rejected"}


def _solar_stage_key(lead: Dict[str, Any], want: str) -> Optional[str]:
    """Find the pipeline stage key for a life-cycle milestone on a lead."""
    for s in (lead.get("stages") or []):
        if s.get("key") == want:
            return s.get("key")
    return None


@crm.post("/leads/{lead_id}/survey")
async def crm_save_survey(
    lead_id: str,
    payload: SiteSurveyCreate,
    user: CurrentUser = Depends(get_current_user),
):
    if user.role not in {"Admin", "Sales", "Site Survey"}:
        raise HTTPException(status_code=403, detail="Site survey requires Sales, Site Survey or Admin")
    lead = await _get_lead_or_404(lead_id)
    data = payload.model_dump(exclude_unset=True)
    data["updated_by"] = user.full_name or user.email
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": {"site_survey": data, "updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "survey.saved", "Site survey record updated")
    return result


@crm.post("/leads/{lead_id}/solar")
async def crm_save_solar(
    lead_id: str,
    payload: SolarDesignCreate,
    user: CurrentUser = Depends(get_current_user),
):
    if user.role not in {"Admin", "Sales", "Site Survey", "Installation"}:
        raise HTTPException(status_code=403, detail="Technical design requires an engineering role")
    lead = await _get_lead_or_404(lead_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("subsidy_status") and data["subsidy_status"] not in _SUBSIDY_STATUSES:
        raise HTTPException(status_code=400, detail=f"subsidy_status must be one of {sorted(_SUBSIDY_STATUSES)}")
    data["updated_by"] = user.full_name or user.email
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Auto-suggest system size from monthly bill when not provided.
    if data.get("proposed_size_kw") is None and lead.get("monthly_bill"):
        bill = float(lead["monthly_bill"])
        data["proposed_size_kw"] = round(min(10.0, max(1.0, bill / 900)), 2)

    result = await leads_collection.find_one_and_update(
        {"id": lead_id},
        {"$set": {"solar": data, "updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _push_activity(lead_id, user, "solar.saved", "Solar technical design updated")
    return result


@crm.post("/leads/{lead_id}/inventory")
async def crm_add_inventory(
    lead_id: str,
    payload: InventoryItemCreate,
    user: CurrentUser = Depends(get_current_user),
):
    if user.role not in {"Admin", "Installation"}:
        raise HTTPException(status_code=403, detail="Inventory tracking requires Installation or Admin")
    lead = await _get_lead_or_404(lead_id)
    if payload.item_type not in {"panel", "inverter", "structure", "bos", "other"}:
        raise HTTPException(status_code=400, detail="item_type must be panel|inverter|structure|bos|other")

    now_iso = datetime.now(timezone.utc).isoformat()
    item = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "lead_code": lead.get("code"),
        "customer_name": lead.get("full_name"),
        "item_type": payload.item_type,
        "name": payload.name,
        "serial": (payload.serial or "").strip() or None,
        "quantity": payload.quantity,
        "status": payload.status,
        "added_by": user.full_name or user.email,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await inventory_collection.insert_one(item)

    serials = (payload.serial or "").strip()
    if serials and payload.item_type == "panel":
        await leads_collection.update_one(
            {"id": lead_id},
            {"$push": {"solar.panel_serials": serials}},
        )

    await _push_activity(lead_id, user, "inventory.added", f"{payload.name} ({serials or 'no serial'})")
    return {k: v for k, v in item.items() if k != "_id"}


@crm.get("/leads/{lead_id}/inventory")
async def crm_list_inventory(
    lead_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    await _get_lead_or_404(lead_id)
    cursor = inventory_collection.find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=1000)


@crm.delete("/leads/{lead_id}/inventory/{item_id}")
async def crm_delete_inventory(
    lead_id: str,
    item_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    if user.role not in {"Admin", "Installation"}:
        raise HTTPException(status_code=403, detail="Inventory tracking requires Installation or Admin")
    r = await inventory_collection.delete_one({"id": item_id, "lead_id": lead_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    return {"ok": True}


@crm.get("/inventory")
async def crm_global_inventory(
    item_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=500, ge=1, le=5000),
    user: CurrentUser = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if item_type:
        query["item_type"] = item_type
    if status:
        query["status"] = status
    cursor = inventory_collection.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


@crm.post("/solar/roi")
async def crm_roi_calculator(payload: ROICalc, user: CurrentUser = Depends(get_current_user)):
    """Solar ROI calculator: system sizing, capex, subsidy, payback, LCOE."""
    monthly_bill = payload.monthly_bill
    size_kw = payload.size_kw or round(max(1.0, monthly_bill / 900), 2)
    rate = payload.capex_rate_per_kw or 55000
    capex = round(size_kw * rate, 2)
    subsidy = round(capex * payload.subsidy_percent / 100.0, 2)
    net_investment = round(capex - subsidy, 2)

    # 4 solar peak-hours/day, 25-year life, 80% first-year performance factor.
    annual_generation_kwh = round(size_kw * 4 * 365 * 0.8, 0)
    annual_bill = monthly_bill * 12
    savings_year1 = round(min(annual_bill, annual_generation_kwh * 5.5), 2)  # ~₹5.5/kWh avg tariff

    # Simple payback (years) accounting for tariff escalation ~3%/yr.
    escalation = payload.tariff_escalation_pct / 100.0
    cumulative = 0.0
    years = 0
    while years < 30:
        year_saving = savings_year1 * (1 + escalation) ** years
        cumulative += year_saving
        years += 1
        if cumulative >= net_investment:
            break
    payback_years = round(years, 1) if years < 30 else None

    lcoe = round((net_investment / (annual_generation_kwh * 25)) * 100, 2) if annual_generation_kwh else None

    return {
        "monthly_bill": monthly_bill,
        "size_kw": size_kw,
        "capex": capex,
        "subsidy": subsidy,
        "net_investment": net_investment,
        "annual_generation_kwh": annual_generation_kwh,
        "annual_savings_year1": savings_year1,
        "payback_years": payback_years,
        "lcoe_per_kwh": lcoe,
        "generation_per_kw_year": round(annual_generation_kwh / size_kw, 0) if size_kw else None,
    }


# --------------------------------------------------------------------------- #
# WhatsApp delivery logs (Admin)
# --------------------------------------------------------------------------- #
@crm.get("/whatsapp/logs")
async def crm_whatsapp_logs(
    lead_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=2000),
    user: CurrentUser = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if lead_id:
        query["lead_id"] = lead_id
    if status:
        query["status"] = status
    cursor = whatsapp_logs_collection.find(query, {"_id": 0, "payload": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


@crm.post("/whatsapp/logs/retry")
async def crm_whatsapp_retry(
    lead_id: Optional[str] = None,
    user: CurrentUser = Depends(get_current_user),
):
    if not whatsapp_enabled():
        return {"ok": True, "message": "WhatsApp integration disabled", "retried": 0, "succeeded": 0, "failed": 0}
    return await retry_failed_messages(whatsapp_logs_collection, lead_id=lead_id)


@crm.post("/leads/{lead_id}/whatsapp/test")
async def crm_whatsapp_test(
    lead_id: str,
    event: Optional[str] = Query(default=None, max_length=60),
    user: CurrentUser = Depends(get_current_user),
):
    """Manually fire a WhatsApp milestone event for a lead (Admin only)."""
    lead = await _get_lead_or_404(lead_id)
    chosen = event or "LEAD_CAPTURED"
    if chosen not in WHATSAPP_EVENTS:
        raise HTTPException(status_code=400, detail=f"event must be one of {WHATSAPP_EVENTS}")
    survey_extra: Dict[str, Any] = {}
    if lead.get("site_survey") and lead["site_survey"].get("scheduled_at"):
        survey_extra["when"] = lead["site_survey"]["scheduled_at"]
    survey_extra["link"] = _tracking_url(lead) or ""
    out = await _notify_whatsapp(lead, chosen, survey_extra)
    return {"ok": out.get("ok", False), "status": out.get("status"), "log_id": out.get("log_id")}


@crm.post("/leads/{lead_id}/whatsapp/document")
async def crm_whatsapp_document(
    lead_id: str,
    payload: WhatsAppDocumentSend,
    user: CurrentUser = Depends(get_current_user),
):
    """Send a quotation/invoice/receipt notice via the WhatsApp Business API."""
    lead = await _get_lead_or_404(lead_id)
    doc_type = (payload.document_type or "document").strip() or "document"
    doc_no = (payload.document_no or "").strip()
    label = {
        "quotation": "quotation",
        "commercial": "commercial quotation",
        "invoice": "invoice",
        "receipt": "payment receipt",
    }.get(doc_type.lower(), doc_type)
    extra: Dict[str, Any] = {
        "doc": f"{label} {doc_no}".strip(),
        "document_type": doc_type,
        "document_no": doc_no,
        "link": _tracking_url(lead) or "",
        "sent_by": user.full_name or user.email,
    }
    if payload.message:
        extra["message"] = payload.message
    out = await _notify_whatsapp(lead, "DOCUMENT_SENT", extra)
    await _push_activity(lead_id, user, "whatsapp.document", f"WhatsApp {label} sent")
    return {"ok": out.get("ok", False), "status": out.get("status"), "log_id": out.get("log_id"), "error": out.get("error")}


def _chat_thread_payload(out: Dict[str, Any], phone: str = "") -> Dict[str, Any]:
    return {
        "ok": out.get("ok", False),
        "enabled": out.get("enabled", False),
        "phone": out.get("phone") or phone or "",
        "conversation_id": out.get("conversation_id"),
        "contact_id": out.get("contact_id"),
        "messages": out.get("messages") or [],
        "error": out.get("error"),
    }


@crm.get("/whatsapp/chat")
async def crm_whatsapp_chat(
    phone: str = Query(..., min_length=8, max_length=20),
    user: CurrentUser = Depends(get_current_user),
):
    """Load conversation history for a customer phone from WaCrmStepSolar_Live."""
    out = await fetch_chat_thread({"phone": phone})
    return _chat_thread_payload(out, phone)


@crm.post("/whatsapp/chat")
async def crm_whatsapp_chat_send(
    payload: WhatsAppChatSend,
    user: CurrentUser = Depends(get_current_user),
):
    """Send a WhatsApp text via WaCrmStepSolar_Live public API."""
    phone = (payload.phone or "").strip()
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="phone is required")
    lead = {"phone": phone}
    out = await send_chat_text(lead, payload.text)
    return {
        "ok": out.get("ok", False),
        "conversation_id": out.get("conversation_id"),
        "message_id": out.get("message_id"),
        "error": out.get("error"),
    }


@crm.get("/leads/{lead_id}/whatsapp/thread")
async def crm_whatsapp_thread(
    lead_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Live WaCRM inbox for this lead — alias of GET /whatsapp/chat?phone=."""
    lead = await _get_lead_or_404(lead_id)
    out = await fetch_chat_thread(lead)
    return _chat_thread_payload(out, lead.get("phone") or "")


@crm.post("/leads/{lead_id}/whatsapp/chat")
async def crm_whatsapp_lead_chat(
    lead_id: str,
    payload: WhatsAppChatSend,
    user: CurrentUser = Depends(get_current_user),
):
    """Send a free-form WhatsApp text via WaCRM (same thread as the CRM popup)."""
    lead = await _get_lead_or_404(lead_id)
    out = await send_chat_text(lead, payload.text)
    if out.get("ok"):
        preview = (payload.text or "").strip().replace("\n", " ")
        if len(preview) > 80:
            preview = preview[:77] + "…"
        await _push_activity(lead_id, user, "whatsapp.chat", f"WhatsApp: {preview}")
    return {
        "ok": out.get("ok", False),
        "conversation_id": out.get("conversation_id"),
        "message_id": out.get("message_id"),
        "error": out.get("error"),
    }


# --------------------------------------------------------------------------- #
# WhatsApp provider settings (Admin) — DB-backed, overrides env at send time
# --------------------------------------------------------------------------- #
_WHATSAPP_SETTINGS_ID = "whatsapp"
_WHATSAPP_AUTH_MODES = {"bearer", "apikey", "none", ""}


async def _load_whatsapp_settings() -> Optional[Dict[str, Any]]:
    doc = await settings_collection.find_one({"_id": _WHATSAPP_SETTINGS_ID})
    cfg = (doc or {}).get("config")
    return cfg if isinstance(cfg, dict) else None


async def _save_whatsapp_settings(config: Dict[str, Any], user: CurrentUser) -> None:
    await settings_collection.update_one(
        {"_id": _WHATSAPP_SETTINGS_ID},
        {"$set": {
            "config": config,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": user.full_name or user.email,
        }},
        upsert=True,
    )


def _db_config_view(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Stored config as exposed to the UI — secrets never leave the server."""
    view = {k: v for k, v in cfg.items() if v is not None}
    key = str(view.get("api_key") or "")
    view["api_key_set"] = bool(key)
    view.pop("api_key", None)
    wa_key = str(view.get("wacrm_api_key") or "")
    view["wacrm_api_key_set"] = bool(wa_key)
    view.pop("wacrm_api_key", None)
    return view


@crm.get("/whatsapp/config")
async def crm_whatsapp_config(user: CurrentUser = Depends(require_admin)):
    db_cfg = await _load_whatsapp_settings()
    return {
        "enabled": whatsapp_enabled(),
        "source": "db" if db_cfg else "env",
        "db_config": _db_config_view(db_cfg) if db_cfg else None,
        "effective": effective_config(mask_key=True),
        "events": WHATSAPP_EVENTS,
    }


@crm.put("/whatsapp/config")
async def crm_whatsapp_config_update(
    payload: WhatsAppConfigUpdate,
    user: CurrentUser = Depends(require_admin),
):
    data = payload.model_dump(exclude_unset=True)

    mode = data.get("auth_mode")
    if mode is not None:
        mode = mode.strip().lower()
        if mode not in _WHATSAPP_AUTH_MODES:
            raise HTTPException(
                status_code=400,
                detail="auth_mode must be one of: bearer, apikey, none",
            )
        data["auth_mode"] = mode

    tmpl = data.get("payload_template")
    if tmpl is not None and tmpl.strip():
        try:
            parsed = json.loads(tmpl)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"payload_template is not valid JSON: {e}")
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="payload_template must be a JSON object")

    db_cfg = (await _load_whatsapp_settings()) or {}

    # Secrets: masked placeholder → keep existing; empty string → clear;
    # otherwise store the new key.
    for secret_field in ("api_key", "wacrm_api_key"):
        if secret_field in data:
            new_key = str(data[secret_field] or "").strip()
            if new_key and "•" in new_key:
                data.pop(secret_field, None)
            else:
                data[secret_field] = new_key

    merged = {**db_cfg, **{k: v for k, v in data.items() if v is not None}}
    await _save_whatsapp_settings(merged, user)
    set_runtime_config(merged)

    return {
        "ok": True,
        "enabled": whatsapp_enabled(),
        "source": "db",
        "db_config": _db_config_view(merged),
        "effective": effective_config(mask_key=True),
    }


@crm.post("/whatsapp/test-send")
async def crm_whatsapp_test_send(
    payload: WhatsAppTestSend,
    user: CurrentUser = Depends(require_admin),
):
    """Send a test WhatsApp to an arbitrary phone using the current config."""
    if not whatsapp_enabled():
        raise HTTPException(
            status_code=400,
            detail="WhatsApp is not configured — set the API URL in WhatsApp Settings first.",
        )
    event = payload.event or "QUOTATION_SENT"
    if event not in WHATSAPP_EVENTS:
        raise HTTPException(status_code=400, detail=f"event must be one of {WHATSAPP_EVENTS}")

    test_lead: Dict[str, Any] = {
        "id": "test-send",
        "code": "SSE-TEST",
        "full_name": "Test Customer",
        "phone": payload.phone,
        "stages": [],
    }
    extra = {
        "link": f"{base_url()}/track/test",
        "when": "",
        "message": "Test WhatsApp from Step Solar CRM — your WhatsApp provider is configured correctly.",
    }
    out = await send_whatsapp(whatsapp_logs_collection, test_lead, event, extra)
    return {
        "ok": out.get("ok", False),
        "status": out.get("status"),
        "event": event,
        "recipient": str(payload.phone),
        "log_id": out.get("log_id"),
        "error": out.get("error"),
    }


# --------------------------------------------------------------------------- #
# Public tracking portal — tokenized, no auth (customer-facing)
# --------------------------------------------------------------------------- #
def _mask_phone(phone: Any) -> str:
    s = str(phone or "")
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) >= 10:
        return f"{digits[:2]}XXXXXX{digits[-2:]}"
    return "••••••"


async def _public_lead_or_404(token: str) -> Dict[str, Any]:
    lead = await leads_collection.find_one({"tracking_token": token, "tracking_visible": True}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Tracking link not found")
    return lead


@app.get("/api/track/{token}")
async def public_track(token: str):
    lead = await _public_lead_or_404(token)

    stages_out = []
    for s in (lead.get("stages") or []):
        stages_out.append({
            "key": s.get("key"),
            "label": s.get("label"),
            "status": s.get("status"),
            "updatedAt": s.get("updatedAt"),
            "notes": s.get("notes") or "",
        })
    done = sum(1 for s in stages_out if s["status"] == "Completed")
    progress = round((done / len(stages_out)) * 100) if stages_out else 0

    survey = lead.get("site_survey")
    docs = []
    for s in (lead.get("stages") or []):
        for d in (s.get("documents") or []):
            docs.append({
                "id": d.get("id"),
                "name": d.get("name"),
                "size": d.get("size"),
                "at": d.get("at"),
                "stage": s.get("label"),
            })

    quotation = None
    if lead.get("quotation"):
        q = lead["quotation"]
        quotation = {
            "status": q.get("status"),
            "grandTotal": q.get("grandTotal"),
            "currency": "INR",
            "revision": q.get("revision"),
        }

    return {
        "ok": True,
        "lead": {
            "code": lead.get("code"),
            "full_name": lead.get("full_name"),
            "phone_masked": _mask_phone(lead.get("phone")),
            "city": lead.get("city"),
            "state": lead.get("state"),
            "created_at": lead.get("created_at"),
        },
        "progress": progress,
        "stages": stages_out,
        "survey": {
            "scheduled_at": (survey or {}).get("scheduled_at"),
            "engineer_name": (survey or {}).get("engineer_name"),
            "engineer_phone": (survey or {}).get("engineer_phone"),
            "status": (survey or {}).get("status"),
        } if survey else None,
        "solar": lead.get("solar"),
        "quotation": quotation,
        "documents": docs,
        "inventory": [
            {k: v for k, v in i.items() if k not in ("_id", "lead_id")}
            for i in await inventory_collection.find({"lead_id": lead.get("id")}, {"_id": 0}).to_list(length=500)
        ],
    }


@app.get("/api/track/{token}/documents/{doc_id}")
async def public_track_document(token: str, doc_id: str):
    lead = await _public_lead_or_404(token)
    doc = await documents_collection.find_one(
        {"id": doc_id, "lead_id": lead["id"]},
        {"_id": 0, "data": 1, "name": 1, "content_type": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    from io import BytesIO
    return StreamingResponse(
        BytesIO(doc["data"]),
        media_type=doc.get("content_type", "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{doc.get("name", "document")}"'},
    )


# --------------------------------------------------------------------------- #
# Admin — user management (Admin role only)
# --------------------------------------------------------------------------- #
admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


class AdminUserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    active: bool
    must_change_password: bool


class AdminUserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=120)
    role: str
    temp_password: str = Field(..., min_length=8, max_length=200)

    @field_validator("role")
    @classmethod
    def _v_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {sorted(VALID_ROLES)}")
        return v


class AdminUserPatch(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    role: Optional[str] = None
    active: Optional[bool] = None
    reset_password: Optional[str] = Field(default=None, min_length=8, max_length=200)

    @field_validator("role")
    @classmethod
    def _v_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"role must be one of {sorted(VALID_ROLES)}")
        return v


def _user_out(doc: Dict[str, Any]) -> AdminUserOut:
    return AdminUserOut(
        id=doc["id"],
        email=doc["email"],
        full_name=doc.get("full_name", ""),
        role=doc["role"],
        active=doc.get("active", True),
        must_change_password=doc.get("must_change_password", False),
    )


@admin_router.get("/users", response_model=List[AdminUserOut])
async def admin_list_users(user: CurrentUser = Depends(require_admin)):
    cursor = users_collection.find({}, {"_id": 0})
    return [_user_out(d) async for d in cursor]


@admin_router.post("/users", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
async def admin_create_user(payload: AdminUserCreate, user: CurrentUser = Depends(require_admin)):
    email = payload.email.lower()
    if await users_collection.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "full_name": payload.full_name,
        "role": payload.role,
        "password_hash": pwd_context.hash(payload.temp_password),
        "active": True,
        # New accounts must set their own password on first login instead of
        # continuing to use the temp password an admin picked for them.
        "must_change_password": True,
    }
    await users_collection.insert_one(doc)
    return _user_out(doc)


@admin_router.patch("/users/{user_id}", response_model=AdminUserOut)
async def admin_patch_user(user_id: str, payload: AdminUserPatch, user: CurrentUser = Depends(require_admin)):
    update = payload.model_dump(exclude_unset=True, exclude={"reset_password"})
    if payload.reset_password is not None:
        update["password_hash"] = pwd_context.hash(payload.reset_password)
        update["must_change_password"] = True
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    if user_id == user.id and update.get("active") is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    if user_id == user.id and update.get("role") and update["role"] != user.role:
        raise HTTPException(
            status_code=400,
            detail="You cannot change your own role (would lock you out of admin access)",
        )

    result = await users_collection.find_one_and_update(
        {"id": user_id},
        {"$set": update},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_out(result)


api.include_router(admin_router)
api.include_router(crm)
app.include_router(api)


# --------------------------------------------------------------------------- #
# Validation error handler
# --------------------------------------------------------------------------- #
@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    msg = first.get("msg", "Invalid input")
    return JSONResponse(
        status_code=422,
        content={"ok": False, "detail": f"{field}: {msg}" if field else msg},
    )


# --------------------------------------------------------------------------- #
# Startup — default admin seed, indexes + one-time migration for legacy leads
# --------------------------------------------------------------------------- #
async def _seed_default_admin():
    """Create / optionally reset the bootstrap admin (idempotent).

    Controlled by env vars (defaults match the documented bootstrap account):

        ADMIN_EMAIL                     super@stepsolar.in
        ADMIN_PASSWORD                  Abhi@93047
        ADMIN_NAME                      Super Admin
        ADMIN_ROLE                      Admin
        ADMIN_FORCE_PASSWORD_CHANGE     true (must_change_password flag)
        ADMIN_FORCE_RESET               false — when true, overwrite the
                                        existing admin's password_hash on every
                                        startup (use ONLY to regain access when
                                        the admin password is lost; set back to
                                        false afterwards).

    If a user with ADMIN_EMAIL already exists the seed is skipped, so this is
    safe to run on every startup. Setting ADMIN_EMAIL to an empty string
    disables the seed entirely.
    """
    email = os.environ.get("ADMIN_EMAIL", "super@stepsolar.in").strip().lower()
    if not email:
        return
    password = os.environ.get("ADMIN_PASSWORD", "Abhi@93047")
    if len(password) < 8:
        logger.warning(
            "ADMIN_PASSWORD for %s is shorter than 8 characters; skipping default admin seed.",
            email,
        )
        return
    role = os.environ.get("ADMIN_ROLE", "Admin")
    if role not in VALID_ROLES:
        logger.warning("ADMIN_ROLE '%s' is invalid; skipping default admin seed.", role)
        return

    existing = await users_collection.find_one({"email": email})

    if existing:
        if not _env_flag("ADMIN_FORCE_RESET", default=False):
            return  # safe default: do not touch an existing user
        await users_collection.update_one(
            {"email": email},
            {"$set": {
                "password_hash": pwd_context.hash(password),
                "full_name": os.environ.get("ADMIN_NAME", existing.get("full_name", "Super Admin")),
                "role": role,
                "active": True,
                "must_change_password": _env_flag("ADMIN_FORCE_PASSWORD_CHANGE", default=True),
            }},
        )
        logger.warning(
            "ADMIN_FORCE_RESET=true — reset password for %s to the ADMIN_PASSWORD env value. "
            "Set ADMIN_FORCE_RESET=false after you sign back in.",
            email,
        )
        return

    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "full_name": os.environ.get("ADMIN_NAME", "Super Admin"),
        "role": role,
        "password_hash": pwd_context.hash(password),
        "active": True,
        "must_change_password": _env_flag("ADMIN_FORCE_PASSWORD_CHANGE", default=True),
    }
    await users_collection.insert_one(doc)
    logger.info("Seeded default admin user %s (role=%s)", email, role)


async def _migrate_legacy_leads():
    """Add code/stages/quotation/invoice to leads that predate the CRM schema."""
    cursor = leads_collection.find(
        {"$or": [{"code": {"$exists": False}}, {"stages": {"$exists": False}}]},
        {"_id": 0, "id": 1, "created_at": 1},
    )
    async for lead in cursor:
        code = await _next_lead_code()
        stages = _fresh_stages("solar")
        stages[0]["status"] = "In Progress"
        stages[0]["updatedAt"] = lead.get("created_at")
        await leads_collection.update_one(
            {"id": lead["id"]},
            {"$set": {
                "code": code,
                "pipeline": "solar",
                "tracking_token": _new_tracking_token(),
                "tracking_visible": True,
                "stages": stages,
                "solar": None,
                "site_survey": None,
                "inventory": [],
                "quotation": None,
                "invoice": None,
                "assigned_to": None,
                "assigned_name": None,
                "comments": [],
                "tasks": [],
                "activity": [],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )


@app.on_event("startup")
async def _startup():
    await leads_collection.create_index("id", unique=True)
    await leads_collection.create_index("code", unique=True, sparse=True)
    await leads_collection.create_index([("created_at", -1)])
    await leads_collection.create_index([("phone", 1), ("created_at", -1)])
    await leads_collection.create_index([("email", 1), ("created_at", -1)])
    await users_collection.create_index("email", unique=True)
    await users_collection.create_index("id", unique=True)
    await documents_collection.create_index([("lead_id", 1), ("stage_key", 1)])
    await leads_collection.create_index("tracking_token", unique=True, sparse=True)
    await whatsapp_logs_collection.create_index([("lead_id", 1), ("created_at", -1)])
    await whatsapp_logs_collection.create_index("status")
    await inventory_collection.create_index([("lead_id", 1), ("created_at", -1)])
    await inventory_collection.create_index("serial", sparse=True)
    await _seed_default_admin()
    await _migrate_legacy_leads()
    set_runtime_config(await _load_whatsapp_settings())
    logger.info(
        "Startup — sheets_enabled=%s gmail_enabled=%s whatsapp_enabled=%s whatsapp_config_source=%s dup_window_min=%s",
        sheets_enabled(),
        gmail_enabled(),
        whatsapp_enabled(),
        "db" if await _load_whatsapp_settings() else "env",
        _dup_window_min(),
    )


@app.on_event("shutdown")
async def _shutdown():
    client.close()
