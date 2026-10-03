"""Roof solar access — Google Solar API with pvlib/shadow fallback. Cached in Mongo."""
from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from solar_engine import _bounds, _haversine, _m_to_lat, _m_to_lng, _point_in_polygon, climate_for

CACHE_TTL_HOURS = 24 * 14


def _clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


def _rad(d: float) -> float:
    return d * math.pi / 180.0


def cache_key(lat: float, lng: float, roofs: List[Dict[str, Any]], obstructions: List[Dict[str, Any]]) -> str:
    payload = {
        "lat": round(float(lat), 5),
        "lng": round(float(lng), 5),
        "roofs": [
            {
                "id": r.get("id"),
                "tilt": r.get("tilt"),
                "azimuth": r.get("azimuth"),
                "points": [{"lat": round(p.get("lat", 0), 6), "lng": round(p.get("lng", 0), 6)} for p in (r.get("points") or [])],
            }
            for r in (roofs or [])
        ],
        "obs": [
            {"lat": round(float(o.get("lat") or 0), 5), "lng": round(float(o.get("lng") or 0), 5), "h": round(float(o.get("height_m") or o.get("heightM") or 0), 1)}
            for o in (obstructions or [])
        ],
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _solar_api_key() -> str:
    return (
        os.environ.get("GOOGLE_SOLAR_API_KEY")
        or os.environ.get("GOOGLE_MAPS_API_KEY")
        or ""
    ).strip()


def _google_building_insights(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    key = _solar_api_key()
    if not key:
        return None
    try:
        import urllib.parse
        import urllib.request

        qs = urllib.parse.urlencode({
            "location.latitude": f"{lat:.6f}",
            "location.longitude": f"{lng:.6f}",
            "requiredQuality": "HIGH",
            "key": key,
        })
        url = "https://solar.googleapis.com/v1/buildingInsights:findClosest?" + qs
        req = urllib.request.Request(url, headers={"User-Agent": "StepSolar-CRM/1.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def _access_from_insights(data: Dict[str, Any]) -> Tuple[float, List[Dict[str, Any]]]:
    potential = data.get("solarPotential") or {}
    hours = float(potential.get("maxSunshineHoursPerYear") or 0)
    # India rooftop typical 1400–1900 sunshine hours; map to 0.7–1.0
    access = _clamp(0.7 + (hours - 1400.0) / 2500.0, 0.7, 1.0) if hours else 0.82
    cells: List[Dict[str, Any]] = []
    for seg in potential.get("roofSegmentStats") or []:
        stats = seg.get("stats") or seg
        quantiles = stats.get("sunshineQuantiles") or seg.get("sunshineQuantiles") or []
        if quantiles:
            q = float(quantiles[len(quantiles) // 2])
            cell_access = _clamp(0.7 + (q - 1400.0) / 2500.0, 0.7, 1.0)
        else:
            cell_access = access
        sw = (seg.get("boundingBox") or {}).get("sw") or {}
        ne = (seg.get("boundingBox") or {}).get("ne") or {}
        if sw and ne:
            cells.append({
                "lat": (float(sw.get("latitude") or 0) + float(ne.get("latitude") or 0)) / 2,
                "lng": (float(sw.get("longitude") or 0) + float(ne.get("longitude") or 0)) / 2,
                "solar_access": round(cell_access, 3),
            })
        pitch = seg.get("pitchDegrees")
        az = seg.get("azimuthDegrees")
        if pitch is not None and az is not None and not cells:
            cells.append({"lat": None, "lng": None, "solar_access": round(cell_access, 3), "tilt": pitch, "azimuth": az})
    return round(access, 3), cells


def sun_position(lat: float, lng: float, day_of_year: int, hour: float) -> Dict[str, float]:
    """Solar altitude / azimuth. pvlib if present, else SPA-lite."""
    try:
        import pandas as pd
        from pvlib.location import Location

        year = 2023
        ts = pd.Timestamp(year=year, month=1, day=1) + pd.Timedelta(days=int(day_of_year) - 1, hours=float(hour))
        ts = ts.tz_localize("Asia/Kolkata")
        loc = Location(lat, lng, tz="Asia/Kolkata")
        pos = loc.get_solarposition(pd.DatetimeIndex([ts]))
        alt = float(90.0 - pos["apparent_zenith"].iloc[0])
        az = float(pos["azimuth"].iloc[0])
        return {"altitude": alt, "azimuth": az, "zenith": float(pos["apparent_zenith"].iloc[0])}
    except Exception:
        return _sun_position_approx(lat, day_of_year, hour)


def _sun_position_approx(lat: float, day_of_year: int, hour: float) -> Dict[str, float]:
    decl = 23.44 * math.sin(_rad(360.0 * (284 + day_of_year) / 365.0))
    ha = 15.0 * (hour - 12.0)
    sin_alt = math.sin(_rad(lat)) * math.sin(_rad(decl)) + math.cos(_rad(lat)) * math.cos(_rad(decl)) * math.cos(_rad(ha))
    alt = math.degrees(math.asin(_clamp(sin_alt, -1, 1)))
    cos_az = (math.sin(_rad(decl)) - math.sin(_rad(lat)) * math.sin(_rad(alt))) / (math.cos(_rad(lat)) * math.cos(_rad(alt)) + 1e-9)
    az = math.degrees(math.acos(_clamp(cos_az, -1, 1)))
    if ha > 0:
        az = 360.0 - az
    return {"altitude": alt, "azimuth": az, "zenith": 90.0 - alt}


def _bearing(a: Dict[str, float], b: Dict[str, float]) -> float:
    dlon = _rad(b["lng"] - a["lng"])
    y = math.sin(dlon) * math.cos(_rad(b["lat"]))
    x = math.cos(_rad(a["lat"])) * math.sin(_rad(b["lat"])) - math.sin(_rad(a["lat"])) * math.cos(_rad(b["lat"])) * math.cos(dlon)
    brng = math.degrees(math.atan2(y, x))
    return (brng + 360.0) % 360.0


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def shadow_access(lat: float, lng: float, roofs: List[Dict[str, Any]], obstructions: List[Dict[str, Any]]) -> Tuple[float, List[Dict[str, Any]]]:
    cells: List[Dict[str, Any]] = []
    samples: List[Dict[str, float]] = []
    for roof in roofs or []:
        pts = roof.get("points") or []
        if len(pts) < 3:
            continue
        min_lat, max_lat, min_lng, max_lng = _bounds(pts)
        lat0 = (min_lat + max_lat) / 2
        step_lat = _m_to_lat(2.4)
        step_lng = _m_to_lng(2.4, lat0)
        rlat = min_lat
        while rlat <= max_lat:
            rlng = min_lng
            while rlng <= max_lng:
                p = {"lat": rlat, "lng": rlng}
                if _point_in_polygon(p, pts):
                    samples.append(p)
                rlng += step_lng
            rlat += step_lat
        if not samples:
            samples.append({"lat": lat0, "lng": (min_lng + max_lng) / 2})

    hours = (9.0, 12.0, 15.0)
    days = (80, 172, 266, 355)
    suns = [sun_position(lat, lng, d, h) for d in days for h in hours]
    suns = [s for s in suns if s["altitude"] > 8]

    if not samples:
        samples = [{"lat": lat, "lng": lng}]

    for p in samples[:80]:
        shade_hits = 0
        checks = 0
        for sun in suns:
            checks += 1
            alt = max(sun["altitude"], 6.0)
            for obs in obstructions or []:
                o = {"lat": float(obs.get("lat") or 0), "lng": float(obs.get("lng") or 0)}
                if not o["lat"]:
                    continue
                dist = _haversine(p, o)
                height = float(obs.get("height_m") or obs.get("heightM") or 8)
                shadow_len = height / max(math.tan(_rad(alt)), 0.08)
                brng = _bearing(p, o)
                if dist < shadow_len and _angle_diff(brng, sun["azimuth"]) < 35:
                    shade_hits += 1
                    break
        frac = 1.0 - (shade_hits / checks if checks else 0)
        access = _clamp(frac, 0.7, 1.0)
        if not (obstructions or []):
            access = 0.94
        cells.append({"lat": p["lat"], "lng": p["lng"], "solar_access": round(access, 3)})

    avg = sum(c["solar_access"] for c in cells) / len(cells) if cells else 0.9
    ghi = climate_for(lat)["ghi_annual"]
    climate_boost = _clamp((ghi - 1600) / 4000.0, -0.04, 0.06)
    avg = _clamp(avg + climate_boost, 0.7, 1.0)
    return round(avg, 3), cells


def compute_irradiance(design: Dict[str, Any]) -> Dict[str, Any]:
    loc = design.get("location") or {}
    lat = float(loc.get("lat") or 25.61)
    lng = float(loc.get("lng") or 85.14)
    roofs = design.get("roofs") or []
    obs = design.get("obstructions") or []
    source = "shadow"
    google = _google_building_insights(lat, lng)
    cells: List[Dict[str, Any]] = []
    access = 0.9
    if google:
        access, cells = _access_from_insights(google)
        source = "google_solar"
        if not cells:
            _, cells = shadow_access(lat, lng, roofs, obs)
    else:
        access, cells = shadow_access(lat, lng, roofs, obs)
        source = "shadow"
    return {
        "lat": lat,
        "lng": lng,
        "solar_access": access,
        "min_access": 0.7,
        "max_access": 1.0,
        "cells": cells,
        "source": source,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "cache_key": cache_key(lat, lng, roofs, obs),
    }
