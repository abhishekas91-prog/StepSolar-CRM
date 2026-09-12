"""Map National Portal / PM Surya Ghar CSV dumps onto CRM lead documents."""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

PHONE_RE = re.compile(r"^[6-9]\d{9}$")
PIN_RE = re.compile(r"\b(\d{6})\b")
NON_ALNUM = re.compile(r"[^a-z0-9]+")

SOLAR_STAGE_KEYS: List[str] = [
    "lead_captured",
    "site_survey_scheduled",
    "survey_completed",
    "quotation_sent",
    "docs_verified",
    "discom_applied",
    "material_dispatched",
    "installation_in_progress",
    "net_metering_pending",
    "commissioned",
    "subsidy_disbursed",
]

STAGE_META = {
    "lead_captured": ("Lead Captured", "Customer", "Sales"),
    "site_survey_scheduled": ("Site Survey Scheduled", "Engineer", "Sales"),
    "survey_completed": ("Site Survey Completed", "Engineer", "Site Survey"),
    "quotation_sent": ("Quotation Sent", "Sales", "Sales"),
    "docs_verified": ("Documents Verified", "Accounts", "Accounts"),
    "discom_applied": ("DISCOM Application", "Discom", "Accounts"),
    "material_dispatched": ("Material Dispatched", "Vendor", "Installation"),
    "installation_in_progress": ("Installation In Progress", "Engineer", "Installation"),
    "net_metering_pending": ("Net Metering Pending", "Discom", "Installation"),
    "commissioned": ("Commissioned", "Discom", "Installation"),
    "subsidy_disbursed": ("Subsidy Disbursed", "REC", "Accounts"),
}

HEADER_ALIASES: Dict[str, Tuple[str, ...]] = {
    "serial": ("serial number", "sr no", "sno", "s no"),
    "submitted_at": ("application submitted date", "submitted date", "application date"),
    "registration_no": ("consumer registration number", "registration number", "registration no"),
    "application_no": ("application number", "application no", "app no"),
    "scheme": ("scheme", "scheme pm surya ghar scheme 4 scheme 5"),
    "portal_status": ("current status of application", "application status", "status"),
    "full_name": ("consumer name", "customer name", "name", "full name"),
    "phone": ("mobile no of consumer", "mobile no", "mobile", "phone", "phone number"),
    "email": ("email of consumer", "email", "email id"),
    "address": ("consumer address", "address"),
    "city": ("district name", "district", "city"),
    "state": ("state name", "state"),
    "consumer_no": ("consumer number", "discom consumer no", "consumer no"),
    "vendor_selection_date": ("vendor selection date by consumer", "vendor selection date"),
    "vendor_consent_date": ("vendor consent date",),
    "agreement_uploaded": ("vendor consumer agreement uploaded yes no", "vendor consumer agreement uploaded"),
    "agreement_date": ("vendor consumer agreement uploading date",),
    "connection_category": ("connection category name rwa domestic", "connection category name", "connection category"),
    "sanctioned_load_kw": ("sanction load kwp", "sanction load", "sanctioned load"),
    "proposed_size_kw": ("proposed pv capacity kwp", "proposed pv capacity", "proposed capacity"),
    "discom_name": ("discom name", "discom"),
    "circle_name": ("circle name",),
    "division_name": ("division name",),
    "sub_division_name": ("sub division name",),
    "has_existing_capacity": ("has existing capacity y n", "has existing capacity"),
    "existing_capacity_kw": ("existing capacity kwp", "existing capacity"),
    "loan_taken": ("loan taken yes no", "loan taken"),
    "loan_application_date": ("loan application date",),
    "loan_bank": ("loan applied at bank",),
    "loan_branch": ("bank branch address",),
    "loan_status": ("loan status pending sanctioned rejected", "loan status"),
    "loan_sanctioned_date": ("loan sanctioned date",),
    "loan_rejection_date": ("loan rejection date",),
    "loan_disbursed_date_1": ("loan disbursed date first tranche",),
    "loan_disbursed_amount_1": ("loan disbursed amount first tranche",),
    "loan_utr_1": ("loan first tranche disbursal utr",),
    "loan_disbursed_date_2": ("loan disbursed date second tranche",),
    "loan_disbursed_amount_2": ("loan disbursed amount second tranche",),
    "loan_utr_2": ("loan second tranche disbursal utr",),
    "feasibility_applied_kw": ("feasibility applied kw",),
    "feasibility_approved_date": ("feasibility approved date",),
    "feasibility_returned_date": ("feasibility returned date",),
    "feasibility_return_remarks": ("feasibility return remarks",),
    "installation_date": ("solar plant installation date", "installation date"),
    "installed_capacity_kw": ("installed pv module capacity kwp", "installed capacity"),
    "module_make": ("pv module make", "module make"),
    "module_capacity_wp": ("module capacity wp", "module capacity"),
    "module_qty": ("module quantity",),
    "module_serials": ("pv module serial no", "module serial no", "panel serial"),
    "inverter_capacity_kw": ("inverter capacity kw", "inverter capacity"),
    "inverter_make": ("inverter make",),
    "inverter_qty": ("inverter quantity",),
    "inspection_status": ("inspection status approved return", "inspection status"),
    "inspection_date": ("inspection date",),
    "inspection_return_date": ("inspection return date",),
    "inspection_return_comment": ("inspection return comment",),
    "subsidy_redeem_date": ("subsidy redeem date",),
    "subsidy_amount": ("subsidy amount rs", "subsidy amount"),
    "subsidy_return_date": ("subsidy return date",),
    "subsidy_return_to": ("subsidy return to installation inspection", "subsidy return to"),
    "subsidy_return_comment": ("subsidy return comment",),
    "subsidy_verified_date": ("subsidy verified date",),
    "subsidy_disbursed_date": ("subsidy disbursed date",),
    "last_comment": ("last comment",),
    "last_comment_date": ("last comment date",),
    "rwa_houses": ("no of house rwa", "no of houses"),
}

_EMPTY = {"", "-", "--", "na", "n/a", "nil", "none", "null", "0"}
_YES = {"yes", "y", "true", "1"}

STATUS_TO_STAGE = (
    ("subsidy disbursed", "subsidy_disbursed"),
    ("subsidy verified", "subsidy_disbursed"),
    ("commission", "commissioned"),
    ("inspection approved", "commissioned"),
    ("net meter", "net_metering_pending"),
    ("install", "installation_in_progress"),
    ("material", "material_dispatched"),
    ("feasibility approved", "discom_applied"),
    ("feasibility", "discom_applied"),
    ("agreement", "docs_verified"),
    ("vendor", "quotation_sent"),
    ("quotation", "quotation_sent"),
    ("survey", "survey_completed"),
)


def _norm_header(value: str) -> str:
    return NON_ALNUM.sub(" ", (value or "").strip().lower()).strip()


def _build_header_index() -> Dict[str, str]:
    index: Dict[str, str] = {}
    for field, aliases in HEADER_ALIASES.items():
        index[_norm_header(field)] = field
        for alias in aliases:
            index[_norm_header(alias)] = field
    return index


_HEADER_INDEX = _build_header_index()


def decode_bytes(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "utf-16", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def detect_delimiter(sample: str) -> str:
    first = next((ln for ln in sample.splitlines() if ln.strip()), "")
    tabs = first.count("\t")
    commas = first.count(",")
    semis = first.count(";")
    if tabs > commas and tabs >= semis:
        return "\t"
    if semis > commas:
        return ";"
    return ","


def parse_csv_bytes(data: bytes) -> Tuple[List[str], List[Dict[str, str]]]:
    text = decode_bytes(data).strip()
    if not text:
        return [], []
    delimiter = detect_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = [r for r in reader if any((c or "").strip() for c in r)]
    if not rows:
        return [], []
    raw_headers = [(h or "").strip() for h in rows[0]]
    mapped_headers = [_HEADER_INDEX.get(_norm_header(h), _norm_header(h)) for h in raw_headers]
    records: List[Dict[str, str]] = []
    for row in rows[1:]:
        record: Dict[str, str] = {}
        for i, header in enumerate(mapped_headers):
            if not header:
                continue
            value = row[i].strip() if i < len(row) else ""
            if header not in record or (not record[header] and value):
                record[header] = value
        records.append(record)
    return raw_headers, records


def _clean(value: Optional[str]) -> str:
    v = (value or "").strip()
    if v.startswith("'"):
        v = v[1:].strip()
    if v.lower() in _EMPTY:
        return ""
    return v


def _truthy(value: Optional[str]) -> bool:
    return _clean(value).lower() in _YES


def _parse_float(value: Optional[str]) -> Optional[float]:
    v = _clean(value).replace(",", "")
    if not v:
        return None
    v = re.sub(r"[^0-9.\-]", "", v)
    if not v or v in {".", "-", "-."}:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _parse_date(value: Optional[str]) -> Optional[str]:
    v = _clean(value)
    if not v:
        return None
    v = v.replace(".", "-").replace("/", "-")
    fmts = (
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d-%m-%y",
        "%Y-%m-%d %H:%M:%S",
        "%d-%m-%Y %H:%M:%S",
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%Y-%m-%dT%H:%M:%S",
    )
    for fmt in fmts:
        try:
            dt = datetime.strptime(v[:19], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    return None


def is_masked_phone(value: Optional[str]) -> bool:
    """Detect PM Surya Ghar portal masked numbers like '******1732'."""
    v = (value or "").strip()
    return bool("*" in v and re.search(r"\d", v))


def _normalize_phone(value: Optional[str]) -> str:
    v = (value or "").strip()
    if is_masked_phone(v):
        return v
    digits = re.sub(r"\D", "", v)
    if digits.startswith("91") and len(digits) >= 12:
        digits = digits[-10:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits


def _clean_email(email: Optional[str], fallback_key: str) -> str:
    e = _clean(email).lower()
    if e and "@" in e and not e.startswith("*") and not e.endswith("*"):
        user, _, domain = e.partition("@")
        if user and domain and "." in domain and "*" not in user and "*" not in domain:
            return e
    key = re.sub(r"[^a-zA-Z0-9]", "", fallback_key or "customer").lower()
    return f"noreply.{key}@imported.stepsolar.in"


def _extract_pincode(address: str) -> str:
    m = PIN_RE.search(address or "")
    return m.group(1) if m else ""


def _property_type(category: str) -> Optional[str]:
    c = category.lower()
    if not c:
        return None
    if "rwa" in c or "domestic" in c or "resid" in c:
        return "Residential"
    if "commerc" in c or "office" in c:
        return "Commercial / Office"
    if "industr" in c or "factor" in c:
        return "Industrial / Factory"
    if "agri" in c or "pump" in c:
        return "Agricultural / Pump"
    return "Residential"


def _subsidy_status(row: Dict[str, str]) -> str:
    if _clean(row.get("subsidy_disbursed_date")):
        return "Disbursed"
    if _clean(row.get("subsidy_return_date")):
        return "Rejected"
    if _clean(row.get("subsidy_verified_date")) or _clean(row.get("subsidy_redeem_date")):
        return "Approved"
    if _parse_float(row.get("subsidy_amount")):
        return "Applied"
    status = _clean(row.get("portal_status")).lower()
    if "subsidy disburs" in status:
        return "Disbursed"
    if "subsidy" in status:
        return "Applied"
    return "Not Applied"


def _stage_from_status(status: str) -> Optional[str]:
    s = status.lower()
    if not s:
        return None
    for needle, key in STATUS_TO_STAGE:
        if needle in s:
            return key
    return None


def infer_completed_stage(row: Dict[str, str]) -> Optional[str]:
    candidates: List[str] = []
    status_stage = _stage_from_status(_clean(row.get("portal_status")))
    if status_stage:
        candidates.append(status_stage)
    if _clean(row.get("subsidy_disbursed_date")):
        candidates.append("subsidy_disbursed")
    inspection = _clean(row.get("inspection_status")).lower()
    if inspection and "approv" in inspection:
        candidates.append("commissioned")
    if _clean(row.get("installation_date")) or _parse_float(row.get("installed_capacity_kw")):
        candidates.append("installation_in_progress")
    if _clean(row.get("feasibility_approved_date")):
        candidates.append("discom_applied")
    if _truthy(row.get("agreement_uploaded")) or _clean(row.get("agreement_date")):
        candidates.append("docs_verified")
    if _clean(row.get("vendor_selection_date")) or _clean(row.get("vendor_consent_date")):
        candidates.append("quotation_sent")
    if not candidates:
        return None
    order = {k: i for i, k in enumerate(SOLAR_STAGE_KEYS)}
    return max(candidates, key=lambda k: order.get(k, -1))


def build_stages(completed_until: Optional[str], now_iso: str) -> List[Dict[str, Any]]:
    stop = SOLAR_STAGE_KEYS.index(completed_until) if completed_until in SOLAR_STAGE_KEYS else -1
    stages: List[Dict[str, Any]] = []
    for i, key in enumerate(SOLAR_STAGE_KEYS):
        label, actor, owner = STAGE_META[key]
        if i < stop:
            status = "Completed"
            updated = now_iso
        elif i == stop:
            status = "Completed"
            updated = now_iso
        elif i == stop + 1:
            status = "In Progress"
            updated = now_iso
        else:
            status = "Pending"
            updated = None
        if stop < 0 and i == 0:
            status = "In Progress"
            updated = now_iso
        stages.append({
            "key": key,
            "label": label,
            "actor": actor,
            "owner": owner,
            "status": status,
            "updatedAt": updated,
            "notes": "",
            "documents": [],
        })
    return stages


def _notes(row: Dict[str, str]) -> str:
    lines: List[str] = ["Imported from National Portal / PM Surya Ghar CSV."]
    pairs = [
        ("Application No", row.get("application_no")),
        ("Registration No", row.get("registration_no")),
        ("Scheme", row.get("scheme")),
        ("Portal Status", row.get("portal_status")),
        ("DISCOM", row.get("discom_name")),
        ("Circle", row.get("circle_name")),
        ("Division", row.get("division_name")),
        ("Sub Division", row.get("sub_division_name")),
        ("Loan", row.get("loan_status") or row.get("loan_taken")),
        ("Bank", row.get("loan_bank")),
        ("Feasibility Remarks", row.get("feasibility_return_remarks")),
        ("Inspection Comment", row.get("inspection_return_comment")),
        ("Subsidy Return", row.get("subsidy_return_comment")),
        ("Last Comment", row.get("last_comment")),
        ("RWA Houses", row.get("rwa_houses")),
    ]
    for label, value in pairs:
        v = _clean(value)
        if v:
            lines.append(f"{label}: {v}")
    return "\n".join(lines)[:4000]


def _portal(row: Dict[str, str]) -> Dict[str, Any]:
    fields = (
        "serial", "registration_no", "application_no", "scheme", "portal_status",
        "discom_name", "circle_name", "division_name", "sub_division_name",
        "connection_category", "loan_taken", "loan_status", "loan_bank",
        "feasibility_return_remarks", "inspection_status", "last_comment",
    )
    data = {k: _clean(row.get(k)) for k in fields if _clean(row.get(k))}
    data["source"] = "national_portal_csv"
    return data


def _solar(row: Dict[str, str]) -> Optional[Dict[str, Any]]:
    serials_raw = _clean(row.get("module_serials"))
    serials = [s.strip() for s in re.split(r"[,\n;/]+", serials_raw) if s.strip()] if serials_raw else []
    bos_bits = []
    if _clean(row.get("module_make")):
        bos_bits.append(f"Module: {_clean(row.get('module_make'))}")
    cap = _clean(row.get("module_capacity_wp"))
    qty = _clean(row.get("module_qty"))
    if cap or qty:
        bos_bits.append(f"Module {cap or '?'} Wp x {qty or '?'}")
    if _clean(row.get("inverter_make")):
        bos_bits.append(
            f"Inverter: {_clean(row.get('inverter_make'))} {_clean(row.get('inverter_capacity_kw'))} kW x {_clean(row.get('inverter_qty')) or '1'}"
        )
    proposed = _parse_float(row.get("proposed_size_kw")) or _parse_float(row.get("installed_capacity_kw"))
    solar: Dict[str, Any] = {
        "sanctioned_load_kw": _parse_float(row.get("sanctioned_load_kw")),
        "proposed_size_kw": proposed,
        "discom_consumer_no": _clean(row.get("consumer_no")) or None,
        "discom_app_id": _clean(row.get("application_no")) or None,
        "subsidy_status": _subsidy_status(row),
        "subsidy_amount": _parse_float(row.get("subsidy_amount")),
        "panel_serials": serials or None,
        "bos_notes": "; ".join(bos_bits)[:2000] or None,
    }
    solar = {k: v for k, v in solar.items() if v not in (None, "", [])}
    return solar or None


def map_row(row: Dict[str, str], now_iso: Optional[str] = None) -> Dict[str, Any]:
    now_iso = now_iso or datetime.now(timezone.utc).isoformat()
    name = _clean(row.get("full_name"))
    if len(name) < 2:
        return {"ok": False, "error": "Consumer name missing"}

    raw_phone = _clean(row.get("phone"))
    phone = _normalize_phone(raw_phone)
    is_masked = is_masked_phone(phone)
    if not (PHONE_RE.match(phone) or is_masked):
        return {"ok": False, "error": "Invalid mobile number", "phone": phone or raw_phone}

    app_no = _clean(row.get("application_no"))
    email = _clean_email(row.get("email"), app_no or phone)

    address = _clean(row.get("address"))
    pincode = _extract_pincode(address)
    created = _parse_date(row.get("submitted_at")) or now_iso
    completed = infer_completed_stage(row)

    return {
        "ok": True,
        "phone": phone,
        "payload": {
            "full_name": name[:120],
            "phone": phone,
            "email": email,
            "state": _clean(row.get("state")),
            "city": _clean(row.get("city")),
            "pincode": pincode,
            "address": address,
            "property_type": _property_type(_clean(row.get("connection_category"))),
            "monthly_bill": 0,
            "source": "Existing Customer",
            "notes": _notes(row),
            "created_at": created,
            "updated_at": now_iso,
            "stages": build_stages(completed, now_iso),
            "solar": _solar(row),
            "portal": _portal(row),
            "legacy_import": True,
            "is_phone_masked": is_masked,
        },
    }


def preview_rows(records: Sequence[Dict[str, str]], limit: int = 8) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i, row in enumerate(records[:limit], start=2):
        mapped = map_row(row)
        item = {
            "row": i,
            "name": _clean(row.get("full_name")),
            "phone": _clean(row.get("phone")),
            "ok": mapped["ok"],
        }
        if mapped["ok"]:
            item["stage"] = next(
                (s["key"] for s in mapped["payload"]["stages"] if s["status"] == "In Progress"),
                mapped["payload"]["stages"][-1]["key"] if mapped["payload"]["stages"][-1]["status"] == "Completed" else "lead_captured",
            )
        else:
            item["error"] = mapped.get("error")
        out.append(item)
    return out
