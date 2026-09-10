"""Generate quotation, invoice and receipt PDFs for WhatsApp / download."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fpdf import FPDF

COMPANY = {
    "name": "STEP SOLAR ENERGY PVT. LTD.",
    "short": "STEP SOLAR ENERGY PVT LTD",
    "gstin": "09ABPCS3779K1ZC",
    "branch": "Dumri Padaw, Varanasi, U.P",
    "phone": "8081252114",
    "email": "sales@stepsolar.in",
    "website": "www.stepsolar.in",
    "account": "STEP SOLAR ENERGY PVT LTD",
    "bank": "State Bank of India",
    "account_no": "44347774983",
    "ifsc": "SBIN0064874",
    "bank_branch": "Bhadaura",
}

LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "step-solar-logo.png"


def _num(v: Any, fallback: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return fallback
        return float(v)
    except (TypeError, ValueError):
        return fallback


def _inr(n: Any) -> str:
    v = _num(n)
    formatted = f"{v:,.2f}"
    return f"Rs {formatted}"


def _esc(s: Any) -> str:
    text = str(s or "").replace("\r", " ").replace("\n", " ").strip()
    return text.encode("latin-1", "replace").decode("latin-1")


def _lead_name(lead: Dict[str, Any]) -> str:
    return _esc(lead.get("full_name") or lead.get("name") or "-")


def _lead_phone(lead: Dict[str, Any]) -> str:
    return _esc(lead.get("phone") or "-")


def _lead_address(lead: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> str:
    extra = extra or {}
    if extra.get("custAddress"):
        return _esc(extra["custAddress"])
    parts = [lead.get("address"), lead.get("city"), lead.get("state"), lead.get("pincode")]
    return _esc(", ".join(str(p) for p in parts if p)) or "-"


def _fmt_date(iso: Any) -> str:
    if not iso:
        return datetime.now().strftime("%d/%m/%Y")
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d.strftime("%d/%m/%Y")
    except ValueError:
        return str(iso)[:10]


def _words_indian(num_in: Any) -> str:
    value = int(round(_num(num_in)))
    if value == 0:
        return "Zero"
    a = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
        "Eighteen", "Nineteen",
    ]
    b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def two(n: int) -> str:
        if n < 20:
            return a[n]
        return b[n // 10] + ((" " + a[n % 10]) if n % 10 else "")

    def three(n: int) -> str:
        if n > 99:
            return a[n // 100] + " Hundred" + ((" " + two(n % 100)) if n % 100 else "")
        return two(n)

    crore, value = divmod(value, 10000000)
    lakh, value = divmod(value, 100000)
    thousand, value = divmod(value, 1000)
    parts: List[str] = []
    if crore:
        parts.append(three(crore) + " Crore")
    if lakh:
        parts.append(three(lakh) + " Lakh")
    if thousand:
        parts.append(three(thousand) + " Thousand")
    if value:
        parts.append(three(value))
    return " ".join(parts)


def _item_price(it: Dict[str, Any]) -> float:
    if it.get("price") not in (None, ""):
        return _num(it.get("price"))
    return _num(it.get("rate"))


def _item_gst(it: Dict[str, Any], fallback: float = 0.0) -> float:
    if it.get("gst") not in (None, ""):
        return _num(it.get("gst"))
    return fallback


def _normalize_items(items: Any, gst_fallback: float = 0.0) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        qty = _num(raw.get("qty"), 1)
        price = _item_price(raw)
        gst = _item_gst(raw, gst_fallback)
        amount = qty * price
        gst_amt = amount * gst / 100
        rows.append({
            "desc": _esc(raw.get("desc")),
            "hsn": _esc(raw.get("hsn") or "-"),
            "qty": qty,
            "unit": _esc(raw.get("unit") or "Nos"),
            "price": price,
            "gst": gst,
            "amount": amount,
            "gstAmt": gst_amt,
            "total": amount + gst_amt,
        })
    return rows


class StepPDF(FPDF):
    def __init__(self, title: str):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.doc_title = title
        self.set_auto_page_break(auto=True, margin=12)
        self.set_margins(10, 10, 10)
        self.alias_nb_pages()

    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "B", 8)
        self.cell(0, 6, self.doc_title, align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def footer(self) -> None:
        self.set_y(-10)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(90, 90, 90)
        self.cell(0, 6, f"Step Solar Energy Pvt Ltd  |  Page {self.page_no()}/{{nb}}", align="C")
        self.set_text_color(0, 0, 0)

    @property
    def usable(self) -> float:
        return self.w - self.l_margin - self.r_margin

    def draw_logo(self, x: float, y: float, w: float = 22) -> None:
        if LOGO_PATH.exists():
            try:
                self.image(str(LOGO_PATH), x=x, y=y, w=w)
            except Exception:
                pass

    def boxed_text(self, text: str, h: float = 6, bold: bool = False, size: float = 9, align: str = "L", fill: bool = False) -> None:
        self.set_font("Helvetica", "B" if bold else "", size)
        if fill:
            self.set_fill_color(238, 243, 240)
        self.cell(self.usable, h, text, border=1, align=align, fill=fill, new_x="LMARGIN", new_y="NEXT")

    def kv_row(self, pairs: List[Tuple[str, str, float, float]], h: float = 6, size: float = 8.5) -> None:
        x0 = self.l_margin
        y = self.get_y()
        self.set_xy(x0, y)
        for label, value, lw, vw in pairs:
            self.set_font("Helvetica", "B", size)
            self.cell(lw, h, label, border=1)
            self.set_font("Helvetica", "", size)
            self.cell(vw, h, value[:80], border=1)
        self.set_xy(x0, y + h)

    def section(self, title: str) -> None:
        self.set_font("Helvetica", "B", 9)
        self.cell(self.usable, 7, title, border=1, align="C", new_x="LMARGIN", new_y="NEXT")

    def table_header(self, cols: List[Tuple[str, float, str]], h: float = 7) -> None:
        self.set_fill_color(238, 243, 240)
        self.set_font("Helvetica", "B", 7.5)
        for title, w, align in cols:
            self.cell(w, h, title, border=1, align=align, fill=True)
        self.ln(h)

    def table_row(self, cells: List[Tuple[str, float, str]], h: float = 6, bold: bool = False) -> None:
        self.set_font("Helvetica", "B" if bold else "", 7.5)
        max_h = h
        # Pre-compute wrap height for first pass using multi_cell in a dummy way
        x0 = self.l_margin
        y0 = self.get_y()
        if y0 + 18 > self.page_break_trigger:
            self.add_page()
            y0 = self.get_y()
            x0 = self.l_margin
        heights: List[float] = []
        for text, w, _align in cells:
            lines = self.multi_cell(w, h, text, border=0, dry_run=True, output="LINES")
            heights.append(max(h, len(lines) * 4.2))
        max_h = max(heights) if heights else h
        x = x0
        for (text, w, align), cell_h in zip(cells, heights):
            self.set_xy(x, y0)
            self.rect(x, y0, w, max_h)
            self.set_xy(x + 0.6, y0 + 0.8)
            self.multi_cell(w - 1.2, 4.2 if cell_h > h else max_h - 1.2, text, align=align)
            x += w
        self.set_xy(x0, y0 + max_h)


def _company_header(pdf: StepPDF, subtitle: str, right_logo: bool = True) -> None:
    y = pdf.get_y()
    usable = pdf.usable
    logo_w = 22
    if right_logo:
        pdf.draw_logo(pdf.l_margin + usable - logo_w - 2, y, logo_w)
        text_w = usable - logo_w - 4
    else:
        pdf.draw_logo(pdf.l_margin + 2, y, logo_w)
        text_w = usable
    pdf.set_xy(pdf.l_margin, y)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(text_w if right_logo else usable, 7, COMPANY["short"], align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(text_w if right_logo else usable, 4.5, f"GSTIN: {COMPANY['gstin']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(text_w if right_logo else usable, 4.5, f"Address: {COMPANY['branch']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(
        text_w if right_logo else usable,
        4.5,
        f"Mobile: {COMPANY['phone']}  |  Email: {COMPANY['email']}",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(usable, 8, subtitle, border=1, align="C", new_x="LMARGIN", new_y="NEXT")


def _quotation_pdf(lead: Dict[str, Any]) -> bytes:
    q = lead.get("quotation") or {}
    kind = (q.get("kind") or "quotation").lower()
    if kind == "commercial":
        return _commercial_pdf(lead)
    pdf = StepPDF(f"Quotation {q.get('number') or lead.get('code') or ''}")
    pdf.add_page()
    _company_header(pdf, "QUOTATION")

    gst_fallback = _num(q.get("gstPercent"))
    items = _normalize_items(q.get("items"), gst_fallback)
    goods = [i for i in items if i["gst"] == 5]
    install = [i for i in items if i["gst"] != 5]
    goods_taxable = sum(i["amount"] for i in goods)
    goods_gst = sum(i["gstAmt"] for i in goods)
    install_taxable = sum(i["amount"] for i in install)
    install_gst = sum(i["gstAmt"] for i in install)
    taxable = goods_taxable + install_taxable
    gst_total = goods_gst + install_gst
    grand = taxable + gst_total
    cs = _num(q.get("subsidyCentral"))
    ss = _num(q.get("subsidyState"))
    net = grand - cs - ss
    doc_no = _esc(q.get("number") or lead.get("code") or "-")
    date_str = _fmt_date(q.get("updatedAt") or q.get("createdAt") or lead.get("created_at") or lead.get("createdAt"))

    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(pdf.usable / 2, 6, "Quotation To", border=1, align="C")
    pdf.cell(pdf.usable / 2, 6, f"Date: {date_str}    No: {doc_no}", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.kv_row([("Customer", _lead_name(lead), 32, pdf.usable - 32)])
    pdf.kv_row([("Address", _lead_address(lead, q), 32, pdf.usable - 32)])
    pdf.kv_row([("Contact", _lead_phone(lead), 32, pdf.usable - 32)])

    pdf.section("Technical Specifications & Scope of Supply")
    cols = [("S.No", 12, "C"), ("Item Description / Equipment", 88, "L"), ("Brand / Spec", 50, "C"), ("Qty", 18, "C"), ("Unit", 22, "C")]
    pdf.table_header(cols)
    for i, it in enumerate(items, 1):
        pdf.table_row([
            (str(i), 12, "C"),
            (it["desc"], 88, "L"),
            (it["hsn"], 50, "C"),
            (str(int(it["qty"]) if it["qty"] == int(it["qty"]) else it["qty"]), 18, "C"),
            (it["unit"], 22, "C"),
        ])

    pdf.section("Commercial Summary & Tax Breakdown")
    summary = [
        ("Goods Taxable Value", goods_taxable),
        ("GST @ 5%", goods_gst),
        ("Installation/Services Taxable Value", install_taxable),
        ("GST @ 18%", install_gst),
        ("Taxable Amount (Excl. GST)", taxable),
        ("Total GST", gst_total),
        ("Total Gross Payable (Incl. GST)", grand),
        ("Less: Central Government Subsidy", cs),
        ("Less: UP-State Government Subsidy", ss),
        ("Total Estimated Subsidy Benefit", cs + ss),
        ("Net Payable Amount (Est.)", net),
    ]
    for label, val in summary:
        bold = label.startswith("Net") or label.startswith("Total Gross")
        pdf.set_font("Helvetica", "B" if bold else "", 8)
        pdf.cell(pdf.usable * 0.72, 6, label, border=1)
        pdf.cell(pdf.usable * 0.28, 6, _inr(val), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(1)
    half = pdf.usable / 2
    y = pdf.get_y()
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(half, 6, "Bank Account Details", border=1, align="C")
    pdf.cell(half, 6, "Documents Required", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    left = [
        f"Account: {COMPANY['account']}",
        f"A/c No: {COMPANY['account_no']}",
        f"IFSC: {COMPANY['ifsc']}",
        f"Bank: {COMPANY['bank']}, {COMPANY['bank_branch']}",
    ]
    right = [
        "1. Latest Electricity Bill Copy",
        "2. Property Tax / Panchayat Letter",
        "3. Aadhaar Card",
        "4. PAN Card  5. Cancelled Cheque",
    ]
    pdf.set_font("Helvetica", "", 7.5)
    for a, b in zip(left, right):
        pdf.cell(half, 5.5, a, border=1)
        pdf.cell(half, 5.5, b, border=1, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(half, 6, "For Step Solar Energy Pvt Ltd", border=1, align="C")
    pdf.cell(half, 6, "Customer Acceptance", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(half, 18, "", border=1)
    pdf.cell(half, 18, "", border=1, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(half, 6, "Authorized Signatory", border=1, align="C")
    pdf.cell(half, 6, "Signature & Date", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(pdf.usable, 6, f"Amount in Words (Net Payable): {_words_indian(net)} Rupees Only", border=1, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def _commercial_pdf(lead: Dict[str, Any]) -> bytes:
    q = lead.get("quotation") or {}
    pdf = StepPDF(f"Quotation {q.get('number') or lead.get('code') or ''}")
    pdf.add_page()
    _company_header(pdf, "QUOTATION")
    capacity = _num(q.get("capacity") or q.get("capacityKwp") or lead.get("capacity"))
    rate = _num(q.get("rate") or q.get("ratePerWp"))
    gst_pct = _num(q.get("gstPct") or q.get("gstPercent"))
    base = capacity * 1000 * rate
    gst_amt = base * gst_pct / 100
    grand = base + gst_amt
    doc_no = _esc(q.get("number") or lead.get("code") or "-")
    date_str = _fmt_date(q.get("updatedAt") or q.get("createdAt") or lead.get("created_at"))
    validity = _esc(q.get("validity") or "15")

    pdf.set_font("Helvetica", "", 8)
    pdf.cell(pdf.usable, 6, f"Ref No: {doc_no}  |  Date: {date_str}  |  Validity: {validity} Days", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.section("CLIENT DETAILS")
    pdf.kv_row([("Customer", _lead_name(lead), 36, pdf.usable - 36)])
    pdf.kv_row([("Contact", _lead_phone(lead), 36, pdf.usable - 36)])
    pdf.kv_row([("Address", _lead_address(lead, q), 36, pdf.usable - 36)])
    pdf.section("PROJECT OVERVIEW")
    pdf.kv_row([("System Capacity", f"{capacity:g} KWp Grid-Tie Solar PV System", 40, pdf.usable - 40)])
    pdf.kv_row([("Technology", _esc(q.get("technology") or "-"), 40, pdf.usable - 40)])
    pdf.kv_row([("Space Required", _esc(q.get("spaceRequired") or "-"), 40, pdf.usable - 40)])
    pdf.kv_row([("Application", _esc(q.get("application") or "-"), 40, pdf.usable - 40)])

    items = q.get("items") if isinstance(q.get("items"), list) else []
    pdf.section("BILL OF MATERIALS (BOM)")
    cols = [("S.N.", 12, "C"), ("Equipment / Item", 78, "L"), ("Specification / Make", 60, "L"), ("Qty", 16, "C"), ("Unit", 24, "C")]
    pdf.table_header(cols)
    for i, raw in enumerate(items, 1):
        if not isinstance(raw, dict):
            continue
        qty = _num(raw.get("qty"), 1)
        pdf.table_row([
            (str(i), 12, "C"),
            (_esc(raw.get("desc")), 78, "L"),
            (_esc(raw.get("hsn") or "-"), 60, "L"),
            (str(int(qty) if qty == int(qty) else qty), 16, "C"),
            (_esc(raw.get("unit") or "Nos"), 24, "C"),
        ])

    pdf.section("COMMERCIAL PRICING")
    for label, val, bold in [
        (f"{capacity:g} KWp System @ Rs {rate:.2f}/Wp", base, False),
        (f"Applicable GST @ {gst_pct:g}%", gst_amt, False),
        ("GROSS TOTAL PAYABLE", grand, True),
    ]:
        pdf.set_font("Helvetica", "B" if bold else "", 8)
        pdf.cell(pdf.usable * 0.7, 6, label, border=1)
        pdf.cell(pdf.usable * 0.3, 6, _inr(val), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    adv = _num(q.get("payAdvance"), 10)
    disp = _num(q.get("payDispatch"), 80)
    inst = _num(q.get("payInstall"), 10)
    pdf.section("PAYMENT SCHEDULE")
    for label, pct in [
        (f"Advance with Purchase Order (PO) - {adv:g}%", adv),
        (f"Before Dispatch of Material - {disp:g}%", disp),
        (f"After Installation & Commissioning - {inst:g}%", inst),
    ]:
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(pdf.usable * 0.7, 6, label, border=1)
        pdf.cell(pdf.usable * 0.3, 6, _inr(grand * pct / 100), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.kv_row([("Account Name", COMPANY["account"], 40, pdf.usable - 40)])
    pdf.kv_row([("Account Number", COMPANY["account_no"], 40, pdf.usable - 40)])
    pdf.kv_row([("IFSC", COMPANY["ifsc"], 40, pdf.usable - 40)])
    pdf.kv_row([("Bank & Branch", f"{COMPANY['bank']}, {COMPANY['bank_branch']}", 40, pdf.usable - 40)])
    half = pdf.usable / 2
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(half, 6, "CUSTOMER ACCEPTANCE", border=1, align="C")
    pdf.cell(half, 6, f"FOR {COMPANY['short']}", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(half, 20, "", border=1)
    pdf.cell(half, 20, "", border=1, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def _invoice_pdf(lead: Dict[str, Any]) -> bytes:
    inv = lead.get("invoice") or {}
    q = lead.get("quotation") or {}
    pdf = StepPDF(f"Invoice {inv.get('number') or ''}")
    pdf.add_page()
    y = pdf.get_y()
    pdf.draw_logo(pdf.l_margin + 4, y, 20)
    pdf.set_xy(pdf.l_margin, y)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(pdf.usable, 7, COMPANY["name"], align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(pdf.usable, 4.5, f"Branch: {inv.get('branchAddress') or COMPANY['branch']}    Phone: {inv.get('branchPhone') or COMPANY['phone']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(pdf.usable, 4.5, f"GSTIN: {COMPANY['gstin']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(pdf.usable, 8, "TAX INVOICE", border=1, align="C", new_x="LMARGIN", new_y="NEXT")

    gst_fallback = _num(inv.get("gstPercent") or q.get("gstPercent"))
    items = _normalize_items(inv.get("items") or q.get("items"), gst_fallback)
    taxable = sum(i["amount"] for i in items)
    gst_total = sum(i["gstAmt"] for i in items)
    grand = taxable + gst_total

    half = pdf.usable / 2
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(half, 6, "BILL TO", border=1, align="C")
    pdf.cell(half, 6, "INVOICE DETAILS", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    left_w = half
    pdf.kv_row([("Customer", _lead_name(lead), 28, left_w - 28), ("Invoice No", _esc(inv.get("number") or "-"), 28, left_w - 28)])
    pdf.kv_row([("Contact", _lead_phone(lead), 28, left_w - 28), ("Date", _fmt_date(inv.get("createdAt")), 28, left_w - 28)])
    pdf.kv_row([
        ("Place of Supply", _lead_address(lead, inv or q), 28, left_w - 28),
        ("Payment Mode", _esc(inv.get("payMode") or "Online"), 28, left_w - 28),
    ])

    cols = [
        ("S.No", 10, "C"), ("Item Description", 52, "L"), ("HSN/SAC", 22, "C"),
        ("Qty", 12, "C"), ("Unit", 14, "C"), ("Price", 22, "R"),
        ("GST%", 12, "C"), ("GST Amt", 22, "R"), ("Amount", 24, "R"),
    ]
    pdf.table_header(cols)
    total_qty = 0.0
    for i, it in enumerate(items, 1):
        total_qty += it["qty"]
        qty_s = str(int(it["qty"]) if it["qty"] == int(it["qty"]) else it["qty"])
        pdf.table_row([
            (str(i), 10, "C"), (it["desc"], 52, "L"), (it["hsn"], 22, "C"),
            (qty_s, 12, "C"), (it["unit"], 14, "C"), (_inr(it["price"]), 22, "R"),
            (f"{it['gst']:g}%", 12, "C"), (_inr(it["gstAmt"]), 22, "R"), (_inr(it["total"]), 24, "R"),
        ])
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(84, 6, "Total", border=1, align="C")
    pdf.cell(12, 6, str(int(total_qty) if total_qty == int(total_qty) else total_qty), border=1, align="C")
    pdf.cell(48, 6, "", border=1)
    pdf.cell(22, 6, _inr(gst_total), border=1, align="R")
    pdf.cell(24, 6, _inr(grand), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.section("GST Tax Summary")
    groups: Dict[str, Dict[str, float]] = {}
    for it in items:
        key = it["hsn"] or "-"
        groups.setdefault(key, {"taxable": 0.0, "gst": it["gst"]})
        groups[key]["taxable"] += it["amount"]
    pdf.table_header([
        ("HSN", 30, "C"), ("Taxable", 32, "R"), ("CGST%", 18, "C"), ("CGST", 28, "R"),
        ("SGST%", 18, "C"), ("SGST", 28, "R"), ("Total Tax", 36, "R"),
    ])
    tot_half = 0.0
    tot_taxable = 0.0
    for hsn, g in groups.items():
        half_rate = g["gst"] / 2
        cgst = g["taxable"] * half_rate / 100
        tot_half += cgst
        tot_taxable += g["taxable"]
        pdf.table_row([
            (hsn, 30, "C"), (_inr(g["taxable"]), 32, "R"), (f"{half_rate:g}%", 18, "C"),
            (_inr(cgst), 28, "R"), (f"{half_rate:g}%", 18, "C"), (_inr(cgst), 28, "R"), (_inr(cgst * 2), 36, "R"),
        ])
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(30, 6, "TOTAL", border=1, align="C")
    pdf.cell(32, 6, _inr(tot_taxable), border=1, align="R")
    pdf.cell(18, 6, "", border=1)
    pdf.cell(28, 6, _inr(tot_half), border=1, align="R")
    pdf.cell(18, 6, "", border=1)
    pdf.cell(28, 6, _inr(tot_half), border=1, align="R")
    pdf.cell(36, 6, _inr(tot_half * 2), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(pdf.usable * 0.62, 6, "Amount In Words:", border=1)
    pdf.cell(pdf.usable * 0.20, 6, "Grand Total:", border=1)
    pdf.cell(pdf.usable * 0.18, 6, _inr(grand), border=1, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(pdf.usable, 6, f"{_words_indian(grand)} Rupees Only", border=1, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(pdf.usable / 2, 6, "Bank Account Details", border=1, align="C")
    pdf.cell(pdf.usable / 2, 6, "Terms & Conditions", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 7.5)
    terms = "1. Goods once sold will not be taken back.  2. Payment as agreed.  3. Thanks for doing business with us!"
    y = pdf.get_y()
    pdf.multi_cell(pdf.usable / 2, 5, f"A/c: {COMPANY['account']}\nBank: {COMPANY['bank']}\nA/c No: {COMPANY['account_no']}\nIFSC: {COMPANY['ifsc']}\nBranch: {COMPANY['bank_branch']}", border=1)
    pdf.set_xy(pdf.l_margin + pdf.usable / 2, y)
    pdf.multi_cell(pdf.usable / 2, 5, terms + f"\n\nFor {COMPANY['name']}\n\nAuthorized Signatory", border=1)
    return bytes(pdf.output())


def _receipt_pdf(lead: Dict[str, Any], payment: Dict[str, Any]) -> bytes:
    inv = lead.get("invoice") or {}
    pdf = StepPDF(f"Receipt {payment.get('receiptNo') or ''}")
    pdf.add_page()
    y = pdf.get_y()
    pdf.draw_logo(pdf.l_margin + 4, y, 20)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(pdf.usable, 7, COMPANY["name"], align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(pdf.usable, 4.5, f"Branch: {COMPANY['branch']}    Phone: {COMPANY['phone']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(pdf.usable, 4.5, f"GSTIN: {COMPANY['gstin']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(pdf.usable, 8, "PAYMENT RECEIPT", border=1, align="C", new_x="LMARGIN", new_y="NEXT")

    amount = _num(payment.get("amount"))
    paid = _num(inv.get("paidAmount"))
    grand = _num(inv.get("grandTotal"))
    balance = max(0.0, grand - paid)
    half = pdf.usable / 2
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(half, 6, "RECEIVED FROM", border=1, align="C")
    pdf.cell(half, 6, "RECEIPT DETAILS", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.kv_row([("Customer", _lead_name(lead), 28, half - 28), ("Receipt No", _esc(payment.get("receiptNo") or "-"), 28, half - 28)])
    pdf.kv_row([("Contact", _lead_phone(lead), 28, half - 28), ("Date", _fmt_date(payment.get("at")), 28, half - 28)])
    pdf.kv_row([("Address", _lead_address(lead, inv), 28, half - 28), ("Mode", _esc(payment.get("mode") or "Online"), 28, half - 28)])
    if inv.get("number"):
        pdf.kv_row([("Received Against", f"Invoice {inv.get('number')}", 40, pdf.usable - 40)])

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(pdf.usable * 0.7, 8, "Amount Received", border=1)
    pdf.cell(pdf.usable * 0.3, 8, _inr(amount), border=1, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(pdf.usable * 0.7, 6, "Balance Due", border=1)
    pdf.cell(pdf.usable * 0.3, 6, _inr(balance), border=1, align="R", new_x="LMARGIN", new_y="NEXT")
    if payment.get("note") or payment.get("reference"):
        note = _esc(payment.get("note") or "")
        ref = _esc(payment.get("reference") or "")
        pdf.cell(pdf.usable, 6, f"Remarks: {note}  {('Ref: ' + ref) if ref else ''}".strip(), border=1, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(pdf.usable, 6, f"Amount In Words: {_words_indian(amount)} Rupees Only", border=1, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(pdf.usable, 6, "Bank Account Details", border=1, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    for label, val in [
        ("Account Name", COMPANY["account"]),
        ("Bank Name", COMPANY["bank"]),
        ("Account No", COMPANY["account_no"]),
        ("IFSC", COMPANY["ifsc"]),
        ("Branch", COMPANY["bank_branch"]),
    ]:
        pdf.kv_row([(label, val, 40, pdf.usable - 40)])
    half = pdf.usable / 2
    pdf.cell(half, 18, "", border=1)
    pdf.cell(half, 18, "", border=1, new_x="LMARGIN", new_y="NEXT")
    pdf.cell(half, 6, "Customer Signature", border=1, align="C")
    pdf.cell(half, 6, "Authorized Signatory", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def generate_document_pdf(
    lead: Dict[str, Any],
    doc_type: str,
    payment: Optional[Dict[str, Any]] = None,
) -> Tuple[bytes, str]:
    """Return (pdf_bytes, filename) for quotation / invoice / receipt."""
    kind = (doc_type or "document").strip().lower()
    code = _esc(lead.get("code") or "doc")
    if kind in {"quotation", "commercial"}:
        q = lead.get("quotation") or {}
        number = _esc(q.get("number") or code)
        data = _quotation_pdf(lead) if kind == "quotation" else _commercial_pdf(lead)
        if kind == "quotation" and (q.get("kind") or "").lower() == "commercial":
            data = _commercial_pdf(lead)
        prefix = "Quotation"
        return data, f"{prefix}-{number}.pdf"
    if kind == "invoice":
        inv = lead.get("invoice") or {}
        number = _esc(inv.get("number") or code)
        return _invoice_pdf(lead), f"Invoice-{number}.pdf".replace("/", "-")
    if kind == "receipt":
        if not payment:
            raise ValueError("Receipt PDF needs a payment")
        number = _esc(payment.get("receiptNo") or code)
        return _receipt_pdf(lead, payment), f"Receipt-{number}.pdf".replace("/", "-")
    raise ValueError(f"Unsupported document type '{doc_type}'")
