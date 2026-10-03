from proposal_engine import assemble_proposal, calculate_subsidy, cashflow_model, pricing_from_template
from proposal_pdf import generate_proposal_pdf


def test_residential_3kw_subsidy_cap():
    out = calculate_subsidy(3.0, "residential")
    assert out["amount"] == 78000
    assert out["capped"] is True
    assert out["project_type"] == "residential"


def test_residential_2kw_uncapped():
    out = calculate_subsidy(2.0, "residential")
    assert out["amount"] == 60000
    assert out["capped"] is False


def test_commercial_subsidy_zero():
    out = calculate_subsidy(10.0, "commercial")
    assert out["amount"] == 0
    assert out["project_type"] == "commercial"


def test_custom_subsidy_settings():
    settings = {
        "residential_slab_1_kw": 2.0,
        "residential_slab_1_inr_per_kw": 30000,
        "residential_slab_2_inr_per_kw": 18000,
        "residential_max_inr": 50000,
    }
    out = calculate_subsidy(3.0, "residential", settings)
    assert out["amount"] == 50000
    assert out["capped"] is True


def test_pricing_per_w():
    design = {"generation": {"dc_kw": 3.0, "annual_kwh": 4200, "monthly_kwh": [350] * 12, "yearly_kwh": [4200] * 25}}
    pricing = pricing_from_template(design)
    assert pricing["total"] > 0
    assert abs(pricing["total"] - 3.0 * 1000 * 44) < 50
    assert len(pricing["items"]) >= 4


def test_cashflow_25_years_and_payback():
    design = {
        "generation": {
            "dc_kw": 3.0,
            "annual_kwh": 4500,
            "monthly_kwh": [375] * 12,
            "yearly_kwh": [4500 * ((1 - 0.005) ** y) for y in range(25)],
        },
        "tariff": 8.5,
        "annual_bill_kwh": 4800,
    }
    fin = cashflow_model(design, capex=132000, subsidy_amount=78000, tariff={"price_per_kwh": 8.5, "escalation_rate": 3.5})
    assert len(fin["cashflows"]) == 25
    assert fin["net_capex"] == 54000
    assert fin["payback_years"] is not None
    assert fin["payback_years"] < 10
    assert fin["total_savings_25"] > fin["savings_y1"]
    assert fin["irr"] is not None


def test_proposal_pdf_bytes():
    design = {
        "id": "d1",
        "name": "Test roof",
        "address": "Patna",
        "location": {"lat": 25.61, "lng": 85.14},
        "generation": {
            "dc_kw": 3.0,
            "annual_kwh": 4500,
            "monthly_kwh": [375] * 12,
            "yearly_kwh": [4500] * 25,
            "spec_gen": 1500,
        },
        "result": {"system": {"dc_kw": 3.0, "ac_kw": 3, "panel_count": 6}},
    }
    doc = assemble_proposal(design)
    doc["id"] = "prop-1"
    doc["generated_at"] = "2026-09-29T00:00:00+00:00"
    data, name = generate_proposal_pdf(doc, public_url="https://example.test/#/p/abc")
    assert data[:5] == b"%PDF-"
    assert name.endswith(".pdf")
    assert len(data) > 2000
