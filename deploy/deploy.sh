#!/bin/bash
set -euo pipefail

# ============================================================
# Deploy Script — pulls latest code, builds, restarts services
# Usage: sudo -u screener bash /opt/strategy-screener/deploy/deploy.sh
# Or called by GitHub Actions via SSH
# ============================================================

APP_DIR="/opt/strategy-screener"
DATA_DIR="/opt/data-store"
LOG_DIR="/var/log/screener"

echo "$(date '+%Y-%m-%d %H:%M:%S') === Starting deployment ==="

# --- Pull latest code ---
echo "Pulling strategy-screener..."
cd "$APP_DIR"
git fetch origin main
git reset --hard origin/main

echo "Pulling data-store..."
cd "$DATA_DIR"
git fetch origin main
git reset --hard origin/main

# --- Backend dependencies ---
echo "Installing Python dependencies..."
cd "$APP_DIR"
"$APP_DIR/venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/venv/bin/pip" install --quiet -r requirements.txt

# --- Run DB migrations if any ---
echo "Running DB schema updates..."
PGPASSWORD=market_pass psql -h localhost -U market_user -d market -f "$DATA_DIR/schema.sql" 2>/dev/null || true
PGPASSWORD=market_pass psql -h localhost -U market_user -d market -f "$DATA_DIR/ohlc.sql" 2>/dev/null || true
PGPASSWORD=market_pass psql -h localhost -U market_user -d market -f "$DATA_DIR/enrich_symbols.sql" 2>/dev/null || true
PGPASSWORD=market_pass psql -h localhost -U market_user -d market -f "$DATA_DIR/financials_schema.sql" 2>/dev/null || true
PGPASSWORD=market_pass psql -h localhost -U market_user -d market -f "$DATA_DIR/commodity_schema.sql" 2>/dev/null || true
# --- Frontend build ---
echo "Building frontend..."
cd "$APP_DIR/frontend"
npm ci --silent 2>/dev/null || npm install --silent
REACT_APP_API_URL="" npm run build

# --- Update systemd service if changed ---
echo "Updating systemd service..."
sudo cp "$APP_DIR/deploy/screener-backend.service" /etc/systemd/system/screener-backend.service
sudo systemctl daemon-reload

# --- Restart backend ---
echo "Restarting backend..."
sudo systemctl restart screener-backend

# --- Reload nginx ---
echo "Reloading nginx..."
sudo nginx -t && sudo systemctl reload nginx

echo "$(date '+%Y-%m-%d %H:%M:%S') === Deployment complete ==="
