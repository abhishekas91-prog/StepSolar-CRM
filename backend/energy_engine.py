"""Annual generation — pvlib first, then NREL PVWatts, then climate model."""
from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from solar_engine import (
    DAYS,
    MONTHS,
    _panel_by_id,
    climate_for,
    layout_panels,
    poa_factor,
    shade_loss,
)

DEFAULT_SYSTEM_LOSSES = 0.14
DEGRADATION = 0.005
CLEARSKY_SCALE = 0.72


def _clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


def _dc_and_subarrays(design: Dict[str, Any]) -> Tuple[float, List[Dict[str, Any]], int]:
    panel = _panel_by_id(design.get("panel_id") or design.get("panelId"))
    roofs = design.get("roofs") or []
    layouts = []
    count = 0
    for roof in roofs:
        panels = layout_panels(roof, panel)
        layouts.append({"roof": roof, "panels": panels})
        count += len(panels)
    existing = ((design.get("result") or {}).get("system") or {}).get("dc_kw")
    if count:
        dc_kw = (count * panel["watt"]) / 1000.0
    elif existing:
        dc_kw = float(existing)
        count = int(((design.get("result") or {}).get("system") or {}).get("panel_count") or 0)
    else:
        dc_kw = 0.0
    subarrays = []
    for item in layouts:
        roof = item["roof"]
        n = len(item["panels"])
        share = (n / count) if count else (1.0 / max(len(roofs), 1))
        subarrays.append({
            "id": roof.get("id"),
            "name": roof.get("name") or "Roof",
            "tilt": float(roof.get("tilt") or 18),
            "azimuth": float(roof.get("azimuth") or 180),
            "dc_kw": round(dc_kw * share, 3) if dc_kw else 0.0,
            "panel_count": n,
        })
    if not subarrays:
        loc_tilt = float((design.get("defaults") or {}).get("tilt") or 18)
        loc_az = float((design.get("defaults") or {}).get("azimuth") or 180)
        subarrays.append({
            "id": "default",
            "name": "Array",
            "tilt": loc_tilt,
            "azimuth": loc_az,
            "dc_kw": round(dc_kw, 3),
            "panel_count": count,
        })
    return round(dc_kw, 3), subarrays, count


def _shading_factor(design: Dict[str, Any], override: Optional[float]) -> float:
    if override is not None:
        return _clamp(float(override), 0.5, 1.0)
    cached = (design.get("irradiance") or {}).get("solar_access")
    if cached:
        return _clamp(float(cached), 0.5, 1.0)
    loss = shade_loss(design.get("obstructions") or [], design.get("roofs") or [])
    return _clamp(1.0 - loss, 0.7, 1.0)


def _pvlib_monthly(lat: float, lng: float, subarrays: List[Dict[str, Any]], losses: float, shading: float) -> Optional[List[float]]:
    try:
        import pandas as pd
        from pvlib.irradiance import get_total_irradiance
        from pvlib.location import Location
    except Exception:
        return None
    try:
        loc = Location(lat, lng, tz="Asia/Kolkata", name="site")
        times = pd.date_range("2023-01-01", "2023-12-31 23:00", freq="h", tz=loc.tz)
        cs = loc.get_clearsky(times)
        solpos = loc.get_solarposition(times)
        monthly = [0.0] * 12
        for sub in subarrays:
            dc = float(sub.get("dc_kw") or 0)
            if dc <= 0:
                continue
            poa = get_total_irradiance(
                surface_tilt=float(sub.get("tilt") or 18),
                surface_azimuth=float(sub.get("azimuth") or 180),
                dni=cs["dni"],
                ghi=cs["ghi"],
                dhi=cs["dhi"],
                solar_zenith=solpos["apparent_zenith"],
                solar_azimuth=solpos["azimuth"],
            )
            ac = dc * (poa["poa_global"] * CLEARSKY_SCALE / 1000.0) * (1.0 - losses) * shading
            grouped = ac.groupby(ac.index.month).sum()
            for month in range(1, 13):
                monthly[month - 1] += float(grouped.get(month, 0.0))
        if sum(monthly) <= 0:
            return None
        return monthly
    except Exception:
        return None


def _pvwatts_monthly(lat: float, lng: float, dc_kw: float, tilt: float, azimuth: float, losses_pct: float) -> Optional[List[float]]:
    key = (os.environ.get("NREL_API_KEY") or os.environ.get("PVWATTS_API_KEY") or "").strip()
    if not key or dc_kw <= 0:
        return None
    try:
        import urllib.parse
        import urllib.request
        import json

        qs = urllib.parse.urlencode({
            "api_key": key,
            "lat": f"{lat:.4f}",
            "lon": f"{lng:.4f}",
            "system_capacity": f"{dc_kw:.3f}",
            "azimuth": f"{azimuth:.1f}",
            "tilt": f"{tilt:.1f}",
            "array_type": 1,
            "module_type": 1,
            "losses": f"{losses_pct:.1f}",
        })
        url = "https://developer.nrel.gov/api/pvwatts/v8.json?" + qs
        req = urllib.request.Request(url, headers={"User-Agent": "StepSolar-CRM/1.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        ac = ((data.get("outputs") or {}).get("ac_monthly") or [])
        if len(ac) != 12:
            return None
        return [float(v) for v in ac]
    except Exception:
        return None


def _climate_monthly(lat: float, dc_kw: float, tilt: float, azimuth: float, losses: float, shading: float) -> List[float]:
    climate = climate_for(lat)
    poa = poa_factor(tilt, azimuth, lat)
    derate = (1.0 - losses) * shading
    out = []
    for i, psh in enumerate(climate["peak_sun_hours"]):
        out.append(dc_kw * psh * DAYS[i] * poa * derate)
    return out


def _weighted_tilt_az(subarrays: List[Dict[str, Any]]) -> Tuple[float, float]:
    total = sum(float(s.get("dc_kw") or 0) for s in subarrays) or 1.0
    tilt = sum(float(s.get("tilt") or 18) * float(s.get("dc_kw") or 0) for s in subarrays) / total
    az = sum(float(s.get("azimuth") or 180) * float(s.get("dc_kw") or 0) for s in subarrays) / total
    return tilt, az


def consumption_yearly_kwh(consumption: Optional[Dict[str, Any]]) -> float:
    if not consumption:
        return 0.0
    current = consumption.get("current") or consumption
    months = current.get("monthly_kwh") or []
    return float(sum(float(x or 0) for x in months))


def generate_energy(
    design: Dict[str, Any],
    consumption: Optional[Dict[str, Any]] = None,
    shading_factor: Optional[float] = None,
    system_losses: Optional[float] = None,
) -> Dict[str, Any]:
    loc = design.get("location") or {}
    lat = float(loc.get("lat") or 25.61)
    lng = float(loc.get("lng") or 85.14)
    losses = DEFAULT_SYSTEM_LOSSES if system_losses is None else _clamp(float(system_losses), 0.0, 0.45)
    shade = _shading_factor(design, shading_factor)
    dc_kw, subarrays, panel_count = _dc_and_subarrays(design)
    tilt, azimuth = _weighted_tilt_az(subarrays)

    source = "climate"
    monthly = _pvlib_monthly(lat, lng, subarrays, losses, shade)
    if monthly:
        source = "pvlib"
    else:
        monthly = _pvwatts_monthly(lat, lng, dc_kw, tilt, azimuth, losses * 100.0)
        if monthly:
            source = "pvwatts"
            monthly = [v * shade for v in monthly]
        else:
            monthly = _climate_monthly(lat, dc_kw, tilt, azimuth, losses, shade)
            source = "climate"

    year1 = sum(monthly)
    spec = (year1 / dc_kw) if dc_kw else 0.0
    ghi = climate_for(lat)["ghi_annual"]
    poa_est = ghi * poa_factor(tilt, azimuth, lat)
    pr = _clamp((spec / poa_est) if poa_est else 0.0, 0.50, 0.95) if spec else 0.0
    annual = [year1 * ((1.0 - DEGRADATION) ** y) for y in range(25)]
    load = consumption_yearly_kwh(consumption)
    if not load:
        load = float(design.get("annual_bill_kwh") or 0)
    offset = _clamp((year1 / load) * 100.0, 0, 200) if load else 0.0
    now = datetime.now(timezone.utc).isoformat()
    return {
        "generated_at": now,
        "source": source,
        "lat": lat,
        "lng": lng,
        "dc_kw": round(dc_kw, 2),
        "panel_count": panel_count,
        "tilt": round(tilt, 1),
        "azimuth": round(azimuth, 1),
        "system_losses": round(losses * 100.0, 1),
        "shading_factor": round(shade, 3),
        "monthly_kwh": [round(v, 1) for v in monthly],
        "annual_kwh": round(year1, 1),
        "annual_mwh": round(year1 / 1000.0, 3),
        "spec_gen": round(spec, 0),
        "performance_ratio": round(pr * 100.0, 1),
        "energy_offset_pct": round(offset, 1),
        "load_kwh": round(load, 1),
        "degradation_pct": DEGRADATION * 100.0,
        "yearly_kwh": [round(v, 1) for v in annual],
        "subarrays": subarrays,
        "months": MONTHS,
    }
