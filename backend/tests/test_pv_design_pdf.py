from services.pdf_docs import generate_document_pdf


def test_pv_design_pdf_bytes():
    lead = {
        "code": "SSE-0004",
        "full_name": "Abhishek",
        "phone": "9876543210",
        "address": "Varanasi",
        "city": "Varanasi",
        "state": "UP",
    }
    design = {
        "updated_at": "2026-10-04T00:00:00+00:00",
        "location": {"lat": 25.3, "lng": 82.9},
        "result": {
            "system": {"panel_count": 8, "dc_kw": 3.2, "ac_kw": 3.0},
            "production": {
                "year1_kwh": 4200,
                "specific_yield": 1312,
                "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                "monthly_kwh": [300] * 12,
            },
            "financials": {"capex": 140000, "payback_years": 4.2, "savings_y1": 33600, "irr": 0.18},
            "panel": {"brand": "Waaree", "model": "WSMD-400", "watt": 400},
            "inverter": {"brand": "Growatt", "model": "MIN 3000TL-X"},
        },
    }
    data, name = generate_document_pdf(lead, "pv-design", design=design)
    assert data[:5] == b"%PDF-"
    assert name == "PV-Design-SSE-0004.pdf"
    assert len(data) > 400
