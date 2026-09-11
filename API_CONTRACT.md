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
| `POST /crm/leads/{id}/whatsapp/document` | Send quotation/invoice/receipt via WaCRM | body `{document_type, document_no?, message?}`. Returns `{ok, status, log_id, error}`. `error=whatsapp_disabled` until Admin pastes a `wacrm_live_` key. Phone is normalised to E.164 (`+91…`) server-side. |
| `GET /crm/whatsapp/chat?phone=` | Live WaCRM inbox for CRM + field chat popups | Bearer JWT. Query `phone` (8–20 chars). Returns `{ok, enabled, phone, conversation_id, contact_id, messages[], error}`. |
| `POST /crm/whatsapp/chat` | Send free-form WhatsApp text via WaCRM | body `{phone, text}`. Returns `{ok, conversation_id, message_id, error}`. Same thread as the in-app chat popup. |

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

## Versioning

No formal API version header yet (single backend, single app, one
developer). If that ever becomes a problem, add an `X-App-Version`
header from the app and log it server-side before making a breaking
change — not needed at current scale.
