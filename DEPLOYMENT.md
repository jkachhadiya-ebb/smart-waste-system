# Deployment Guide — Smart Waste System (ALL on Render)

Everything runs on **Render**: one web service serves the React frontend **and** the API from the
same domain, plus a managed PostgreSQL database. No Netlify, no second host, no CORS setup.

| Component | Where |
|-----------|-------|
| React frontend (built, served by Express) | Render web service `smart-waste` |
| Express + Socket.io API + simulators | same Render web service |
| PostgreSQL | Render database `smart-waste-db` |

Prepared files:
- `render.yaml` — blueprint that creates the web service + Postgres and builds everything
- `Database/smart_waste_full_dump.sql` — full DB dump (schema + all data, incl. disposal data)
- `.gitignore` — keeps `node_modules` and secrets out of git
- `server/db.js` — TLS enabled for Render Postgres (`DATABASE_SSL=true`)

How it works: at build time Render runs `npm run build` for the client with
`VITE_API_BASE_URL=$RENDER_EXTERNAL_URL/api` (your live Render URL, injected automatically), then
starts `node server/src/index.js`, which serves `client/dist` + the `/api` routes.

---

## Step 0 — Push to GitHub

Render deploys from a Git repo.

```bash
cd E:\smart-waste-system
git init
git add .
git commit -m "Smart Waste System — Render deploy"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/smart-waste-system.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `server/.env` (live SMTP secrets) and `node_modules`.

---

## Step 1 — Deploy the blueprint

1. **render.com → New → Blueprint**, connect your repo. Render reads `render.yaml` and creates:
   - **smart-waste-db** (Postgres)
   - **smart-waste** (web service — builds the client, runs the server)
2. On the **smart-waste** service, set the one required secret:
   - `TOTP_ENCRYPTION_KEY` — generate it:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - (Optional) `FRONTEND_URL` = your Render URL, and the `SMTP_*` vars if you want
     password-reset / notification emails. Not needed just to log in and use the app.
3. Click **Apply / Deploy** and wait for the build to finish (first build ~3–5 min).
4. Your app is live at `https://smart-waste.onrender.com` (your exact name may differ).
   Check `https://<your-url>/api/health` → `{"status":"ok"}`.

---

## Step 2 — Load the database

The app boots with an empty schema (its own migration runs once). Now load the real data.
From the Render **smart-waste-db** page, copy the **External Database URL**, then locally:

```bash
psql "postgresql://<external-connection-string>?sslmode=require" -f Database/smart_waste_full_dump.sql
```

The dump uses `--clean`, so it safely replaces the empty schema and restores **all** tables, the
disposal trigger/view, and the data (admin user, trucks, municipality, 135 disposal events).
Because the dump restores data **before** creating triggers, the disposal totals/landfill usage
stay exactly correct — no double-counting.

> If `psql` warns about a `SET transaction_timeout` line (PG version cosmetic), ignore it —
> the rest restores fine.

No redeploy needed — refresh the site.

---

## Step 3 — Log in

Open `https://<your-url>/` and log in:

- **Username:** `admin`
- **Password:** `admin`

> ⚠️ Change this right away — it's a public site.

The **Disposal** tab shows the seeded data: ~735 t total waste by type, Koblenz Central Landfill
at ~38.6% capacity, and 135 disposal records. Real-time telemetry (Socket.io) and the simulator
work because it's one persistent server.

---

## Notes

- **Free tier sleeps** after 15 min idle (first hit wakes in ~30–60s); free Postgres is wiped
  after 30 days. Upgrade either for permanence.
- **Re-seed disposal data** anytime: `Database/seed_disposal_fake_data.sql` (appends 135 events).
- **Local dev unchanged** — without `DATABASE_SSL` / `VITE_API_BASE_URL` everything still uses
  `localhost`, and `client/dist` is built for localhost.
- **No-Git alternative:** you can instead create the services manually in the Render dashboard
  (New → Web Service / New → Postgres) using the same build/start commands and env vars from
  `render.yaml` — but the Blueprint flow above is the easiest.
