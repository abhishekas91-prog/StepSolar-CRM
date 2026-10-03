from __future__ import annotations

from typing import Any, Dict, List, Optional

DEFAULT_DAILY_PROFILE: List[float] = [
    0.028, 0.024, 0.022, 0.021, 0.022, 0.028,
    0.042, 0.055, 0.052, 0.040, 0.035, 0.033,
    0.032, 0.033, 0.034, 0.036, 0.042, 0.058,
    0.072, 0.068, 0.060, 0.050, 0.040, 0.033,
]

DEFAULT_TOU_SLOTS = [
    {"name": "Off-peak", "start": "22:00", "end": "06:00", "price_per_kwh": 6.5},
    {"name": "Day", "start": "06:00", "end": "18:00", "price_per_kwh": 8.5},
    {"name": "Peak", "start": "18:00", "end": "22:00", "price_per_kwh": 10.5},
]

BD_TEAM_DEFAULTS = {
    "name": "BD TEAM",
    "panel_id": "mod-540",
    "tilt": 18.0,
    "azimuth": 180.0,
    "setback_m": 0.4,
    "row_gap_m": 0.02,
    "col_gap_m": 0.02,
    "soiling_loss": 0.03,
    "orientation": "portrait",
    "notes": "Default rooftop layout for BD team",
}


def kwh_from_bill(bill_rs: float, price_per_kwh: float) -> float:
    price = float(price_per_kwh or 0)
    if price <= 0:
        return 0.0
    return round(float(bill_rs or 0) / price, 2)


def months_from_average(avg_kwh: float) -> List[float]:
    v = round(float(avg_kwh or 0), 2)
    return [v] * 12


def pad_months(values: Optional[List[Any]], fill: float = 0.0) -> List[float]:
    raw = list(values or [])[:12]
    while len(raw) < 12:
        raw.append(fill)
    return [round(float(x or 0), 2) for x in raw]


def pad_daily(values: Optional[List[Any]]) -> List[float]:
    raw = list(values or [])[:24]
    if len(raw) != 24:
        return list(DEFAULT_DAILY_PROFILE)
    total = sum(float(x or 0) for x in raw)
    if total <= 0:
        return list(DEFAULT_DAILY_PROFILE)
    return [round(float(x or 0) / total, 4) for x in raw]


def empty_tariff(project_id: str) -> Dict[str, Any]:
    return {
        "project_id": project_id,
        "mode": "flat",
        "metering": "net_metering",
        "price_per_kwh": 8.5,
        "escalation_rate": 3.5,
        "zero_export": False,
        "export_only": False,
        "tou_slots": [dict(s) for s in DEFAULT_TOU_SLOTS],
    }


def empty_consumption(project_id: str, monthly_kwh: Optional[float] = None) -> Dict[str, Any]:
    months = months_from_average(monthly_kwh if monthly_kwh is not None else 600)
    profile = {
        "monthly_kwh": months,
        "daily_profile": list(DEFAULT_DAILY_PROFILE),
    }
    return {
        "project_id": project_id,
        "type": "monthly_avg",
        "current": {**profile},
        "future": {**profile, "monthly_kwh": list(months)},
    }


def apply_bill_estimate(consumption: Dict[str, Any], bill_rs: float, price_per_kwh: float, which: str = "current") -> Dict[str, Any]:
    kwh = kwh_from_bill(bill_rs, price_per_kwh)
    target = dict(consumption.get(which) or {})
    target["monthly_kwh"] = months_from_average(kwh)
    target["monthly_bill_rs"] = round(float(bill_rs or 0), 2)
    if not target.get("daily_profile"):
        target["daily_profile"] = list(DEFAULT_DAILY_PROFILE)
    out = dict(consumption)
    out[which] = target
    out["type"] = "monthly_bill"
    return out
