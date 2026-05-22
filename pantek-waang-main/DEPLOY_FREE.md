# Free Deployment Guide

Deploy the full stack for $0/month using Render + Neon + Vercel free tiers.

---

## Architecture

```
Vercel (free)     → public-site (port 3001 equivalent)
Vercel (free)     → admin panel  (port 3000 equivalent)
Render (free)     → backend FastAPI (port 8000)
Neon (free)       → PostgreSQL 16 (no TimescaleDB — app handles gracefully)
```

---

## Step 1: Database (Neon)

1. Go to https://neon.tech → Sign up (free, no credit card)
2. Create a new project → name: `pantek-waang`
3. Copy the connection string. It looks like:
   ```
   postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
4. For the backend, you need the **asyncpg** variant:
   ```
   postgresql+asyncpg://user:pass@ep-xxx.region.aws.neon.tech/neondb?ssl=require
   ```
   (Replace `postgresql://` with `postgresql+asyncpg://` and `sslmode=require` with `ssl=require`)

---

## Step 2: Backend (Render)

1. Go to https://render.com → Sign up (free, no credit card)
2. New → Web Service → Connect your GitHub repo
3. Settings:
   - **Name:** `pantek-waang-backend`
   - **Root Directory:** `pantek-waang-main/backend`
   - **Runtime:** Docker
   - **Instance Type:** Free
4. Environment Variables (set these):
   ```
   DATABASE_URL=postgresql+asyncpg://user:pass@ep-xxx.region.aws.neon.tech/neondb?ssl=require
   JWT_SECRET=<generate-random-64-char-string>
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<your-secure-password>
   SUPPORTED_SYMBOLS=SPXW,NDXP
   DISABLE_LIVE_INGESTION=true
   DISABLE_HISTORICAL_BACKFILL=true
   ENABLE_OPENAPI_DOCS=true
   PUBLIC_CORS_ORIGINS=https://your-public-site.vercel.app
   ADMIN_CORS_ORIGINS=https://your-admin.vercel.app
   DISCORD_CLIENT_ID=<from-discord-developer-portal>
   DISCORD_CLIENT_SECRET=<from-discord-developer-portal>
   DISCORD_BOT_TOKEN=<your-bot-token>
   DISCORD_GUILD_ID=<your-server-id>
   DISCORD_REDIRECT_URI=https://your-public-site.vercel.app/auth/callback
   DISCORD_INVITE_URL=https://discord.gg/dy78P5vP62
   PUBLIC_SESSION_JWT_SECRET=<generate-another-random-64-char-string>
   ```
5. Deploy → wait for build + health check at `/health`

**Note:** Render free tier sleeps after 15 min inactivity. First request after sleep takes ~30s to wake. Acceptable for prototype.

**Generate random secrets:**
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

---

## Step 3: Public Site (Vercel)

1. Go to https://vercel.com → Sign up / login
2. Import Git Repository → select your repo
3. Settings:
   - **Framework Preset:** Vite
   - **Root Directory:** `pantek-waang-main/public-site`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Environment Variables:
   ```
   VITE_API_BASE_URL=https://pantek-waang-backend.onrender.com
   ```
5. Deploy

---

## Step 4: Admin Panel (Vercel)

1. Same Vercel account → Add New Project
2. Import same repo
3. Settings:
   - **Framework Preset:** Vite
   - **Root Directory:** `pantek-waang-main/frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Environment Variables:
   ```
   VITE_API_BASE_URL=https://pantek-waang-backend.onrender.com
   ```
5. Deploy

---

## Step 5: Update CORS Origins

After both Vercel projects deploy, you'll have URLs like:
- `https://flowoptionid-public.vercel.app`
- `https://flowoptionid-admin.vercel.app`

Go back to Render → Environment → update:
```
PUBLIC_CORS_ORIGINS=https://flowoptionid-public.vercel.app
ADMIN_CORS_ORIGINS=https://flowoptionid-admin.vercel.app
DISCORD_REDIRECT_URI=https://flowoptionid-public.vercel.app/auth/callback
```

Redeploy backend.

---

## Step 6: Run Migrations

After backend is deployed and DB is connected:

```bash
# Option A: Render Shell (Dashboard → Shell tab)
cd /app && alembic upgrade head

# Option B: If Render shell not available on free tier,
# the Dockerfile already runs migrations on startup via scripts/run.sh
```

The migrations are TimescaleDB-optional — they skip hypertable/compression/retention
calls gracefully on plain Postgres (Neon).

---

## Step 7: Create First Admin API Key

1. Open admin panel: `https://your-admin.vercel.app`
2. Login with `ADMIN_USERNAME` / `ADMIN_PASSWORD`
3. Go to API Keys → Create
4. Set label, allowed symbols `SPXW,NDXP`
5. Copy the plaintext key (shown ONCE)
6. Use this key to login on the public site

---

## Troubleshooting

### "timeout of 15000ms exceeded" on login
- Backend is sleeping (Render free tier). Wait 30s and retry.
- Or: backend URL is wrong in `VITE_API_BASE_URL`. Check browser DevTools → Network tab for the actual URL being called.

### "Network Error"
- CORS not configured. Ensure `PUBLIC_CORS_ORIGINS` / `ADMIN_CORS_ORIGINS` match your Vercel URLs exactly (no trailing slash).

### Migrations fail
- Check `DATABASE_URL` format: must be `postgresql+asyncpg://...?ssl=require`
- Neon requires SSL. Without `?ssl=require` the connection is refused.

### Discord OAuth not working
- `DISCORD_REDIRECT_URI` must exactly match what's configured in Discord Developer Portal → OAuth2 → Redirects.
- Format: `https://your-public-site.vercel.app/auth/callback`

---

## Cost Summary

| Service | Tier | Cost | Limits |
|---------|------|------|--------|
| Neon | Free | $0 | 0.5 GB storage, 190 compute hours/mo |
| Render | Free | $0 | 750 hours/mo, sleeps after 15min |
| Vercel × 2 | Hobby | $0 | 100 GB bandwidth/mo |
| **Total** | | **$0** | |

---

## Upgrading Later

When ready for production:
- Render → Starter ($7/mo): no sleep, more RAM
- Neon → Launch ($19/mo): more storage, always-on
- Add Timescale Cloud ($0-29/mo): enables hypertables, compression, retention
- Add `DATABENTO_API_KEY_OPRA` + set `DISABLE_LIVE_INGESTION=false` for real data
