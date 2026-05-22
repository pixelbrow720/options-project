# FlowOptionID — Public site deployment

The public site is a static Vite + React build. The backend is **not** static — it runs ingestion continuously and must live on a real server (VPS or container host).

## 1. Free domain via is-a.dev

`flowoptionid.is-a.dev` is the goal. is-a.dev hands out free subdomains via PR.

1. Fork https://github.com/is-a-dev/register
2. Add `domains/flowoptionid.json`:
   ```json
   {
     "owner": { "username": "<your-github>", "email": "<you@example.com>" },
     "record": { "CNAME": "flowoptionid.netlify.app" }
   }
   ```
   Use your provider's CNAME target (Netlify, Vercel, or Cloudflare Pages). For an apex with the API on a subdomain, add a second JSON file `domains/api.flowoptionid.json` pointing at your backend host.
3. Open a PR. Merge usually takes a few days.
4. Fallback: every provider gives you a free `*.netlify.app` / `*.vercel.app` / `*.pages.dev` subdomain immediately.

## 2. Deploy the static site

### Netlify

`netlify.toml` is already in this directory.

```bash
npm install -g netlify-cli
netlify login
netlify deploy --build --prod
```

Or connect the repo in the Netlify UI — it will auto-detect `netlify.toml`. Set `VITE_API_BASE_URL` in Site settings → Environment if your API host differs from the default.

### Vercel

`vercel.json` is already in this directory.

```bash
npm install -g vercel
vercel login
vercel --prod
```

In the Project Settings → Environment Variables, set `VITE_API_BASE_URL` to your backend URL.

### Cloudflare Pages

```bash
npm install -g wrangler
wrangler login
npm run build
wrangler pages deploy dist --project-name flowoptionid-public
```

Set `VITE_API_BASE_URL` in the Pages project's environment settings before building.

## 3. DNS records

| Provider          | Record at `flowoptionid.is-a.dev`         |
|-------------------|-------------------------------------------|
| Netlify           | `CNAME → <site-name>.netlify.app`         |
| Vercel            | `CNAME → cname.vercel-dns.com`            |
| Cloudflare Pages  | `CNAME → <project>.pages.dev`             |

For the API, add `api.flowoptionid.is-a.dev` pointing at wherever the backend container runs (Fly.io app domain, Railway domain, your VPS A record).

## 4. Backend hosting

The public site is static, but the backend ingests Databento continuously and needs a long-running process. Free options:

- **Fly.io** — 3 shared-CPU `fly machines` are free. `fly launch` from `backend/` works with the existing Dockerfile.
- **Railway** — generous free trial, then ~$5/mo. Supports the Dockerfile out of the box.
- **Render** — free static + paid backend tier.

For serious production use you will eventually need a paid VPS — Databento ingestion runs 24/7 and free tiers will cap CPU or sleep idle workers.

## 5. Discord OAuth callback URLs

After deploying, add **all** active callbacks to Discord OAuth2 → Redirects:

- `http://localhost:3001/auth/callback` (local dev)
- `https://flowoptionid.is-a.dev/auth/callback` (custom domain)
- `https://flowoptionid.netlify.app/auth/callback` (Netlify default)
- `https://flowoptionid.vercel.app/auth/callback` (if using Vercel)

Update `DISCORD_REDIRECT_URI` in the backend `.env` to match the public-site origin you actually serve from.
