"""Phase 5 — PM Surya Ghar subsidy, BOM pricing, 25-year payback/ROI."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from solar_engine import MONTHS, _irr, _panel_by_id

DEFAULT_SUBSIDY = {
    "id": "pm_surya_ghar",
    "name": "PM Surya Ghar",
    "residential_slab_1_kw": 2.0,
    "residential_slab_1_inr_per_kw": 30000.0,
    "residential_slab_2_inr_per_kw": 18000.0,
    "residential_max_inr": 78000.0,
    "commercial_inr": 0.0,
}

DEFAULT_TEMPLATE = {
    "id": "epc-std",
    "name": "Standard EPC (INR/W)",
    "mode": "per_w",
    "rate_per_w": 44.0,
    "items": [
        {"sku": "Solar modules", "category": "Module", "per_w": 18.0},
        {"sku": "Inverter", "category": "Inverter", "per_w": 8.5},
        {"sku": "Module mounting structure", "category": "Structure", "per_w": 4.5},
        {"sku": "Cabling & BOS", "category": "Electrical", "per_w": 5.0},
        {"sku": "Installation & commissioning", "category": "Installation", "per_w": 6.0},
        {"sku": "Net meter / liaison", "category": "Net-meter", "per_w": 2.0},
    ],
}

DEFAULT_BRANDING = {
    "logo": "/step-solar-logo.png",
    "primary": "#166534",
    "accent": "#15803d",
    "company": "STEP SOLAR ENERGY PVT. LTD.",
    "sections_enabled": {
        "overview": True,
        "design": True,
        "generation": True,
        "savings": True,
        "bom": True,
        "warranty": True,
        "terms": True,
        "payment": True,
    },
}

DEFAULT_WARRANTY = [
    "Modules: 12-year product / 25-year linear performance warranty (manufacturer).",
    "Inverter: 10-year manufacturer warranty (extendable).",
    "Structure & workmanship: 5 years by Step Solar.",
]

DEFAULT_TERMS = [
    "Price is valid for 15 days and exclusive of any new government levies.",
    "Net-metering / DISCOM liaison is included; DISCOM fees extra if levied.",
    "Civil extra if roof waterproofing or custom structure is required.",
    "Generation figures are modelled (pvlib / PVWatts / climate) and vary with weather.",
]

DEFAULT_PAYMENT = [
    {"milestone": "Booking / agreement", "pct": 20},
    {"milestone": "Material dispatch", "pct": 50},
    {"milestone": "Installation complete", "pct": 20},
    {"milestone": "Net-metering / commissioning", "pct": 10},
]


def _num(v: Any, fallback: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return fallback
        return float(v)
    except (TypeError, ValueError):
        return fallback


def _clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


def dc_kw_from_design(design: Dict[str, Any]) -> float:
    gen = design.get("generation") or {}
    if gen.get("dc_kw"):
        return _num(gen["dc_kw"])
    result = design.get("result") or {}
    sys = result.get("system") or {}
    if sys.get("dc_kw"):
        return _num(sys["dc_kw"])
    panel = _panel_by_id(design.get("panel_id"))
    count = int(sys.get("panel_count") or gen.get("panel_count") or 0)
    if count and panel:
        return round((count * panel["watt"]) / 1000.0, 3)
    return 0.0


def panel_count_from_design(design: Dict[str, Any]) -> int:
    gen = design.get("generation") or {}
    result = design.get("result") or {}
    sys = result.get("system") or {}
    return int(sys.get("panel_count") or gen.get("panel_count") or 0)


def project_type_of(design: Dict[str, Any], project: Optional[Dict[str, Any]] = None) -> str:
    raw = (
        (project or {}).get("project_type")
        or design.get("project_type")
        or ""
    )
    text = str(raw).strip().lower()
    if "comm" in text or "indus" in text or "office" in text:
        return "commercial"
    return "residential"


def calculate_subsidy(dc_kw: float, project_type: str, settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = {**DEFAULT_SUBSIDY, **(settings or {})}
    kw = max(0.0, _num(dc_kw))
    ptype = "commercial" if str(project_type).lower().startswith("comm") else "residential"
    if ptype == "commercial":
        amount = _num(cfg.get("commercial_inr"), 0.0)
        return {
            "scheme": cfg.get("name") or "PM Surya Ghar",
            "project_type": ptype,
            "dc_kw": round(kw, 3),
            "amount": round(amount),
            "capped": False,
            "breakdown": [{"label": "Commercial (not eligible)", "kw": round(kw, 3), "rate": 0, "amount": round(amount)}],
        }
    slab1_kw = max(0.0, _num(cfg.get("residential_slab_1_kw"), 2.0))
    rate1 = _num(cfg.get("residential_slab_1_inr_per_kw"), 30000.0)
    rate2 = _num(cfg.get("residential_slab_2_inr_per_kw"), 18000.0)
    cap = _num(cfg.get("residential_max_inr"), 78000.0)
    first = min(kw, slab1_kw)
    rest = max(0.0, kw - slab1_kw)
    a1 = first * rate1
    a2 = rest * rate2
    raw = a1 + a2
    amount = min(raw, cap)
    capped = raw >= cap - 0.01
    breakdown = [
        {"label": f"First {slab1_kw:g} kW", "kw": round(first, 3), "rate": rate1, "amount": round(a1)},
    ]
    if rest > 0:
        breakdown.append({"label": "Additional kW", "kw": round(rest, 3), "rate": rate2, "amount": round(a2)})
    return {
        "scheme": cfg.get("name") or "PM Surya Ghar",
        "project_type": ptype,
        "dc_kw": round(kw, 3),
        "amount": round(amount),
        "capped": capped,
        "cap": cap,
        "breakdown": breakdown,
    }


def pricing_from_template(
    design: Dict[str, Any],
    template: Optional[Dict[str, Any]] = None,
    overrides: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    dc_kw = dc_kw_from_design(design)
    watts = dc_kw * 1000.0
    tpl = template or DEFAULT_TEMPLATE
    if overrides:
        items = []
        total = 0.0
        for raw in overrides:
            qty = _num(raw.get("qty"), 1)
            unit = _num(raw.get("unit_cost") if raw.get("unit_cost") is not None else raw.get("amount"), 0)
            line = round(qty * unit)
            total += line
            items.append({
                "sku": raw.get("sku") or raw.get("desc") or "Item",
                "category": raw.get("category") or "Other",
                "qty": qty,
                "unit": raw.get("unit") or "set",
                "unit_cost": round(unit),
                "total": line,
            })
        return {"mode": "custom", "items": items, "total": round(total), "dc_kw": round(dc_kw, 3), "template_id": tpl.get("id")}
    mode = tpl.get("mode") or "per_w"
    if mode == "bom" and (design.get("result") or {}).get("bom"):
        bom = (design["result"]["bom"] or {})
        items = list(bom.get("items") or [])
        total = sum(_num(i.get("total")) for i in items)
        if not total:
            total = _num(bom.get("epc_target"))
        return {"mode": "bom", "items": items, "total": round(total), "dc_kw": round(dc_kw, 3), "template_id": tpl.get("id")}
    rate = _num(tpl.get("rate_per_w"), 44.0)
    rows = []
    assigned = 0.0
    specs = list(tpl.get("items") or DEFAULT_TEMPLATE["items"])
    for i, spec in enumerate(specs):
        per_w = _num(spec.get("per_w"))
        if per_w <= 0 and i == len(specs) - 1:
            per_w = max(0.0, rate - assigned)
        line = round(watts * per_w)
        assigned += per_w
        rows.append({
            "sku": spec.get("sku") or "Item",
            "category": spec.get("category") or "EPC",
            "qty": round(dc_kw, 3) if dc_kw else 1,
            "unit": "kW",
            "unit_cost": round(per_w * 1000.0),
            "total": line,
            "per_w": per_w,
        })
    total = sum(r["total"] for r in rows)
    if not rows:
        total = round(watts * rate)
        rows = [{"sku": "EPC turnkey", "category": "EPC", "qty": round(dc_kw, 3), "unit": "kW", "unit_cost": round(rate * 1000), "total": total}]
    return {"mode": "per_w", "items": rows, "total": round(total), "dc_kw": round(dc_kw, 3), "rate_per_w": rate, "template_id": tpl.get("id")}


def yearly_generation(design: Dict[str, Any]) -> Tuple[float, List[float], List[float]]:
    gen = design.get("generation") or {}
    yearly = [float(x) for x in (gen.get("yearly_kwh") or [])]
    year1 = _num(gen.get("annual_kwh"))
    monthly = [float(x) for x in (gen.get("monthly_kwh") or [])]
    if not year1:
        prod = ((design.get("result") or {}).get("production") or {})
        year1 = _num(prod.get("year1_kwh"))
        monthly = [float(x) for x in (prod.get("monthly_kwh") or monthly)]
    if not yearly and year1:
        yearly = [year1 * ((1.0 - 0.005) ** y) for y in range(25)]
    if len(yearly) < 25 and year1:
        base = yearly[0] if yearly else year1
        yearly = [base * ((1.0 - 0.005) ** y) for y in range(25)]
    if len(monthly) != 12:
        if year1:
            weights = [0.07, 0.075, 0.09, 0.095, 0.1, 0.09, 0.085, 0.08, 0.085, 0.085, 0.075, 0.07]
            s = sum(weights)
            monthly = [year1 * (w / s) for w in weights]
        else:
            monthly = [0.0] * 12
    return year1, monthly[:12], yearly[:25]


def cashflow_model(
    design: Dict[str, Any],
    capex: float,
    subsidy_amount: float,
    tariff: Optional[Dict[str, Any]] = None,
    consumption: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    year1, monthly, yearly = yearly_generation(design)
    dc_kw = dc_kw_from_design(design)
    tariff = tariff or {}
    price = _num(tariff.get("price_per_kwh"), _num(design.get("tariff"), 8.5))
    escalation = _num(tariff.get("escalation_rate"), _num(design.get("tariff_escalation"), 0.035) * 100.0)
    if escalation > 1.5:
        escalation = escalation / 100.0
    net_capex = max(0.0, capex - subsidy_amount)
    om_rate = _num(design.get("om_per_kw_year"), 800)
    discount = _num(design.get("discount_rate"), 0.08)
    cashflows = []
    cumulative = -net_capex
    payback = None
    npv = -net_capex
    for y in range(1, 26):
        kwh = yearly[y - 1] if y - 1 < len(yearly) else 0.0
        revenue = kwh * price * ((1 + escalation) ** (y - 1))
        om = dc_kw * om_rate * (1.03 ** (y - 1))
        net = revenue - om
        cumulative += net
        npv += net / ((1 + discount) ** y)
        if payback is None and cumulative >= 0:
            prev = cumulative - net
            payback = round(y - 1 + ((-prev / net) if net else 0), 2)
        cashflows.append({
            "year": y,
            "kwh": round(kwh),
            "revenue": round(revenue),
            "om": round(om),
            "net": round(net),
            "cumulative": round(cumulative),
        })
    irr = _irr([-net_capex] + [c["net"] for c in cashflows]) if net_capex > 0 else None
    total_savings = sum(c["revenue"] for c in cashflows)
    load = 0.0
    if consumption:
        current = consumption.get("current") or consumption
        load = sum(_num(x) for x in (current.get("monthly_kwh") or []))
    if not load:
        load = _num(design.get("annual_bill_kwh"))
    offset = _clamp((year1 / load) * 100.0, 0, 200) if load else 0.0
    return {
        "tariff": price,
        "escalation": round(escalation * 100.0, 2),
        "capex": round(capex),
        "subsidy": round(subsidy_amount),
        "net_capex": round(net_capex),
        "payback_years": payback,
        "irr": None if irr is None else round(irr, 3),
        "npv": round(npv),
        "total_savings_25": round(total_savings),
        "savings_y1": round(cashflows[0]["revenue"]) if cashflows else 0,
        "roi_25": round((cashflows[-1]["cumulative"] + net_capex) / net_capex, 2) if net_capex > 0 else 0,
        "year1_kwh": round(year1, 1),
        "monthly_kwh": [round(v, 1) for v in monthly],
        "months": MONTHS,
        "yearly_kwh": [round(v, 1) for v in yearly],
        "load_kwh": round(load, 1),
        "energy_offset_pct": round(offset, 1),
        "cashflows": cashflows,
        "dc_kw": round(dc_kw, 3),
    }


def assemble_proposal(
    design: Dict[str, Any],
    *,
    project: Optional[Dict[str, Any]] = None,
    tariff: Optional[Dict[str, Any]] = None,
    consumption: Optional[Dict[str, Any]] = None,
    subsidy_settings: Optional[Dict[str, Any]] = None,
    template: Optional[Dict[str, Any]] = None,
    pricing_items: Optional[List[Dict[str, Any]]] = None,
    branding: Optional[Dict[str, Any]] = None,
    financing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    dc_kw = dc_kw_from_design(design)
    ptype = project_type_of(design, project)
    pricing = pricing_from_template(design, template, pricing_items)
    subsidy = calculate_subsidy(dc_kw, ptype, subsidy_settings)
    finance = cashflow_model(design, pricing["total"], subsidy["amount"], tariff, consumption)
    brand = {**DEFAULT_BRANDING, **(branding or {})}
    sections = {**DEFAULT_BRANDING["sections_enabled"], **(brand.get("sections_enabled") or {})}
    brand["sections_enabled"] = sections
    sys = ((design.get("result") or {}).get("system") or {})
    loc = design.get("location") or {}
    return {
        "design_id": design.get("id"),
        "lead_id": design.get("lead_id") or (project or {}).get("lead_id"),
        "solar_project_id": design.get("solar_project_id") or (project or {}).get("id"),
        "pricing": pricing,
        "subsidy": subsidy,
        "finance": finance,
        "branding": brand,
        "financing": financing or {"partner": "Bank / NBFC", "url": "", "note": "Get Solar Financing - partner application"},
        "warranty": list(DEFAULT_WARRANTY),
        "terms": list(DEFAULT_TERMS),
        "payment_schedule": list(DEFAULT_PAYMENT),
        "system": {
            "name": design.get("name"),
            "address": design.get("address") or (project or {}).get("address"),
            "client_name": (project or {}).get("customer_name") or (project or {}).get("name"),
            "lat": loc.get("lat"),
            "lng": loc.get("lng"),
            "dc_kw": round(dc_kw, 3),
            "ac_kw": sys.get("ac_kw"),
            "panel_count": panel_count_from_design(design),
            "panel_id": design.get("panel_id"),
            "spec_gen": (design.get("generation") or {}).get("spec_gen"),
            "performance_ratio": (design.get("generation") or {}).get("performance_ratio"),
            "source": (design.get("generation") or {}).get("source"),
        },
    }
