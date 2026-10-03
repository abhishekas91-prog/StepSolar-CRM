from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from solar_profiles import DEFAULT_DAILY_PROFILE

_DATETIME_HINTS = ("datetime", "timestamp", "date", "time", "interval_start", "period")
_ENERGY_HINTS = ("kwh", "kw_h", "energy", "consumption", "usage", "units", "kwhr")
_MONTH_HINTS = {
    "jan": 0, "january": 0,
    "feb": 1, "february": 1,
    "mar": 2, "march": 2,
    "apr": 3, "april": 3,
    "may": 4,
    "jun": 5, "june": 5,
    "jul": 6, "july": 6,
    "aug": 7, "august": 7,
    "sep": 8, "sept": 8, "september": 8,
    "oct": 9, "october": 9,
    "nov": 10, "november": 10,
    "dec": 11, "december": 11,
}


def _norm(name: str) -> str:
    return "".join(ch for ch in str(name or "").strip().lower() if ch.isalnum() or ch in "_")


def _find_col(columns: List[str], hints: Tuple[str, ...]) -> Optional[str]:
    normalized = {col: _norm(col) for col in columns}
    for col, key in normalized.items():
        if any(h in key for h in hints):
            return col
    return None


def _read_frame(data: bytes, filename: str):
    import pandas as pd

    name = (filename or "").lower()
    buf = BytesIO(data)
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(buf)
    return pd.read_csv(buf)


def _monthly_from_wide(df) -> Optional[List[float]]:
    month_idx: Dict[int, str] = {}
    for col in df.columns:
        key = _norm(col)
        if key in _MONTH_HINTS:
            month_idx[_MONTH_HINTS[key]] = col
            continue
        for hint, idx in _MONTH_HINTS.items():
            if key.startswith(hint) or key.endswith(hint):
                month_idx[idx] = col
                break
    if len(month_idx) < 12:
        return None
    values = []
    for i in range(12):
        col = month_idx[i]
        series = df[col].dropna()
        values.append(round(float(series.sum() if len(series) else 0), 2))
    return values


def _interval_aggregates(df, dt_col: str, kwh_col: str) -> Tuple[List[float], List[float], int]:
    import pandas as pd

    work = df[[dt_col, kwh_col]].copy()
    parsed = pd.to_datetime(work[dt_col], errors="coerce", utc=False)
    if parsed.isna().mean() > 0.5:
        parsed = pd.to_datetime(work[dt_col], errors="coerce", dayfirst=True)
    work[dt_col] = parsed
    work[kwh_col] = pd.to_numeric(work[kwh_col], errors="coerce")
    work = work.dropna(subset=[dt_col, kwh_col])
    if work.empty:
        raise ValueError("No valid datetime / kWh rows in interval file")
    monthly = [0.0] * 12
    hourly = [0.0] * 24
    for _, row in work.iterrows():
        ts = row[dt_col]
        val = float(row[kwh_col])
        monthly[int(ts.month) - 1] += val
        hourly[int(ts.hour)] += val
    total = sum(hourly) or 1.0
    daily = [round(v / total, 4) for v in hourly]
    return [round(v, 2) for v in monthly], daily, int(len(work))


def parse_interval_file(data: bytes, filename: str = "interval.csv") -> Dict[str, Any]:
    if not data:
        raise ValueError("Empty file")
    df = _read_frame(data, filename)
    if df is None or df.empty:
        raise ValueError("Spreadsheet has no rows")
    df.columns = [str(c).strip() for c in df.columns]

    wide = _monthly_from_wide(df)
    if wide is not None:
        return {
            "type": "interval_csv",
            "monthly_kwh": wide,
            "daily_profile": list(DEFAULT_DAILY_PROFILE),
            "row_count": int(len(df)),
        }

    dt_col = _find_col(list(df.columns), _DATETIME_HINTS)
    kwh_col = _find_col(list(df.columns), _ENERGY_HINTS)
    if not dt_col or not kwh_col:
        raise ValueError("Need datetime + kWh columns, or Jan-Dec monthly columns")
    monthly, daily, rows = _interval_aggregates(df, dt_col, kwh_col)
    return {
        "type": "interval_csv",
        "monthly_kwh": monthly,
        "daily_profile": daily,
        "row_count": rows,
    }
