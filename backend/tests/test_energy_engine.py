from energy_engine import generate_energy
from irradiance import cache_key, shadow_access, sun_position


def _design():
    return {
        "panel_id": "mod-540",
        "location": {"lat": 25.61, "lng": 85.14, "zoom": 19},
        "annual_bill_kwh": 7200,
        "roofs": [{
            "id": "roof-1",
            "name": "South",
            "tilt": 18,
            "azimuth": 180,
            "setback_m": 0.4,
            "row_gap_m": 0.02,
            "col_gap_m": 0.02,
            "orientation": "portrait",
            "points": [
                {"lat": 25.61000, "lng": 85.14000},
                {"lat": 25.61000, "lng": 85.14020},
                {"lat": 25.61015, "lng": 85.14020},
                {"lat": 25.61015, "lng": 85.14000},
            ],
        }],
        "obstructions": [{"id": "t1", "type": "tree", "height_m": 10, "lat": 25.61030, "lng": 85.14010}],
    }


def test_generate_has_12_months_and_25_years():
    out = generate_energy(_design(), consumption={"current": {"monthly_kwh": [600] * 12}})
    assert len(out["monthly_kwh"]) == 12
    assert len(out["yearly_kwh"]) == 25
    assert out["annual_kwh"] > 0
    assert out["annual_mwh"] == round(out["annual_kwh"] / 1000.0, 3)
    assert out["spec_gen"] > 0
    assert 50 <= out["performance_ratio"] <= 95
    assert 0 <= out["energy_offset_pct"] <= 200
    assert out["degradation_pct"] == 0.5
    assert out["yearly_kwh"][1] < out["yearly_kwh"][0]
    assert out["source"] in {"pvlib", "pvwatts", "climate"}
    assert out["system_losses"] == 14.0


def test_shading_override_lowers_yield():
    d = _design()
    high = generate_energy(d, shading_factor=1.0)
    low = generate_energy(d, shading_factor=0.7)
    assert low["annual_kwh"] < high["annual_kwh"]


def test_sun_position_noon_positive_altitude():
    pos = sun_position(25.61, 85.14, 172, 12.0)
    assert pos["altitude"] > 40
    assert 0 <= pos["azimuth"] <= 360


def test_shadow_access_clamped():
    d = _design()
    access, cells = shadow_access(25.61, 85.14, d["roofs"], d["obstructions"])
    assert 0.7 <= access <= 1.0
    assert cells
    assert all(0.7 <= c["solar_access"] <= 1.0 for c in cells)


def test_cache_key_stable():
    d = _design()
    a = cache_key(25.61, 85.14, d["roofs"], d["obstructions"])
    b = cache_key(25.61, 85.14, d["roofs"], d["obstructions"])
    assert a == b
    assert len(a) == 64
