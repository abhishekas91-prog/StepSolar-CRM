"""Arka360-style Design Projects — additive CRM routes.

Phase 1: solar_projects CRUD (does not touch /crm/leads or ops /projects).
Phase 2: tariff, consumption, interval upload, nested designs, defaults profiles.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument

from interval_parse import parse_interval_file
from solar_profiles import (
    BD_TEAM_DEFAULTS,
    apply_bill_estimate,
    empty_consumption,
    empty_tariff,
    pad_daily,
    pad_months,
)

router = APIRouter()

_ctx: Dict[str, Any] = {}
_registered = False


def bind(**kwargs: Any) -> None:
    _ctx.update(kwargs)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    return {k: v for k, v in doc.items() if k != "_id"}


def _user():
    return _ctx["get_current_user"]


def _admin():
    return _ctx["require_admin"]


def _projects():
    return _ctx["solar_projects"]


def _tariffs():
    return _ctx["tariff_profiles"]


def _consumption():
    return _ctx["consumption_profiles"]


def _designs():
    return _ctx["designs"]


def _pv_designs():
    return _ctx.get("pv_designs")


def _defaults():
    return _ctx["defaults_profiles"]


def _leads():
    return _ctx["leads"]


def _meta():
    return _ctx["meta"]


async def _next_project_code() -> str:
    doc = await _meta().find_one_and_update(
        {"_id": "counters"},
        {"$inc": {"nextSolarProjectNo": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    n = int(doc.get("nextSolarProjectNo", 1))
    return f"SPV-{n:04d}"


async def _get_project_or_404(project_id: str) -> Dict[str, Any]:
    doc = await _projects().find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Solar project not found")
    return doc


def _empty_project(user, lead: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    now = _now()
    loc = {"lat": 25.5941, "lng": 85.1376, "zoom": 19}
    name = "Untitled project"
    address = ""
    lead_id = None
    lead_code = None
    customer_name = None
    customer_phone = None
    monthly_bill = None
    if lead:
        lead_id = lead.get("id")
        lead_code = lead.get("code")
        customer_name = lead.get("full_name") or lead.get("name")
        customer_phone = lead.get("phone")
        name = f"{customer_name or lead_code or 'Lead'} rooftop"
        address = lead.get("address") or ", ".join(
            [x for x in [lead.get("city"), lead.get("state"), lead.get("pincode")] if x]
        )
        monthly_bill = lead.get("monthly_bill")
        survey = lead.get("site_survey") or {}
        if survey.get("address"):
            address = survey["address"]
        if survey.get("lat") and survey.get("lng"):
            loc = {"lat": float(survey["lat"]), "lng": float(survey["lng"]), "zoom": 19}
    return {
        "id": str(uuid.uuid4()),
        "code": None,
        "name": name,
        "address": address,
        "location": loc,
        "lead_id": lead_id,
        "lead_code": lead_code,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "monthly_bill": monthly_bill,
        "status": "draft",
        "notes": "",
        "created_at": now,
        "updated_at": now,
        "created_by": user.full_name or user.email,
        "updated_by": user.full_name or user.email,
    }


class GeoLoc(BaseModel):
    model_config = ConfigDict(extra="ignore")
    lat: float = 25.5941
    lng: float = 85.1376
    zoom: Optional[float] = 19


class SolarProjectCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    location: Optional[GeoLoc] = None
    lead_id: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=4000)
    status: Optional[str] = Field(default="draft", max_length=40)


class SolarProjectPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    location: Optional[GeoLoc] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    status: Optional[str] = Field(default=None, max_length=40)


class TouSlot(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(default="Slot", max_length=80)
    start: str = Field(default="00:00", max_length=8)
    end: str = Field(default="06:00", max_length=8)
    price_per_kwh: float = Field(default=8.5, ge=0, le=100)


class TariffUpsert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mode: Optional[str] = Field(default=None, max_length=20)
    metering: Optional[str] = Field(default=None, max_length=40)
    price_per_kwh: Optional[float] = Field(default=None, ge=0, le=100)
    escalation_rate: Optional[float] = Field(default=None, ge=0, le=50)
    zero_export: Optional[bool] = None
    export_only: Optional[bool] = None
    tou_slots: Optional[List[TouSlot]] = None


class LoadSlice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    monthly_kwh: Optional[List[float]] = None
    daily_profile: Optional[List[float]] = None
    monthly_bill_rs: Optional[float] = Field(default=None, ge=0, le=10_000_000)


class ConsumptionUpsert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Optional[str] = Field(default=None, max_length=40)
    current: Optional[LoadSlice] = None
    future: Optional[LoadSlice] = None


class BillEstimate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    monthly_bill_rs: float = Field(..., ge=0, le=10_000_000)
    price_per_kwh: Optional[float] = Field(default=None, ge=0, le=100)
    which: Optional[str] = Field(default="current", max_length=20)


class NestedDesignCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(..., min_length=1, max_length=200)
    defaults_profile: Optional[str] = Field(default="BD TEAM", max_length=80)


class NestedDesignPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = Field(default=None, max_length=200)
    defaults_profile: Optional[str] = Field(default=None, max_length=80)
    status: Optional[str] = Field(default=None, max_length=40)


class DefaultsProfileUpsert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(..., min_length=1, max_length=80)
    panel_id: Optional[str] = Field(default="mod-540", max_length=40)
    tilt: Optional[float] = Field(default=18, ge=0, le=60)
    azimuth: Optional[float] = Field(default=180, ge=0, le=360)
    setback_m: Optional[float] = Field(default=0.4, ge=0, le=5)
    row_gap_m: Optional[float] = Field(default=0.02, ge=0, le=5)
    col_gap_m: Optional[float] = Field(default=0.02, ge=0, le=5)
    soiling_loss: Optional[float] = Field(default=0.03, ge=0, le=0.2)
    orientation: Optional[str] = Field(default="portrait", max_length=20)
    notes: Optional[str] = Field(default=None, max_length=2000)


def _merge_slice(base: Dict[str, Any], incoming: Optional[LoadSlice]) -> Dict[str, Any]:
    out = dict(base or {})
    if incoming is None:
        return out
    data = incoming.model_dump(exclude_unset=True)
    if "monthly_kwh" in data and data["monthly_kwh"] is not None:
        fill = float((out.get("monthly_kwh") or [0])[0] if out.get("monthly_kwh") else 0)
        out["monthly_kwh"] = pad_months(data["monthly_kwh"], fill)
    if "daily_profile" in data and data["daily_profile"] is not None:
        out["daily_profile"] = pad_daily(data["daily_profile"])
    if "monthly_bill_rs" in data:
        out["monthly_bill_rs"] = data["monthly_bill_rs"]
    return out


async def _ensure_tariff(project_id: str) -> Dict[str, Any]:
    doc = await _tariffs().find_one({"project_id": project_id}, {"_id": 0})
    if doc:
        return doc
    doc = empty_tariff(project_id)
    doc["id"] = str(uuid.uuid4())
    doc["updated_at"] = _now()
    await _tariffs().insert_one(doc)
    return _public(doc)


async def _ensure_consumption(project: Dict[str, Any]) -> Dict[str, Any]:
    project_id = project["id"]
    doc = await _consumption().find_one({"project_id": project_id}, {"_id": 0})
    if doc:
        return doc
    avg = None
    bill = project.get("monthly_bill")
    if bill:
        tariff = await _ensure_tariff(project_id)
        price = float(tariff.get("price_per_kwh") or 8.5)
        if price:
            avg = float(bill) / price
    doc = empty_consumption(project_id, avg)
    doc["id"] = str(uuid.uuid4())
    doc["updated_at"] = _now()
    await _consumption().insert_one(doc)
    return _public(doc)


async def _seed_defaults() -> None:
    existing = await _defaults().find_one({"name": BD_TEAM_DEFAULTS["name"]})
    if existing:
        return
    now = _now()
    await _defaults().insert_one({
        "id": str(uuid.uuid4()),
        "created_at": now,
        "updated_at": now,
        **BD_TEAM_DEFAULTS,
    })


def register() -> None:
    global _registered
    if _registered:
        return
    _registered = True
    CurrentUser = _ctx["CurrentUser"]
    get_current_user = _ctx["get_current_user"]
    require_admin = _ctx["require_admin"]
    get_lead = _ctx["get_lead"]
    push_activity = _ctx["push_activity"]

    @router.get("/solar-projects")
    async def list_solar_projects(
        q: Optional[str] = None,
        lead_id: Optional[str] = None,
        status_filter: Optional[str] = Query(default=None, alias="status"),
        limit: int = Query(default=200, ge=1, le=500),
        user: CurrentUser = Depends(get_current_user),
    ):
        query: Dict[str, Any] = {}
        if lead_id:
            query["lead_id"] = lead_id
        if status_filter:
            query["status"] = status_filter
        if q:
            needle = q.strip()
            query["$or"] = [
                {"name": {"$regex": needle, "$options": "i"}},
                {"address": {"$regex": needle, "$options": "i"}},
                {"code": {"$regex": needle, "$options": "i"}},
                {"customer_name": {"$regex": needle, "$options": "i"}},
                {"lead_code": {"$regex": needle, "$options": "i"}},
            ]
        cursor = _projects().find(query, {"_id": 0}).sort("updated_at", -1).limit(limit)
        return await cursor.to_list(length=limit)

    @router.get("/solar-projects/{project_id}")
    async def get_solar_project(project_id: str, user: CurrentUser = Depends(get_current_user)):
        project = await _get_project_or_404(project_id)
        tariff = await _ensure_tariff(project_id)
        consumption = await _ensure_consumption(project)
        designs = await _designs().find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(length=200)
        return {
            "project": project,
            "tariff": tariff,
            "consumption": consumption,
            "designs": designs,
        }

    @router.post("/solar-projects", status_code=status.HTTP_201_CREATED)
    async def create_solar_project(payload: SolarProjectCreate, user: CurrentUser = Depends(get_current_user)):
        lead = None
        if payload.lead_id:
            lead = await get_lead(payload.lead_id)
        doc = _empty_project(user, lead)
        data = payload.model_dump(exclude_unset=True)
        if payload.location is not None:
            data["location"] = payload.location.model_dump()
        doc.update({k: v for k, v in data.items() if v is not None})
        doc["code"] = await _next_project_code()
        doc["updated_at"] = _now()
        await _projects().insert_one(doc)
        await _ensure_tariff(doc["id"])
        await _ensure_consumption(doc)
        if doc.get("lead_id"):
            await push_activity(doc["lead_id"], user, "solar_project.created", f"Design project {doc['code']} created")
        return _public(doc)

    @router.post("/solar-projects/from-lead/{lead_id}", status_code=status.HTTP_201_CREATED)
    async def create_from_lead(lead_id: str, user: CurrentUser = Depends(get_current_user)):
        existing = await _projects().find_one({"lead_id": lead_id}, {"_id": 0}, sort=[("updated_at", -1)])
        if existing:
            return existing
        lead = await get_lead(lead_id)
        doc = _empty_project(user, lead)
        doc["code"] = await _next_project_code()
        await _projects().insert_one(doc)
        await _ensure_tariff(doc["id"])
        await _ensure_consumption(doc)
        await push_activity(lead_id, user, "solar_project.created", f"Design project {doc['code']} created from lead")
        return _public(doc)

    @router.patch("/solar-projects/{project_id}")
    async def patch_solar_project(
        project_id: str,
        payload: SolarProjectPatch,
        user: CurrentUser = Depends(get_current_user),
    ):
        await _get_project_or_404(project_id)
        data = payload.model_dump(exclude_unset=True)
        if payload.location is not None:
            data["location"] = payload.location.model_dump()
        if not data:
            return await _get_project_or_404(project_id)
        data["updated_at"] = _now()
        data["updated_by"] = user.full_name or user.email
        result = await _projects().find_one_and_update(
            {"id": project_id},
            {"$set": data},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        return result

    @router.delete("/solar-projects/{project_id}")
    async def delete_solar_project(project_id: str, user: CurrentUser = Depends(require_admin)):
        existing = await _get_project_or_404(project_id)
        await _projects().delete_one({"id": project_id})
        await _tariffs().delete_many({"project_id": project_id})
        await _consumption().delete_many({"project_id": project_id})
        await _designs().delete_many({"project_id": project_id})
        return {"ok": True, "id": existing["id"]}

    @router.get("/solar-projects/{project_id}/tariff")
    async def get_tariff(project_id: str, user: CurrentUser = Depends(get_current_user)):
        await _get_project_or_404(project_id)
        return await _ensure_tariff(project_id)

    @router.put("/solar-projects/{project_id}/tariff")
    async def put_tariff(
        project_id: str,
        payload: TariffUpsert,
        user: CurrentUser = Depends(get_current_user),
    ):
        await _get_project_or_404(project_id)
        current = await _ensure_tariff(project_id)
        data = payload.model_dump(exclude_unset=True)
        if payload.mode is not None and payload.mode not in {"flat", "tou"}:
            raise HTTPException(status_code=400, detail="mode must be flat or tou")
        if payload.metering is not None and payload.metering not in {"net_metering", "gross_metering", "net_billing"}:
            raise HTTPException(status_code=400, detail="Invalid metering type")
        if payload.tou_slots is not None:
            data["tou_slots"] = [s.model_dump() for s in payload.tou_slots]
        data["updated_at"] = _now()
        data["updated_by"] = user.full_name or user.email
        result = await _tariffs().find_one_and_update(
            {"project_id": project_id},
            {"$set": data},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        return result or {**current, **data}

    @router.get("/solar-projects/{project_id}/consumption")
    async def get_consumption(project_id: str, user: CurrentUser = Depends(get_current_user)):
        project = await _get_project_or_404(project_id)
        return await _ensure_consumption(project)

    @router.put("/solar-projects/{project_id}/consumption")
    async def put_consumption(
        project_id: str,
        payload: ConsumptionUpsert,
        user: CurrentUser = Depends(get_current_user),
    ):
        project = await _get_project_or_404(project_id)
        current = await _ensure_consumption(project)
        patch: Dict[str, Any] = {
            "updated_at": _now(),
            "updated_by": user.full_name or user.email,
        }
        if payload.type is not None:
            if payload.type not in {"monthly_avg", "monthly_bill", "interval_csv"}:
                raise HTTPException(status_code=400, detail="Invalid consumption type")
            patch["type"] = payload.type
        if payload.current is not None:
            patch["current"] = _merge_slice(current.get("current") or {}, payload.current)
        if payload.future is not None:
            patch["future"] = _merge_slice(current.get("future") or {}, payload.future)
        result = await _consumption().find_one_and_update(
            {"project_id": project_id},
            {"$set": patch},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        return result

    @router.post("/solar-projects/{project_id}/consumption/from-bill")
    async def consumption_from_bill(
        project_id: str,
        payload: BillEstimate,
        user: CurrentUser = Depends(get_current_user),
    ):
        project = await _get_project_or_404(project_id)
        current = await _ensure_consumption(project)
        tariff = await _ensure_tariff(project_id)
        price = payload.price_per_kwh if payload.price_per_kwh is not None else float(tariff.get("price_per_kwh") or 8.5)
        which = payload.which if payload.which in {"current", "future"} else "current"
        merged = apply_bill_estimate(current, payload.monthly_bill_rs, price, which)
        merged["updated_at"] = _now()
        merged["updated_by"] = user.full_name or user.email
        result = await _consumption().find_one_and_update(
            {"project_id": project_id},
            {"$set": {k: v for k, v in merged.items() if k != "_id"}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        return result

    @router.post("/solar-projects/{project_id}/consumption/interval")
    async def consumption_interval_upload(
        project_id: str,
        file: UploadFile = File(...),
        which: str = Query(default="current"),
        user: CurrentUser = Depends(get_current_user),
    ):
        project = await _get_project_or_404(project_id)
        current = await _ensure_consumption(project)
        raw = await file.read()
        try:
            parsed = parse_interval_file(raw, file.filename or "interval.csv")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not parse spreadsheet: {exc}") from exc
        target = which if which in {"current", "future"} else "current"
        slice_doc = {
            "monthly_kwh": parsed["monthly_kwh"],
            "daily_profile": parsed["daily_profile"],
            "source_file": file.filename,
            "row_count": parsed.get("row_count"),
        }
        patch = {
            "type": "interval_csv",
            target: slice_doc,
            "updated_at": _now(),
            "updated_by": user.full_name or user.email,
        }
        result = await _consumption().find_one_and_update(
            {"project_id": project_id},
            {"$set": patch},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        return result or {**current, **patch}

    @router.get("/solar-projects/{project_id}/designs")
    async def list_nested_designs(project_id: str, user: CurrentUser = Depends(get_current_user)):
        await _get_project_or_404(project_id)
        return await _designs().find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(length=200)

    @router.post("/solar-projects/{project_id}/designs", status_code=status.HTTP_201_CREATED)
    async def create_nested_design(
        project_id: str,
        payload: NestedDesignCreate,
        user: CurrentUser = Depends(get_current_user),
    ):
        project = await _get_project_or_404(project_id)
        profile_name = payload.defaults_profile or "BD TEAM"
        profile = await _defaults().find_one({"name": profile_name}, {"_id": 0})
        now = _now()
        defaults = {k: v for k, v in (profile or BD_TEAM_DEFAULTS).items() if k not in {"id", "created_at", "updated_at"}}
        pv_id = str(uuid.uuid4())
        doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "pv_design_id": pv_id,
            "name": payload.name.strip(),
            "defaults_profile": profile_name,
            "defaults": defaults,
            "status": "draft",
            "created_at": now,
            "updated_at": now,
            "created_by": user.full_name or user.email,
        }
        await _designs().insert_one(doc)
        if _pv_designs() is not None:
            await _pv_designs().insert_one({
                "id": pv_id,
                "solar_project_id": project_id,
                "lead_id": project.get("lead_id"),
                "name": payload.name.strip(),
                "address": project.get("address") or "",
                "location": project.get("location") or {"lat": 25.5941, "lng": 85.1376, "zoom": 19},
                "panel_id": defaults.get("panel_id") or "mod-540",
                "roofs": [],
                "obstructions": [],
                "status": "draft",
                "created_at": now,
                "updated_at": now,
                "nested_design_id": doc["id"],
            })
        await _projects().update_one({"id": project_id}, {"$set": {"updated_at": now}})
        return _public(doc)

    @router.get("/solar-projects/{project_id}/designs/{design_id}")
    async def get_nested_design(
        project_id: str,
        design_id: str,
        user: CurrentUser = Depends(get_current_user),
    ):
        doc = await _designs().find_one({"id": design_id, "project_id": project_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Design not found")
        return doc

    @router.patch("/solar-projects/{project_id}/designs/{design_id}")
    async def patch_nested_design(
        project_id: str,
        design_id: str,
        payload: NestedDesignPatch,
        user: CurrentUser = Depends(get_current_user),
    ):
        existing = await _designs().find_one({"id": design_id, "project_id": project_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Design not found")
        data = payload.model_dump(exclude_unset=True)
        if payload.defaults_profile:
            profile = await _defaults().find_one({"name": payload.defaults_profile}, {"_id": 0})
            if profile:
                data["defaults"] = {k: v for k, v in profile.items() if k not in {"id", "created_at", "updated_at"}}
        data["updated_at"] = _now()
        result = await _designs().find_one_and_update(
            {"id": design_id, "project_id": project_id},
            {"$set": data},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        return result

    @router.delete("/solar-projects/{project_id}/designs/{design_id}")
    async def delete_nested_design(
        project_id: str,
        design_id: str,
        user: CurrentUser = Depends(get_current_user),
    ):
        result = await _designs().delete_one({"id": design_id, "project_id": project_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Design not found")
        return {"ok": True, "id": design_id}

    @router.get("/defaults-profiles")
    async def list_defaults_profiles(user: CurrentUser = Depends(get_current_user)):
        await _seed_defaults()
        return await _defaults().find({}, {"_id": 0}).sort("name", 1).to_list(length=100)

    @router.post("/defaults-profiles", status_code=status.HTTP_201_CREATED)
    async def create_defaults_profile(
        payload: DefaultsProfileUpsert,
        user: CurrentUser = Depends(require_admin),
    ):
        dup = await _defaults().find_one({"name": payload.name})
        if dup:
            raise HTTPException(status_code=409, detail="Profile name already exists")
        now = _now()
        doc = {"id": str(uuid.uuid4()), "created_at": now, "updated_at": now, **payload.model_dump()}
        await _defaults().insert_one(doc)
        return _public(doc)

    @router.put("/defaults-profiles/{profile_id}")
    async def put_defaults_profile(
        profile_id: str,
        payload: DefaultsProfileUpsert,
        user: CurrentUser = Depends(require_admin),
    ):
        data = payload.model_dump()
        data["updated_at"] = _now()
        result = await _defaults().find_one_and_update(
            {"id": profile_id},
            {"$set": data},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not result:
            raise HTTPException(status_code=404, detail="Defaults profile not found")
        return result

    @router.delete("/defaults-profiles/{profile_id}")
    async def delete_defaults_profile(profile_id: str, user: CurrentUser = Depends(require_admin)):
        result = await _defaults().delete_one({"id": profile_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Defaults profile not found")
        return {"ok": True, "id": profile_id}
