# Step Solar CRM

Lead capture + pipeline management CRM for Step Solar Energy, split out of the
original `StepSolar` monorepo. This repo contains the FastAPI backend and the
React CRM frontend. The public marketing website lives in the separate
`StepSolar-Website` repo.

## Related repos

- `StepSolar-Website` — public marketing site
- `StepSolar-Field-App` — Android app for Sales/Ops employees to update
  pipeline stages from the field (React Native/Expo). Separate repo, no
  shared code — connected only through the backend API. **See
  `API_CONTRACT.md`** in this repo before changing any `/api/crm/*`
  request/response shape: it's the checklist for whether the field app
  needs a matching update.

## Structure

- `backend/` — FastAPI + MongoDB API (leads, auth, CRM, admin, WhatsApp)
- `frontend/` — React 19 + Vite CRM app (`crm.html` entry, `src/`)
- `legacy/crm.html` — self-contained vanilla JS version of the CRM (kept as reference)
- `render.yaml` — Render Blueprint for the backend service

## Backend (FastAPI)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill MONGO_URL, JWT_SECRET, etc.
uvicorn server:app --host 0.0.0.0 --port 8000
```

Health check: `GET /api/health`

Key endpoints:

- `POST /api/leads` — public quotation form submission
- `POST /api/auth/login` — email + password -> JWT
- `/api/crm/*` — CRM operations (valid JWT required)
- `/api/admin/*` — user management (Admin role only)

## Frontend (React CRM)

```bash
cd frontend
npm install
npm run dev          # dev server on :5173, proxies /api to :8000
npm run build        # production build -> dist/
```

The build entry is `crm.html` (see `vite.config.js`). The dev server proxies
`/api/*` to the backend at `http://localhost:8000` (override with
`VITE_API_TARGET`).

## Deployment

- Backend: Render (see `render.yaml`) or any uvicorn host.
- Frontend: any static host that builds `frontend/` and serves `dist/`
  (e.g. Netlify — see the monorepo `netlify.toml` for the original proxy rules).

## Remote PV design (Aurora / HelioScope-class)

CRM nav **PV Design** opens a satellite studio: search address, trace roof faces, auto-fill modules, simulate energy / strings / BOM / IRR. Linked from a lead via **PV Design Studio**. Designs live in Mongo `pv_designs` and optionally write `solar.proposed_size_kw` back onto the lead.

Field app (`step_solar_field`) uses the same APIs with GPS + roof length/width instead of map tracing. See `API_CONTRACT.md`.

```
GET  /api/crm/design/catalog
GET  /api/crm/designs?lead_id=
POST /api/crm/designs
PUT  /api/crm/designs/{id}
POST /api/crm/designs/{id}/simulate
```

## Tests

```bash
cd backend
python -m pytest
```
