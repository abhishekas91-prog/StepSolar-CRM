"""Remote PV design engine — layout, energy, strings, BOM, 25-yr finance."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

PANEL_CATALOG: List[Dict[str, Any]] = [
    {"id": "mod-540", "brand": "SunPower", "model": "SPR-MAX3-540", "watt": 540, "voc": 49.6, "isc": 13.85, "vmp": 41.8, "imp": 12.92, "efficiency": 22.8, "width_mm": 1134, "height_mm": 2278, "temp_coeff_pmax": -0.29, "warranty_years": 40},
    {"id": "mod-580", "brand": "JA Solar", "model": "JAM72S30-580", "watt": 580, "voc": 50.4, "isc": 14.52, "vmp": 42.5, "imp": 13.65, "efficiency": 22.5, "width_mm": 1134, "height_mm": 2278, "temp_coeff_pmax": -0.35, "warranty_years": 25},
    {"id": "mod-445", "brand": "Canadian Solar", "model": "CS6W-445MS", "watt": 445, "voc": 49.1, "isc": 11.52, "vmp": 41.2, "imp": 10.81, "efficiency": 20.4, "width_mm": 1134, "height_mm": 2094, "temp_coeff_pmax": -0.34, "warranty_years": 25},
    {"id": "mod-400", "brand": "Trina", "model": "TSM-DE09.08-400", "watt": 400, "voc": 41.2, "isc": 12.28, "vmp": 34.2, "imp": 11.7, "efficiency": 20.8, "width_mm": 1096, "height_mm": 1754, "temp_coeff_pmax": -0.34, "warranty_years": 25},
    {"id": "mod-335", "brand": "Waaree", "model": "WS-335", "watt": 335, "voc": 46.2, "isc": 9.35, "vmp": 37.8, "imp": 8.87, "efficiency": 19.6, "width_mm": 992, "height_mm": 1960, "temp_coeff_pmax": -0.39, "warranty_years": 25},
]

INVERTER_CATALOG: List[Dict[str, Any]] = [
    {"id": "inv-5", "brand": "SolarEdge", "model": "SE5000H", "ac_kw": 5, "max_dc_kw": 7.75, "mppt": 1, "max_voc": 480, "efficiency": 99.2, "type": "string"},
    {"id": "inv-10", "brand": "Sungrow", "model": "SG10RT", "ac_kw": 10, "max_dc_kw": 15, "mppt": 2, "max_voc": 1100, "efficiency": 98.5, "type": "string"},
    {"id": "inv-20", "brand": "Huawei", "model": "SUN2000-20KTL-M2", "ac_kw": 20, "max_dc_kw": 30, "mppt": 2, "max_voc": 1100, "efficiency": 98.65, "type": "string"},
    {"id": "inv-50", "brand": "SMA", "model": "STP 50-41", "ac_kw": 50, "max_dc_kw": 75, "mppt": 6, "max_voc": 1000, "efficiency": 98.3, "type": "string"},
    {"id": "inv-micro", "brand": "Enphase", "model": "IQ8PLUS", "ac_kw": 0.29, "max_dc_kw": 0.44, "mppt": 1, "max_voc": 60, "efficiency": 97.5, "type": "micro"},
]


def clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


def _rad(d: float) -> float:
    return d * math.pi / 180.0


def _haversine(a: Dict[str, float], b: Dict[str, float]) -> float:
    r = 6371000.0
    dlat = _rad(b["lat"] - a["lat"])
    dlng = _rad(b["lng"] - a["lng"])
    s = math.sin(dlat / 2) ** 2 + math.cos(_rad(a["lat"])) * math.cos(_rad(b["lat"])) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(s))


def polygon_area_m2(points: List[Dict[str, float]]) -> float:
    if not points or len(points) < 3:
        return 0.0
    origin = points[0]
    xy = []
    for p in points:
        east = _haversine(origin, {"lat": origin["lat"], "lng": p["lng"]}) * (1 if p["lng"] >= origin["lng"] else -1)
        north = _haversine(origin, {"lat": p["lat"], "lng": origin["lng"]}) * (1 if p["lat"] >= origin["lat"] else -1)
        xy.append((east, north))
    total = 0.0
    n = len(xy)
    for i in range(n):
        j = (i + 1) % n
        total += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1]
    return abs(total) / 2.0


def _bounds(points: List[Dict[str, float]]) -> Tuple[float, float, float, float]:
    lats = [p["lat"] for p in points]
    lngs = [p["lng"] for p in points]
    return min(lats), max(lats), min(lngs), max(lngs)


def _point_in_polygon(point: Dict[str, float], polygon: List[Dict[str, float]]) -> bool:
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]["lng"], polygon[i]["lat"]
        xj, yj = polygon[j]["lng"], polygon[j]["lat"]
        intersect = ((yi > point["lat"]) != (yj > point["lat"])) and (
            point["lng"] < (xj - xi) * (point["lat"] - yi) / ((yj - yi) + 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def _m_to_lat(m: float) -> float:
    return m / 111320.0


def _m_to_lng(m: float, lat: float) -> float:
    return m / (111320.0 * math.cos(_rad(lat)))


def climate_for(lat: float) -> Dict[str, Any]:
    abs_lat = abs(lat)
    ghi_annual = clamp(2150 - abs_lat * 18, 900, 2300)
    profile = [0.062, 0.068, 0.082, 0.092, 0.1, 0.102, 0.1, 0.095, 0.086, 0.076, 0.068, 0.069]
    monthly_ghi = [ghi_annual * p for p in profile]
    peak_sun = [g / d for g, d in zip(monthly_ghi, DAYS)]
    avg_temp = 28 - abs_lat * 0.22
    monthly_temp = [
        avg_temp - 6, avg_temp - 4, avg_temp, avg_temp + 3, avg_temp + 6, avg_temp + 8,
        avg_temp + 7, avg_temp + 6, avg_temp + 4, avg_temp + 1, avg_temp - 2, avg_temp - 5,
    ]
    return {
        "ghi_annual": ghi_annual,
        "monthly_ghi": monthly_ghi,
        "peak_sun_hours": peak_sun,
        "monthly_temp": monthly_temp,
        "days": DAYS,
    }


def poa_factor(tilt: float, azimuth: float, lat: float) -> float:
    opt_tilt = abs(lat) * 0.87
    tilt_penalty = math.cos(_rad(tilt - opt_tilt))
    south = 180 if lat >= 0 else 0
    az_diff = min(abs(azimuth - south), 360 - abs(azimuth - south))
    az_penalty = math.cos(_rad(az_diff * 0.55))
    extra = 1 + 0.04 * math.sin(_rad(tilt)) * math.cos(_rad(lat))
    return clamp(0.72 + 0.28 * tilt_penalty * az_penalty * extra, 0.55, 1.18)


def shade_loss(obstructions: List[Dict[str, Any]], roofs: List[Dict[str, Any]]) -> float:
    if not obstructions:
        loss = 0.03
    else:
        loss = 0.02
        for o in obstructions:
            h = float(o.get("height_m") or o.get("heightM") or 8)
            loss += clamp(h / 80.0, 0, 0.12)
    if roofs:
        avg_tilt = sum(float(r.get("tilt") or 20) for r in roofs) / len(roofs)
        if avg_tilt < 8:
            loss += 0.015
    return clamp(loss, 0.02, 0.28)


def layout_panels(roof: Dict[str, Any], panel: Dict[str, Any]) -> List[Dict[str, Any]]:
    pts = roof.get("points") or []
    if len(pts) < 3:
        return []
    area = polygon_area_m2(pts)
    setback = float(roof.get("setback_m", roof.get("setbackM", 0.45)))
    row_gap = float(roof.get("row_gap_m", roof.get("rowGapM", 0.02)))
    col_gap = float(roof.get("col_gap_m", roof.get("colGapM", 0.02)))
    portrait = roof.get("orientation", "portrait") != "landscape"
    pw = (panel["width_mm"] if portrait else panel["height_mm"]) / 1000.0
    ph = (panel["height_mm"] if portrait else panel["width_mm"]) / 1000.0
    min_lat, max_lat, min_lng, max_lng = _bounds(pts)
    lat0 = (min_lat + max_lat) / 2
    step_lat = _m_to_lat(ph + row_gap)
    step_lng = _m_to_lng(pw + col_gap, lat0)
    pad_lat = _m_to_lat(setback + ph / 2)
    pad_lng = _m_to_lng(setback + pw / 2, lat0)
    panels: List[Dict[str, Any]] = []
    row = 0
    lat = min_lat + pad_lat
    while lat <= max_lat - pad_lat:
        col = 0
        lng = min_lng + pad_lng
        while lng <= max_lng - pad_lng:
            corners = [
                {"lat": lat - _m_to_lat(ph / 2), "lng": lng - _m_to_lng(pw / 2, lat)},
                {"lat": lat - _m_to_lat(ph / 2), "lng": lng + _m_to_lng(pw / 2, lat)},
                {"lat": lat + _m_to_lat(ph / 2), "lng": lng + _m_to_lng(pw / 2, lat)},
                {"lat": lat + _m_to_lat(ph / 2), "lng": lng - _m_to_lng(pw / 2, lat)},
            ]
            if all(_point_in_polygon(c, pts) for c in corners):
                panels.append({
                    "id": f"{roof.get('id', 'roof')}-p-{row}-{col}",
                    "roof_id": roof.get("id"),
                    "lat": lat,
                    "lng": lng,
                    "width_m": pw,
                    "height_m": ph,
                    "corners": corners,
                })
            col += 1
            lng += step_lng
        row += 1
        lat += step_lat
    if not panels and area > 4:
        n = max(1, int(area * 0.62 / (pw * ph)))
        return [{
            "id": f"{roof.get('id', 'roof')}-p-fit-{i}",
            "roof_id": roof.get("id"),
            "lat": lat0,
            "lng": (min_lng + max_lng) / 2,
            "width_m": pw,
            "height_m": ph,
            "corners": pts[:4],
        } for i in range(n)]
    return panels


def choose_inverter(dc_kw: float) -> Dict[str, Any]:
    strings = sorted([i for i in INVERTER_CATALOG if i["type"] == "string"], key=lambda x: x["ac_kw"])
    fit = next((i for i in strings if i["max_dc_kw"] >= dc_kw * 0.95), strings[-1])
    out = dict(fit)
    if dc_kw > fit["max_dc_kw"]:
        count = max(1, math.ceil(dc_kw / fit["max_dc_kw"]))
        out["count"] = count
        out["total_ac_kw"] = fit["ac_kw"] * count
    else:
        out["count"] = 1
        out["total_ac_kw"] = fit["ac_kw"]
    return out


def _panel_by_id(panel_id: Optional[str]) -> Dict[str, Any]:
    return next((p for p in PANEL_CATALOG if p["id"] == panel_id), PANEL_CATALOG[0])


def build_strings(panel_count: int, panel: Dict[str, Any], inverter: Dict[str, Any]) -> Dict[str, Any]:
    if not panel_count:
        return {"strings": [], "mppt_plan": [], "notes": [], "string_count": 0, "max_series": 0, "series_target": 0}
    max_series = max(1, int(inverter["max_voc"] / (panel["voc"] * 1.15)))
    series = int(clamp(max_series, 6, 18))
    string_count = math.ceil(panel_count / series)
    mppt_slots = max(inverter["mppt"] * inverter["count"], 1)
    per_mppt = math.ceil(string_count / mppt_slots)
    strings = []
    remaining = panel_count
    for i in range(string_count):
        n = min(series, remaining)
        remaining -= n
        strings.append({
            "id": f"S{i + 1}",
            "panels": n,
            "voc": round(n * panel["voc"], 1),
            "vmp": round(n * panel["vmp"], 1),
            "isc": panel["isc"],
            "power_w": n * panel["watt"],
            "inverter_index": int(i / max(string_count / inverter["count"], 1)) + 1,
            "mppt": (i % mppt_slots) + 1,
        })
    return {
        "max_series": max_series,
        "series_target": series,
        "string_count": string_count,
        "per_mppt": per_mppt,
        "strings": strings,
        "notes": [
            f"Max series by Voc cold: {max_series} modules",
            "DC/AC ratio target 1.1 - 1.3",
            "Microinverter: 1:1 module mapping" if inverter["type"] == "micro" else "String inverter with MPPT grouping",
        ],
    }


def build_bom(panel: Dict[str, Any], inverter: Dict[str, Any], panel_count: int, dc_kw: float, project: Dict[str, Any]) -> Dict[str, Any]:
    mounting = math.ceil(panel_count * 1.05) if panel_count else 0
    cable_dc = math.ceil(dc_kw * 18)
    cable_ac = math.ceil(inverter["total_ac_kw"] * 8)
    module_inr_w = float(project.get("module_cost_per_w", 18))
    epc_inr_w = float(project.get("epc_cost_per_w", 42))
    items = [
        {"sku": panel["model"], "category": "Module", "qty": panel_count, "unit": "pcs", "unit_cost": round(panel["watt"] * module_inr_w), "total": round(panel_count * panel["watt"] * module_inr_w)},
        {"sku": inverter["model"], "category": "Inverter", "qty": inverter["count"], "unit": "pcs", "unit_cost": round(inverter["ac_kw"] * 8500), "total": round(inverter["count"] * inverter["ac_kw"] * 8500)},
        {"sku": "Rail + mid/end clamp", "category": "Mounting", "qty": mounting, "unit": "set", "unit_cost": 950, "total": mounting * 950},
        {"sku": "DC cable 4/6 mm2", "category": "Electrical", "qty": cable_dc, "unit": "m", "unit_cost": 48, "total": cable_dc * 48},
        {"sku": "AC cable", "category": "Electrical", "qty": cable_ac, "unit": "m", "unit_cost": 85, "total": cable_ac * 85},
        {"sku": "DC isolator + SPD", "category": "BOS", "qty": max(inverter["count"], 1), "unit": "set", "unit_cost": 4200, "total": max(inverter["count"], 1) * 4200},
        {"sku": "ACDB / Isolator", "category": "BOS", "qty": 1, "unit": "set", "unit_cost": 6500, "total": 6500},
        {"sku": "Earthing + LA", "category": "BOS", "qty": 1, "unit": "set", "unit_cost": 8500, "total": 8500},
        {"sku": "Structure / civil", "category": "Structure", "qty": max(1, math.ceil(dc_kw or 1)), "unit": "kW", "unit_cost": 4500, "total": max(1, math.ceil(dc_kw or 1)) * 4500},
        {"sku": "Monitoring dongle", "category": "Monitoring", "qty": inverter["count"], "unit": "pcs", "unit_cost": 3500, "total": inverter["count"] * 3500},
    ]
    material = sum(i["total"] for i in items)
    return {
        "items": items,
        "material": material,
        "epc_target": round(dc_kw * 1000 * epc_inr_w),
        "currency": project.get("currency") or "INR",
    }


def _irr(cfs: List[float]) -> Optional[float]:
    lo, hi = -0.5, 1.5
    for _ in range(80):
        mid = (lo + hi) / 2
        npv = sum(c / ((1 + mid) ** t) for t, c in enumerate(cfs))
        if npv >= 0:
            lo = mid
        else:
            hi = mid
    v = (lo + hi) / 2
    return v if math.isfinite(v) else None


def finance(project: Dict[str, Any], dc_kw: float, year1_kwh: float, annual: List[float], bom: Dict[str, Any]) -> Dict[str, Any]:
    tariff = float(project.get("tariff", 8.5))
    escalation = float(project.get("tariff_escalation", 0.04))
    capex = float(project.get("capex") or bom["epc_target"])
    subsidy_pct = float(project.get("subsidy_pct", 0))
    subsidy = capex * subsidy_pct
    net_capex = capex - subsidy
    om_rate = float(project.get("om_per_kw_year", 800))
    discount = float(project.get("discount_rate", 0.08))
    cashflows = []
    cumulative = -net_capex
    payback = None
    npv = -net_capex
    for y in range(1, 26):
        energy_rev = annual[y - 1] * tariff * ((1 + escalation) ** (y - 1))
        om = dc_kw * om_rate * (1.03 ** (y - 1))
        net = energy_rev - om
        cumulative += net
        npv += net / ((1 + discount) ** y)
        if payback is None and cumulative >= 0:
            prev = cumulative - net
            payback = round(y - 1 + ((-prev / net) if net else 0), 2)
        cashflows.append({
            "year": y,
            "kwh": round(annual[y - 1]),
            "revenue": round(energy_rev),
            "om": round(om),
            "net": round(net),
            "cumulative": round(cumulative),
        })
    irr = _irr([-net_capex] + [c["net"] for c in cashflows])
    disc_energy = sum(k / ((1 + discount) ** (i + 1)) for i, k in enumerate(annual))
    lcoe = (net_capex / disc_energy) if net_capex > 0 and disc_energy else 0
    self_use = float(project.get("self_consumption", 0.72))
    export_tariff = float(project.get("export_tariff", tariff * 0.55))
    savings_y1 = year1_kwh * self_use * tariff + year1_kwh * (1 - self_use) * export_tariff
    bill_kwh = float(project.get("annual_bill_kwh") or year1_kwh * 1.05)
    return {
        "capex": round(capex),
        "subsidy": round(subsidy),
        "net_capex": round(net_capex),
        "tariff": tariff,
        "payback_years": payback,
        "npv": round(npv),
        "irr": None if irr is None else round(irr, 3),
        "lcoe": round(lcoe, 2),
        "savings_y1": round(savings_y1),
        "bill_before": round(bill_kwh * tariff),
        "roi_25": round((cashflows[24]["cumulative"] + net_capex) / net_capex, 2) if net_capex > 0 else 0,
        "cashflows": cashflows,
    }


def hourly_profile(year1_kwh: float) -> List[float]:
    daily = year1_kwh / 365.0
    hours = [clamp(math.sin(((h - 6) / 12) * math.pi), 0, 1) ** 1.35 for h in range(24)]
    s = sum(hours) or 1
    return [round((v / s) * daily, 2) for v in hours]


def simulate(project: Dict[str, Any]) -> Dict[str, Any]:
    panel = _panel_by_id(project.get("panel_id") or project.get("panelId"))
    roofs = project.get("roofs") or []
    location = project.get("location") or {"lat": 25.61, "lng": 85.14}
    lat = float(location.get("lat") or 25.61)
    climate = climate_for(lat)
    layouts = [{"roof": r, "panels": layout_panels(r, panel)} for r in roofs]
    panel_count = sum(len(l["panels"]) for l in layouts)
    dc_kw = (panel_count * panel["watt"]) / 1000.0
    inverter = choose_inverter(dc_kw)
    soiling = float(project.get("soiling_loss", 0.03))
    mismatch, wiring, availability = 0.02, 0.015, 0.02
    inverter_loss = 1 - inverter["efficiency"] / 100.0
    shade = shade_loss(project.get("obstructions") or [], roofs)
    avg_az = sum(float(r.get("azimuth") or 180) for r in roofs) / len(roofs) if roofs else 180
    avg_tilt = sum(float(r.get("tilt") or 20) for r in roofs) / len(roofs) if roofs else 20
    poa = poa_factor(avg_tilt, avg_az, lat)
    derate = (1 - soiling) * (1 - mismatch) * (1 - wiring) * (1 - availability) * (1 - inverter_loss) * (1 - shade)
    pr = clamp(derate * 0.92, 0.68, 0.86)
    monthly_kwh = []
    for i, psh in enumerate(climate["peak_sun_hours"]):
        temp_loss = clamp((climate["monthly_temp"][i] - 25) * (panel["temp_coeff_pmax"] / 100.0) * -1, 0, 0.12)
        monthly_kwh.append(dc_kw * psh * DAYS[i] * poa * derate * (1 - temp_loss))
    year1 = sum(monthly_kwh)
    specific = (year1 / dc_kw) if dc_kw else 0
    degradation = float(project.get("degradation", 0.005))
    annual = [year1 * ((1 - degradation) ** (y - 1)) for y in range(1, 26)]
    strings = build_strings(panel_count, panel, inverter)
    bom = build_bom(panel, inverter, panel_count, dc_kw, project)
    fin = finance(project, dc_kw, year1, annual, bom)
    roof_area = sum(polygon_area_m2(r.get("points") or []) for r in roofs)
    panel_area = 0.0
    for l in layouts:
        if l["panels"]:
            first = l["panels"][0]
            panel_area += len(l["panels"]) * first["width_m"] * first["height_m"]
    return {
        "panel": panel,
        "inverter": inverter,
        "climate": {
            "ghi_annual": round(climate["ghi_annual"]),
            "monthly_ghi": [round(v) for v in climate["monthly_ghi"]],
            "peak_sun_hours": [round(v, 2) for v in climate["peak_sun_hours"]],
            "monthly_temp": [round(v, 1) for v in climate["monthly_temp"]],
        },
        "system": {
            "panel_count": panel_count,
            "dc_kw": round(dc_kw, 2),
            "ac_kw": round(inverter["total_ac_kw"], 2),
            "dc_ac_ratio": round(dc_kw / inverter["total_ac_kw"], 2) if inverter["total_ac_kw"] else 0,
            "roof_area_m2": round(roof_area, 1),
            "coverage_pct": round((panel_area / roof_area) * 100, 1) if roof_area else 0,
        },
        "losses": {
            "soiling": round(soiling * 100, 1),
            "shade": round(shade * 100, 1),
            "mismatch": 2,
            "wiring": 1.5,
            "inverter": round(inverter_loss * 100, 1),
            "availability": 2,
            "temperature": 4.2,
            "pr": round(pr * 100, 1),
        },
        "production": {
            "months": MONTHS,
            "monthly_kwh": [round(v) for v in monthly_kwh],
            "year1_kwh": round(year1),
            "specific_yield": round(specific),
            "lifetime_kwh": round(sum(annual)),
            "annual": annual,
            "hourly": hourly_profile(year1),
            "co2_tons_year": round((year1 * 0.82) / 1000, 1),
            "trees_equiv": round((year1 * 0.82) / 21),
        },
        "electrical": strings,
        "bom": bom,
        "financials": fin,
        "layouts": [{"roof_id": l["roof"].get("id"), "count": len(l["panels"]), "panels": l["panels"]} for l in layouts],
    }
