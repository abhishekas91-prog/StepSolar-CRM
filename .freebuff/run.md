# Step Solar CRM — Dev Server

## Reproduce uncommitted artifacts

No env files or generated files needed. Dependencies install with:

```
cd frontend && npm install
```

## Run the server

```
cd frontend && npm run dev
```

Vite starts on **http://127.0.0.1:5173**. The entry point is `crm.html` (hash router — all routes resolve to this file).

API calls to `/api/*` proxy to `http://localhost:8000` by default. Override with `VITE_API_TARGET` env var. Without a backend running, the dashboard will show a 503 "Server is waking up" message — this is the cold-start retry behavior added in PR #2.
