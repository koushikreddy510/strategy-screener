# Deployment (koushik510.store)

## What happens when you push to `main`

1. **GitHub Actions** runs the "Deploy to Server" workflow (`.github/workflows/deploy.yml`).
2. The workflow SSHs into the server and:
   - Pulls latest code for **strategy-screener** and **data-store** in `/opt/strategy-screener` and `/opt/data-store`.
   - Installs Python deps in the screener venv.
   - Builds the frontend (`npm ci`/`npm install` + `REACT_APP_API_URL="" npm run build`).
   - Restarts the **screener-backend** systemd service.
   - Copies Nginx config and reloads Nginx.

**You don’t need to run any extra deploy command.** Push to `main` and the site updates after the workflow finishes.

## What you need once (repo + server)

1. **GitHub repo**  
   strategy-screener (and optionally data-store) pushed to GitHub.

2. **Secrets** (Settings → Secrets and variables → Actions):
   - `SERVER_HOST`: server IP or hostname (e.g. `210.79.129.135`).
   - `SSH_PRIVATE_KEY`: private key for user `ubuntu` on the server (so the runner can SSH in).

3. **Server**  
   One-time setup (Nginx, Postgres, app user `screener`, app dirs, systemd unit, etc.) as in `deploy/setup-server.sh`. After that, only the workflow steps above run on each push.

## Optional: run deploy script on the server

If you SSH in and want to deploy manually (same steps as the workflow):

```bash
cd /opt/strategy-screener
sudo -u screener bash deploy/deploy.sh
```

(Ensure `deploy.sh` has execute permission.)

## Checking sector data on prod

Sectors (and sub-sectors, if you add them) live in the **symbols** table. To see if prod has sectors populated, run locally against the prod DB:

```bash
DATABASE_URL="postgresql://market_user:YOUR_PASSWORD@210.79.129.135:5432/market" \
  python scripts/check_sector_coverage.py
```

If many symbols have empty sector, populate them by running the data-store enricher against prod (from a machine that can reach the DB and NSE):

```bash
cd /path/to/data-store
DATABASE_URL="postgresql://market_user:YOUR_PASSWORD@210.79.129.135:5432/market" \
  python enrich_market_cap.py
```

That script uses the NSE API and is rate-limited.

## Mobile / HTTPS

**Site not visible on mobile Chrome?** Mobile browsers often try HTTPS first. If the server only has HTTP (port 80), requests to `https://koushik510.store` will fail. Set up SSL:

1. On the server: `sudo apt install certbot python3-certbot-nginx`
2. Run: `sudo certbot --nginx -d koushik510.store -d www.koushik510.store`
3. Certbot configures SSL and auto-renewal. Until SSL works, use `http://koushik510.store` explicitly.
