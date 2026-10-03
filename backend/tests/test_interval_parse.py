from interval_parse import parse_interval_file
from solar_profiles import DEFAULT_DAILY_PROFILE, apply_bill_estimate, empty_consumption, empty_tariff, kwh_from_bill, months_from_average, pad_daily


def test_kwh_from_bill():
    assert kwh_from_bill(4250, 8.5) == 500.0
    assert kwh_from_bill(1000, 0) == 0.0


def test_months_from_average():
    months = months_from_average(600)
    assert months == [600.0] * 12


def test_empty_tariff_defaults():
    t = empty_tariff("p1")
    assert t["mode"] == "flat"
    assert t["metering"] == "net_metering"
    assert t["escalation_rate"] == 3.5
    assert t["price_per_kwh"] == 8.5
    assert t["zero_export"] is False
    assert len(t["tou_slots"]) == 3


def test_empty_consumption_and_bill_estimate():
    c = empty_consumption("p1", 400)
    assert c["type"] == "monthly_avg"
    assert c["current"]["monthly_kwh"][0] == 400.0
    assert len(c["current"]["daily_profile"]) == 24
    updated = apply_bill_estimate(c, 8500, 8.5, "current")
    assert updated["type"] == "monthly_bill"
    assert updated["current"]["monthly_kwh"][3] == 1000.0
    assert updated["current"]["monthly_bill_rs"] == 8500.0


def test_pad_daily_normalizes():
    raw = [1] * 24
    out = pad_daily(raw)
    assert abs(sum(out) - 1.0) < 0.001


def test_parse_monthly_wide_csv():
    header = "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec"
    row = "100,110,120,130,140,150,160,170,180,190,200,210"
    parsed = parse_interval_file(f"{header}\n{row}".encode("utf-8"), "months.csv")
    assert parsed["monthly_kwh"][0] == 100.0
    assert parsed["monthly_kwh"][11] == 210.0
    assert parsed["daily_profile"] == list(DEFAULT_DAILY_PROFILE)


def test_parse_interval_datetime_csv():
    lines = ["timestamp,kWh"]
    for hour in range(24):
        lines.append(f"2025-01-01 {hour:02d}:00:00,2")
        lines.append(f"2025-06-01 {hour:02d}:00:00,4")
    parsed = parse_interval_file("\n".join(lines).encode("utf-8"), "interval.csv")
    assert parsed["type"] == "interval_csv"
    assert parsed["monthly_kwh"][0] == 48.0
    assert parsed["monthly_kwh"][5] == 96.0
    assert parsed["row_count"] == 48
    assert abs(sum(parsed["daily_profile"]) - 1.0) < 0.01
