# API Contract — StepSolar Field ↔ StepSolar-CRM

> This same file lives in the separate `StepSolar-Field-App` repo (the
> Android app). If you change any endpoint shape listed below in
> `server.py`, update it in both places and check whether the app needs
> a matching change before shipping.

This app is a **separate repo** from `StepSolar-CRM` but talks to the same
backend (`stepsolar-backend.onrender.com`). Since there's no shared code
between the two repos, this file is the connection between them — it's
the exact set of endpoints/shapes this app depends on. The same file
lives at the root of `StepSolar-CRM` too.

**Rule:** if you change any of the request/response shapes below in
`server.py`, update this file in *both* repos in the same sitting, and
check whether the app needs a matching change before you ship the
backend change. If you only add new optional fields, the app keeps
working untouched — just add a line here for the record.

Base URL: `https://stepsolar-backend.onrender.com/api`

| Endpoint | Used for | Notes |
|---|---|---|
| `POST /auth/login` | Login | body `{email, password}` → `{access_token, id, email, full_name, role, must_change_password}` |
| `GET /auth/me` | Session validation on app reopen | Bearer token → `{id, email, full_name, role}` |
| `GET /crm/leads/mine` | Projects list | Needs `backend_patch/` applied (see StepSolar-CRM repo). Falls back to `GET /crm/leads` + on-device filter if missing (404). |
| `GET /crm/leads/{id}` | Project detail | Full lead doc incl. `stages[]` |
| `PATCH /crm/leads/{id}` | Stage status/notes/location update | body `{stages: [...]}` — **must send the full stages array**, only the target stage's fields changed, same order/keys as received. Role-based: non-Admin can only change stages where `stage.owner === my role`. |
| `POST /crm/leads/{id}/stages/{stage_key}/documents` | Proof photo upload | multipart `file` field. Role must be in `_can_manage_docs` (Admin/Sales/Site Survey/Installation/Accounts — currently everyone). |
| `POST /crm/leads/{id}/whatsapp/document` | Send quotation/invoice/receipt/pv-design via WaCRM | body `{document_type, document_no?, message?, doc_id?}`. Optional `doc_id` uses an uploaded file. `pv-design`/`design` generates PDF from that design id or the lead's latest simulated design. Returns `{ok, status, channel, filename}`. |
| `GET /crm/whatsapp/chat?phone=` | In-app WhatsApp history | WaCRM proxy. Returns `{messages, contact, conversation_id}`. |
| `POST /crm/whatsapp/chat` | Send WhatsApp text | body `{phone, text}` via WaCRM Business API. |

## Fields this app adds to the stage object

The backend stores each stage as a free-form dict (only `key` and
`status` are validated), so this app rides an extra field on top without
any backend schema change:

```json
{
  "location": { "lat": 0.0, "lng": 0.0, "accuracy": 0.0, "capturedAt": "iso8601" }
}
```

The CRM web frontend's "Field Updates" tab (`LeadProfile.jsx`) reads this
same field to show GPS + notes + photo count per stage.

## Remote PV design (additive — field + CRM)

These endpoints are **new**. Existing `/crm/leads*` shapes are unchanged. Optional fields written back onto the lead (`solar.proposed_size_kw`, `pv_design_id`, `pv_design_summary`) are additive.

| Endpoint | Used for | Notes |
|---|---|---|
| `GET /crm/design/catalog` | Module + inverter library | `{panels, inverters}` |
| `GET /crm/designs?lead_id=` | List designs | Newest first |
| `GET /crm/designs/{id}` | Load a design | Full roof polygons + last `result` |
| `GET /crm/leads/{id}/design` | Latest design for a lead | Empty draft if none yet |
| `POST /crm/designs` | Create | body may include `lead_id`, `location`, `roofs[]`, finance inputs |
| `PUT /crm/designs/{id}` | Autosave layout | Partial upsert |
| `POST /crm/designs/{id}/simulate` | Auto-fill modules + energy + IRR | Returns `{design, result}`. Also patches lead `solar.proposed_size_kw` |
| `POST /crm/designs/{id}/generate` | Annual generation (Phase 4) | body optional `{system_losses?, shading_factor?}`. Returns `{design, generation}`. Alias: `POST /api/design/designs/{id}/generate`. Sources: pvlib, then NREL PVWatts (`NREL_API_KEY` / `PVWATTS_API_KEY`), else climate. Default losses 14%, degradation 0.5%/yr, 25-year array. |
| `POST /crm/designs/{id}/irradiance` | Roof solar-access heatmap | Returns `{solar_access, cells[], source, cache_key, cached}`. Google Solar (`GOOGLE_SOLAR_API_KEY` / `GOOGLE_MAPS_API_KEY`) with 14-day Mongo `irradiance_cache`; fallback shadow/pvlib clamped 0.7–1.0. |
| `POST /crm/design/geocode` | Address search | body `{q}` → `[{label, lat, lng}]`. Nominatim (no Google Places). |

Roof object: `{id, name, tilt, azimuth, setback_m, orientation, points:[{lat,lng}]}`.

## Design Projects (additive — CRM only, Phase 1–2)

Existing `/projects` ops page and `/crm/leads*` shapes are unchanged. New Mongo collections: `solar_projects`, `tariff_profiles`, `consumption_profiles`, `designs` (nested per project, not `pv_designs`), `defaults_profiles`.

### Schema

`solar_projects`: `{id, code (SPV-0001), name, address, location{lat,lng,zoom}, lead_id?, lead_code?, customer_name?, customer_phone?, monthly_bill?, status, notes, created_at, updated_at, created_by, updated_by}`

`tariff_profiles`: `{project_id, mode: flat|tou, metering: net_metering|gross_metering|net_billing, price_per_kwh, escalation_rate (default 3.5), zero_export, export_only, tou_slots[{name,start,end,price_per_kwh}]}`

`consumption_profiles`: `{project_id, type: monthly_avg|monthly_bill|interval_csv, current{monthly_kwh[12], daily_profile[24]}, future{...}}`

`designs`: `{id, project_id, name, defaults_profile, defaults{}, status, created_at}`

`defaults_profiles`: `{id, name (e.g. BD TEAM), panel_id, tilt, azimuth, setback_m, soiling_loss, orientation}` — Admin-editable.

### Endpoints

| Endpoint | Used for | Notes |
|---|---|---|
| `GET /crm/solar-projects` | List | query `q`, `lead_id`, `status` |
| `POST /crm/solar-projects` | Create | body `{name, address, location, lead_id?}` → auto `SPV-####` |
| `POST /crm/solar-projects/from-lead/{lead_id}` | Create from lead | Returns existing if one already linked |
| `GET /crm/solar-projects/{id}` | Project summary bundle | `{project, tariff, consumption, designs}` |
| `PATCH /crm/solar-projects/{id}` | Rename / move pin | |
| `DELETE /crm/solar-projects/{id}` | Admin only | Also drops tariff, consumption, nested designs |
| `GET/PUT /crm/solar-projects/{id}/tariff` | Utility rate | |
| `GET/PUT /crm/solar-projects/{id}/consumption` | Load profile | |
| `POST /crm/solar-projects/{id}/consumption/from-bill` | Bill se kWh | body `{monthly_bill_rs, price_per_kwh?, which}` |
| `POST /crm/solar-projects/{id}/consumption/interval` | CSV/XLSX upload | multipart `file`, query `which=current\|future` |
| `GET/POST /crm/solar-projects/{id}/designs` | Nested designs | POST `{name, defaults_profile}` |
| `PATCH/DELETE /crm/solar-projects/{id}/designs/{design_id}` | Nested design | |
| `GET /crm/defaults-profiles` | Defaults library | Seeds `BD TEAM` |
| `POST/PUT/DELETE /crm/defaults-profiles` | Admin edit | |

Nested `designs` POST also seeds a `pv_designs` row (`pv_design_id`) so the card opens `#/design/:pv_design_id`.

CRM UI: `#/pv-projects` list + create modal (Nominatim + Esri satellite). `#/pv-projects/:id` summary (tariff, consumption, designs). Studio: Calculate Generation, Irradiance Map, 2D/3D/Dual, Sun Path. Ops `#/projects` untouched.

## Design proposals (additive — CRM, Phase 5)

Existing `/crm/leads*` and `/proposal` quotation pages are unchanged. New collections: `proposals`, `pricing_templates`. Subsidy rates live in `settings` id `pm_surya_ghar` (Admin-editable).

`proposals`: `{id, design_id, lead_id?, solar_project_id?, pricing{items[], total, mode, template_id}, subsidy{scheme, amount, capped, breakdown[]}, finance{payback_years, irr, npv, cashflows[25], monthly_kwh[12], total_savings_25}, branding{logo, colors, sections_enabled}, financing{}, public_token, public_url, generated_at, warranty[], terms[], payment_schedule[]}`

| Endpoint | Used for | Notes |
|---|---|---|
| `POST /crm/designs/{id}/proposal` | Generate | body optional `{template_id, items[], branding, financing, mark_pipeline}`. Seeds pricing template `epc-std` (Rs 44/W). Marks lead `quotation_sent` + activity `proposal.sent`. |
| `GET /crm/designs/{id}/proposal` | Load latest | |
| `PATCH /crm/designs/{id}/proposal` | Edit pricing / branding | Recalculates subsidy + 25-yr cashflow |
| `GET /crm/designs/{id}/proposal.pdf` | A4 PDF (fpdf2) | Auth required |
| `POST /crm/designs/{id}/proposal/share` | WhatsApp + pipeline | body `{}`. Uses existing QUOTATION_SENT notify. |
| `GET /api/public/proposal/{token}` | Public read-only | No auth. `{proposal, design}` (roofs + 3D). |
| `GET /api/public/proposal/{token}/pdf` | Public PDF | No auth |
| `GET/PUT /crm/subsidy-settings` | PM Surya Ghar rates | PUT Admin. Default Rs 30,000/kW first 2 kW + Rs 18,000 third, cap Rs 78,000. Commercial 0. |
| `GET/POST/PUT /crm/pricing-templates` | EPC BOM / INR-W | POST/PUT Admin |

CRM UI: `#/documentProposal/:designId` (from studio **Proposal**). Public `#/p/:token`. Master Config tab **PM Surya Ghar**.

## Versioning

No formal API version header yet (single backend, single app, one
developer). If that ever becomes a problem, add an `X-App-Version`
header from the app and log it server-side before making a breaking
change — not needed at current scale.
