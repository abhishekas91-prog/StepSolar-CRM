"""A4 design-proposal PDF using existing fpdf2 StepPDF helpers."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Tuple

from services.pdf_docs import COMPANY, StepPDF, _esc, _fmt_date, _inr, _num


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _bar_row(pdf: StepPDF, label: str, value: float, peak: float, width: float) -> None:
    h = 5.5
    if pdf.get_y() + 10 > pdf.page_break_trigger:
        pdf.add_page()
    y = pdf.get_y()
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(22, h, label)
    track = width - 52
    pdf.set_fill_color(226, 232, 240)
    pdf.rect(pdf.l_margin + 22, y + 1.2, track, 3.2, style="F")
    frac = 0.0 if peak <= 0 else max(0.0, min(1.0, value / peak))
    pdf.set_fill_color(22, 101, 52)
    pdf.rect(pdf.l_margin + 22, y + 1.2, max(0.4, track * frac), 3.2, style="F")
    pdf.set_xy(pdf.l_margin + 22 + track + 2, y)
    pdf.cell(28, h, f"{int(round(value))}", align="R", new_x="LMARGIN", new_y="NEXT")


def generate_proposal_pdf(proposal: Dict[str, Any], public_url: str = "") -> Tuple[bytes, str]:
    sys = proposal.get("system") or {}
    pricing = proposal.get("pricing") or {}
    subsidy = proposal.get("subsidy") or {}
    finance = proposal.get("finance") or {}
    branding = proposal.get("branding") or {}
    sections = branding.get("sections_enabled") or {}
    name = _esc(sys.get("name") or "Rooftop design")
    pdf = StepPDF(f"Solar Proposal - {name}")
    pdf.add_page()

    y = pdf.get_y()
    pdf.draw_logo(pdf.l_margin + 2, y, 18)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(pdf.usable, 7, _esc(branding.get("company") or COMPANY["name"]), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(pdf.usable, 4.5, f"{COMPANY['branch']}  |  {COMPANY['phone']}  |  {COMPANY['email']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 11)
    pdf.ln(2)
    pdf.cell(pdf.usable, 8, "ROOFTOP SOLAR PROPOSAL", border=1, align="C", new_x="LMARGIN", new_y="NEXT")

    client = _esc(sys.get("client_name") or "Customer")
    pdf.kv_row([
        ("Prepared for", client, 32, pdf.usable / 2 - 32),
        ("Generated", _fmt_date(proposal.get("generated_at")), 28, pdf.usable / 2 - 28),
    ])
    pdf.kv_row([
        ("Project", name, 32, pdf.usable / 2 - 32),
        ("Size", f"{_num(sys.get('dc_kw')):.2f} kWp", 28, pdf.usable / 2 - 28),
    ])
    pdf.kv_row([
        ("Address", _esc(sys.get("address") or "-"), 32, pdf.usable - 32),
    ])
    lat, lng = sys.get("lat"), sys.get("lng")
    pdf.kv_row([
        ("Location", f"{lat or '-'}, {lng or '-'}", 32, pdf.usable / 2 - 32),
        ("Modules", str(sys.get("panel_count") or "-"), 28, pdf.usable / 2 - 28),
    ])

    pdf.section("Proposal Summary")
    pdf.kv_row([
        ("System price", _inr(pricing.get("total")), 40, pdf.usable / 2 - 40),
        ("Incentives", _inr(subsidy.get("amount")), 36, pdf.usable / 2 - 36),
    ])
    pdf.kv_row([
        ("Price after incentives", _inr(finance.get("net_capex")), 48, pdf.usable / 2 - 48),
        ("Payback", f"{finance.get('payback_years') or '-'} yr", 36, pdf.usable / 2 - 36),
    ])
    pdf.set_font("Helvetica", "I", 7.5)
    pdf.multi_cell(pdf.usable, 4.5, "Disclaimer: Savings are modelled. Actual generation depends on weather, shading, soiling and DISCOM rules. PM Surya Ghar incentive is subject to MNRE / portal eligibility.")

    if sections.get("overview", True):
        pdf.section("Company Overview")
        pdf.set_font("Helvetica", "", 8)
        pdf.multi_cell(
            pdf.usable,
            4.5,
            "Step Solar Energy Pvt. Ltd. designs and installs grid-tied rooftop solar across India. "
            "This proposal is prepared from a remote PV design (layout, generation and shading) linked to your CRM project.",
        )

    if sections.get("generation", True):
        pdf.section("Monthly Generation (kWh)")
        monthly = finance.get("monthly_kwh") or []
        peak = max(monthly) if monthly else 1
        for i, v in enumerate(monthly[:12]):
            _bar_row(pdf, MONTHS[i], float(v), peak, pdf.usable)
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(pdf.usable, 6, f"Year-1 generation: {int(_num(finance.get('year1_kwh')))} kWh   |   Offset: {finance.get('energy_offset_pct')}%", new_x="LMARGIN", new_y="NEXT")

    if sections.get("savings", True):
        pdf.section("25-year customer savings")
        flows = finance.get("cashflows") or []
        peak_c = max((_num(c.get("cumulative")) for c in flows), default=1)
        for c in flows:
            if c["year"] in {1, 5, 10, 15, 20, 25}:
                _bar_row(pdf, f"Y{c['year']}", _num(c.get("cumulative")), max(peak_c, 1), pdf.usable)
        pdf.set_font("Helvetica", "", 8)
        irr = finance.get("irr")
        irr_s = f"{irr * 100:.1f}%" if irr is not None else "-"
        pdf.cell(pdf.usable, 6, f"Total 25-yr bill savings: {_inr(finance.get('total_savings_25'))}   IRR: {irr_s}   NPV: {_inr(finance.get('npv'))}", new_x="LMARGIN", new_y="NEXT")

    if sections.get("bom", True):
        pdf.section("Bill of materials")
        pdf.table_header([("Item", 78, "L"), ("Cat", 28, "L"), ("Qty", 18, "R"), ("Amount", 66, "R")])
        for it in (pricing.get("items") or [])[:18]:
            pdf.table_row([
                (_esc(it.get("sku")), 78, "L"),
                (_esc(it.get("category")), 28, "L"),
                (str(it.get("qty")), 18, "R"),
                (_inr(it.get("total")), 66, "R"),
            ])
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(124, 6, "Total system price", border=1)
        pdf.cell(66, 6, _inr(pricing.get("total")), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    if sections.get("warranty", True):
        pdf.section("Warranty")
        pdf.set_font("Helvetica", "", 8)
        for line in proposal.get("warranty") or []:
            pdf.multi_cell(pdf.usable, 4.5, f"- {_esc(line)}")

    if sections.get("terms", True):
        pdf.section("Terms & conditions")
        pdf.set_font("Helvetica", "", 8)
        for i, line in enumerate(proposal.get("terms") or [], 1):
            pdf.multi_cell(pdf.usable, 4.5, f"{i}. {_esc(line)}")

    if sections.get("payment", True):
        pdf.section("Payment schedule")
        pdf.table_header([("Milestone", 120, "L"), ("% ", 30, "C"), ("Amount", 40, "R")])
        total = _num(finance.get("net_capex") or pricing.get("total"))
        for row in proposal.get("payment_schedule") or []:
            pct = _num(row.get("pct"))
            pdf.table_row([
                (_esc(row.get("milestone")), 120, "L"),
                (f"{pct:g}%", 30, "C"),
                (_inr(total * pct / 100.0), 40, "R"),
            ])

    if public_url:
        pdf.section("Share")
        pdf.set_font("Helvetica", "", 8)
        pdf.multi_cell(pdf.usable, 4.5, f"View 3D / public proposal: {public_url}")

    pdf.set_font("Helvetica", "I", 7.5)
    pdf.ln(4)
    pdf.multi_cell(pdf.usable, 4, "This document is generated from Step Solar CRM Design Studio. GST extra as applicable.")
    code = _esc(proposal.get("id") or sys.get("name") or "proposal")[:24]
    return bytes(pdf.output()), f"Proposal-{code}.pdf".replace(" ", "-")
