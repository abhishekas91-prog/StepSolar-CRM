from csv_import import (
    build_stages,
    infer_completed_stage,
    map_row,
    parse_csv_bytes,
)


HEADERS = (
    "Serial Number\tApplication Submitted Date\tConsumer Registration Number\t"
    "Application Number\tScheme (PM Surya Ghar/ Scheme 4/Scheme 5)\t"
    "Current Status of Application\tConsumer Name\tMobile No. of Consumer\t"
    "Email of Consumer\tConsumer Address\tDistrict Name\tState Name\t"
    "Consumer Number\tVendor Selection Date By Consumer\tVendor Consent Date\t"
    "Vendor Consumer Agreement Uploaded (Yes/No)\tVendor Consumer Agreement Uploading Date\t"
    "Connection Category Name (RWA/Domestic)\tSanction Load (kWp)\tProposed PV Capacity (kWp)\t"
    "Discom Name\tCircle Name\tDivision Name\tSub Division Name\tHas Existing Capacity (Y/N)\t"
    "Existing Capacity (kWp)\tLoan Taken (Yes/No)\tLoan Application Date\tLoan Applied at Bank\t"
    "Bank Branch Address\tLoan Status : Pending/ Sanctioned/Rejected\tLoan Sanctioned date \t"
    "Loan rejection Date\tLoan Disbursed Date (First Tranche)\tLoan Disbursed Amount (First Tranche)\t"
    "Loan First Tranche Disbursal UTR\tLoan Disbursed Date (Second Tranche)\t"
    "Loan Disbursed Amount (Second Tranche)\tLoan Second Tranche Disbursal UTR\t"
    "Feasibility Applied (kW)\tFeasibility Approved Date\tFeasibility Returned Date\t"
    "Feasibility Return (Remarks)\tSolar Plant Installation Date\tInstalled PV Module Capacity (kWp)\t"
    "PV Module Make\tModule Capacity (WP)\tModule Quantity\tPV Module Serial No\t"
    "Inverter Capacity (kW)\tInverter Make\tInverter Quantity\tInspection Status (Approved/Return)\t"
    "Inspection Date\tInspection Return Date\tInspection Return Comment\tSubsidy Redeem Date\t"
    "Subsidy Amount (Rs.)\tSubsidy Return Date\tSubsidy Return To (Installation / Inspection)\t"
    "Subsidy Return Comment\tSubsidy Verified Date\tSubsidy Disbursed Date\tLast Comment\t"
    "Last Comment Date\tNo. of House (RWA)"
)


def _row(**overrides):
    base = {
        "Consumer Name": "Rakesh Prasad",
        "Mobile No. of Consumer": "9876543210",
        "Email of Consumer": "rakesh@example.com",
        "Consumer Address": "Lane 4, Varanasi 221001",
        "District Name": "Varanasi",
        "State Name": "Uttar Pradesh",
        "Application Number": "UP/123",
        "Connection Category Name (RWA/Domestic)": "Domestic",
        "Proposed PV Capacity (kWp)": "3",
        "Sanction Load (kWp)": "5",
        "Current Status of Application": "Vendor Selection",
        "Application Submitted Date": "12-03-2025",
        "Consumer Number": "DISCOM-99",
        "Subsidy Amount (Rs.)": "",
        "Subsidy Disbursed Date": "",
        "Solar Plant Installation Date": "",
        "Vendor Consumer Agreement Uploaded (Yes/No)": "No",
    }
    base.update(overrides)
    values = []
    for h in HEADERS.split("\t"):
        values.append(base.get(h, ""))
    return "\t".join(values)


def test_parses_tab_portal_dump():
    raw = (HEADERS + "\n" + _row()).encode("utf-8")
    headers, records = parse_csv_bytes(raw)
    assert "Consumer Name" in headers
    assert len(records) == 1
    assert records[0]["full_name"] == "Rakesh Prasad"
    assert records[0]["phone"] == "9876543210"
    assert records[0]["city"] == "Varanasi"


def test_map_row_fills_lead_and_solar():
    _, records = parse_csv_bytes((HEADERS + "\n" + _row()).encode("utf-8"))
    mapped = map_row(records[0], now_iso="2026-01-01T00:00:00+00:00")
    assert mapped["ok"] is True
    p = mapped["payload"]
    assert p["phone"] == "9876543210"
    assert p["pincode"] == "221001"
    assert p["property_type"] == "Residential"
    assert p["source"] == "Existing Customer"
    assert p["solar"]["proposed_size_kw"] == 3.0
    assert p["solar"]["discom_consumer_no"] == "DISCOM-99"
    assert p["portal"]["application_no"] == "UP/123"


def test_missing_email_gets_placeholder():
    _, records = parse_csv_bytes((HEADERS + "\n" + _row(**{"Email of Consumer": ""})).encode())
    mapped = map_row(records[0])
    assert mapped["ok"]
    assert mapped["payload"]["email"].endswith("@imported.stepsolar.in")


def test_invalid_phone_is_rejected():
    _, records = parse_csv_bytes((HEADERS + "\n" + _row(**{"Mobile No. of Consumer": "123"})).encode())
    mapped = map_row(records[0])
    assert mapped["ok"] is False
    assert "mobile" in mapped["error"].lower()


def test_phone_strips_country_code():
    _, records = parse_csv_bytes(
        (HEADERS + "\n" + _row(**{"Mobile No. of Consumer": "+91 98765 43210"})).encode()
    )
    mapped = map_row(records[0])
    assert mapped["ok"]
    assert mapped["payload"]["phone"] == "9876543210"


def test_stage_advances_for_installed_plant():
    row = {
        "portal_status": "Inspection Approved",
        "installation_date": "01-02-2025",
        "inspection_status": "Approved",
        "subsidy_disbursed_date": "",
    }
    assert infer_completed_stage(row) == "commissioned"
    stages = build_stages("commissioned", "2026-01-01T00:00:00+00:00")
    done = [s["key"] for s in stages if s["status"] == "Completed"]
    assert "commissioned" in done
    active = [s for s in stages if s["status"] == "In Progress"]
    assert active and active[0]["key"] == "subsidy_disbursed"


def test_subsidy_disbursed_completes_pipeline():
    stages = build_stages("subsidy_disbursed", "2026-01-01T00:00:00+00:00")
    assert all(s["status"] == "Completed" for s in stages)
