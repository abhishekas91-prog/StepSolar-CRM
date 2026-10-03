"""Phase 5 design proposals — additive CRM routes (does not change /crm/leads shapes)."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument

from proposal_engine import (
    DEFAULT_SUBSIDY,
    DEFAULT_TEMPLATE,
    assemble_proposal,
)
from proposal_pdf import generate_proposal_pdf

router = APIRouter()
_ctx: Dict[str, Any] = {}


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


def _proposals():
    return _ctx["proposals"]


def _templates():
    return _ctx["pricing_templates"]


def _settings():
    return _ctx["settings"]


def _pv_designs():
    return _ctx["pv_designs"]


def _solar_projects():
    return _ctx.get("solar_projects")


def _tariffs():
    return _ctx.get("tariff_profiles")


def _consumption():
    return _ctx.get("consumption_profiles")


def _leads():
    return _ctx.get("leads")


SUBSIDY_SETTINGS_ID = "pm_surya_ghar"


class PricingItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sku: str = Field(min_length=1, max_length=160)
    category: Optional[str] = Field(default="EPC", max_length=80)
    qty: float = Field(default=1, ge=0)
    unit: Optional[str] = Field(default="set", max_length=24)
    unit_cost: float = Field(default=0, ge=0)


class BrandingBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    logo: Optional[str] = None
    primary: Optional[str] = None
    accent: Optional[str] = None
    company: Optional[str] = None
    sections_enabled: Optional[Dict[str, bool]] = None


class FinancingBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    partner: Optional[str] = None
    url: Optional[str] = None
    note: Optional[str] = None


class GenerateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    template_id: Optional[str] = None
    items: Optional[List[PricingItem]] = None
    branding: Optional[BrandingBody] = None
    financing: Optional[FinancingBody] = None
    mark_pipeline: bool = True


class PatchProposal(BaseModel):
    model_config = ConfigDict(extra="ignore")
    items: Optional[List[PricingItem]] = None
    branding: Optional[BrandingBody] = None
    financing: Optional[FinancingBody] = None


class TemplateUpsert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=80)
    mode: str = Field(default="per_w")
    rate_per_w: float = Field(default=44.0, ge=0, le=200)
    items: Optional[List[Dict[str, Any]]] = None


class SubsidySettingsBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    residential_slab_1_kw: Optional[float] = Field(default=None, ge=0, le=10)
    residential_slab_1_inr_per_kw: Optional[float] = Field(default=None, ge=0)
    residential_slab_2_inr_per_kw: Optional[float] = Field(default=None, ge=0)
    residential_max_inr: Optional[float] = Field(default=None, ge=0)
    commercial_inr: Optional[float] = Field(default=None, ge=0)


def _token() -> str:
    return secrets.token_urlsafe(24)


async def _seed_templates() -> None:
    existing = await _templates().find_one({"id": DEFAULT_TEMPLATE["id"]})
    if existing:
        return
    now = _now()
    await _templates().insert_one({**DEFAULT_TEMPLATE, "created_at": now, "updated_at": now})


async def _subsidy_settings() -> Dict[str, Any]:
    doc = await _settings().find_one({"id": SUBSIDY_SETTINGS_ID}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_SUBSIDY)
    return {**DEFAULT_SUBSIDY, **doc}


async def _design_or_404(design_id: str) -> Dict[str, Any]:
    doc = await _pv_designs().find_one({"id": design_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Design not found")
    return doc


async def _related(design: Dict[str, Any]) -> Dict[str, Any]:
    project = None
    pid = design.get("solar_project_id")
    if pid and _solar_projects() is not None:
        project = await _solar_projects().find_one({"id": pid}, {"_id": 0})
    tariff = None
    consumption = None
    if project and _tariffs() is not None:
        tariff = await _tariffs().find_one({"project_id": project["id"]}, {"_id": 0})
    if project and _consumption() is not None:
        consumption = await _consumption().find_one({"project_id": project["id"]}, {"_id": 0})
    return {"project": project, "tariff": tariff, "consumption": consumption}


async def _mark_pipeline(lead_id: Optional[str], user: Any, public_url: str) -> None:
    if not lead_id or _leads() is None:
        return
    lead = await _leads().find_one({"id": lead_id})
    if not lead:
        return
    stages = list(lead.get("stages") or [])
    now = _now()
    changed = False
    for s in stages:
        if s.get("key") in {"quotation_sent", "vendor"} and s.get("status") != "Completed":
            s["status"] = "Completed"
            s["updatedAt"] = now
            s["notes"] = (s.get("notes") or "") + (" | " if s.get("notes") else "") + "Design proposal sent"
            changed = True
            break
    patch: Dict[str, Any] = {"updated_at": now, "pv_proposal_url": public_url}
    if changed:
        patch["stages"] = stages
    await _leads().update_one({"id": lead_id}, {"$set": patch})
    push = _ctx.get("push_activity")
    if push:
        await push(lead_id, user, "proposal.sent", "Design proposal generated")
    notify = _ctx.get("notify_whatsapp")
    if notify:
        try:
            await notify(lead, "QUOTATION_SENT", {"link": public_url})
        except Exception:
            pass


def register() -> None:
    CurrentUser = _ctx["CurrentUser"]
    get_current_user = _user()
    require_admin = _admin()

    @router.get("/pricing-templates")
    async def list_templates(user: CurrentUser = Depends(get_current_user)):
        await _seed_templates()
        return await _templates().find({}, {"_id": 0}).sort("name", 1).to_list(length=50)

    @router.post("/pricing-templates", status_code=201)
    async def create_template(payload: TemplateUpsert, user: CurrentUser = Depends(require_admin)):
        now = _now()
        doc = {"id": str(uuid.uuid4()), "created_at": now, "updated_at": now, **payload.model_dump()}
        await _templates().insert_one(doc)
        return _public(doc)

    @router.put("/pricing-templates/{template_id}")
    async def put_template(template_id: str, payload: TemplateUpsert, user: CurrentUser = Depends(require_admin)):
        data = payload.model_dump()
        data["updated_at"] = _now()
        result = await _templates().find_one_and_update(
            {"id": template_id},
            {"$set": data},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not result:
            raise HTTPException(status_code=404, detail="Template not found")
        return result

    @router.get("/subsidy-settings")
    async def get_subsidy(user: CurrentUser = Depends(get_current_user)):
        return await _subsidy_settings()

    @router.put("/subsidy-settings")
    async def put_subsidy(payload: SubsidySettingsBody, user: CurrentUser = Depends(require_admin)):
        data = {k: v for k, v in payload.model_dump().items() if v is not None}
        data["id"] = SUBSIDY_SETTINGS_ID
        data["updated_at"] = _now()
        data["updated_by"] = user.full_name or user.email
        await _settings().update_one({"id": SUBSIDY_SETTINGS_ID}, {"$set": data}, upsert=True)
        return await _subsidy_settings()

    @router.get("/designs/{design_id}/proposal")
    async def get_proposal(design_id: str, user: CurrentUser = Depends(get_current_user)):
        await _design_or_404(design_id)
        doc = await _proposals().find_one({"design_id": design_id}, {"_id": 0}, sort=[("generated_at", -1)])
        if not doc:
            raise HTTPException(status_code=404, detail="Proposal not found")
        return doc

    @router.post("/designs/{design_id}/proposal")
    async def generate_proposal(
        design_id: str,
        payload: Optional[GenerateBody] = None,
        user: CurrentUser = Depends(get_current_user),
    ):
        design = await _design_or_404(design_id)
        related = await _related(design)
        await _seed_templates()
        body = payload or GenerateBody()
        template = None
        if body.template_id:
            template = await _templates().find_one({"id": body.template_id}, {"_id": 0})
        if not template:
            template = await _templates().find_one({"id": DEFAULT_TEMPLATE["id"]}, {"_id": 0})
        subsidy = await _subsidy_settings()
        assembled = assemble_proposal(
            design,
            project=related["project"],
            tariff=related["tariff"],
            consumption=related["consumption"],
            subsidy_settings=subsidy,
            template=template,
            pricing_items=[i.model_dump() for i in (body.items or [])] or None,
            branding=body.branding.model_dump(exclude_none=True) if body.branding else None,
            financing=body.financing.model_dump(exclude_none=True) if body.financing else None,
        )
        now = _now()
        existing = await _proposals().find_one({"design_id": design_id})
        token = (existing or {}).get("public_token") or _token()
        doc = {
            "id": (existing or {}).get("id") or str(uuid.uuid4()),
            "design_id": design_id,
            "public_token": token,
            "generated_at": now,
            "updated_at": now,
            "created_by": user.full_name or user.email,
            **assembled,
        }
        await _proposals().update_one({"design_id": design_id}, {"$set": doc}, upsert=True)
        public_url = f"/#/p/{token}"
        doc["public_url"] = public_url
        await _proposals().update_one({"id": doc["id"]}, {"$set": {"public_url": public_url}})
        if body.mark_pipeline:
            await _mark_pipeline(assembled.get("lead_id"), user, public_url)
        return _public(doc)

    @router.patch("/designs/{design_id}/proposal")
    async def patch_proposal(
        design_id: str,
        payload: PatchProposal,
        user: CurrentUser = Depends(get_current_user),
    ):
        existing = await _proposals().find_one({"design_id": design_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Proposal not found — generate first")
        design = await _design_or_404(design_id)
        related = await _related(design)
        subsidy = await _subsidy_settings()
        template = None
        tid = (existing.get("pricing") or {}).get("template_id")
        if tid:
            template = await _templates().find_one({"id": tid}, {"_id": 0})
        branding = existing.get("branding") or {}
        if payload.branding:
            branding = {**branding, **payload.branding.model_dump(exclude_none=True)}
            if payload.branding.sections_enabled:
                branding["sections_enabled"] = {
                    **(branding.get("sections_enabled") or {}),
                    **payload.branding.sections_enabled,
                }
        financing = existing.get("financing") or {}
        if payload.financing:
            financing = {**financing, **payload.financing.model_dump(exclude_none=True)}
        items = [i.model_dump() for i in payload.items] if payload.items is not None else None
        assembled = assemble_proposal(
            design,
            project=related["project"],
            tariff=related["tariff"],
            consumption=related["consumption"],
            subsidy_settings=subsidy,
            template=template,
            pricing_items=items,
            branding=branding,
            financing=financing,
        )
        now = _now()
        assembled["updated_at"] = now
        assembled["generated_at"] = now
        await _proposals().update_one({"id": existing["id"]}, {"$set": assembled})
        return await _proposals().find_one({"id": existing["id"]}, {"_id": 0})

    @router.get("/designs/{design_id}/proposal.pdf")
    async def proposal_pdf(design_id: str, user: CurrentUser = Depends(get_current_user)):
        doc = await _proposals().find_one({"design_id": design_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Proposal not found")
        data, filename = generate_proposal_pdf(doc, public_url=doc.get("public_url") or "")
        return Response(
            content=data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @router.post("/designs/{design_id}/proposal/share")
    async def share_proposal(design_id: str, user: CurrentUser = Depends(get_current_user)):
        doc = await _proposals().find_one({"design_id": design_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Proposal not found")
        lead_id = doc.get("lead_id")
        public_url = doc.get("public_url") or f"/#/p/{doc.get('public_token')}"
        await _mark_pipeline(lead_id, user, public_url)
        wa = {"ok": False, "error": "no_lead"}
        notify = _ctx.get("notify_whatsapp")
        if lead_id and _leads() is not None and notify:
            lead = await _leads().find_one({"id": lead_id})
            if lead:
                wa = await notify(lead, "QUOTATION_SENT", {"link": public_url})
        return {"ok": True, "public_url": public_url, "whatsapp": wa}
