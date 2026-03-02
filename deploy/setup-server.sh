#!/bin/bash
set -euo pipefail

# ============================================================
# Server Setup Script for Strategy Screener
# Run this ONCE on a fresh Ubuntu/Debian server
# Usage: sudo bash setup-server.sh
# ============================================================

echo "=== Strategy Screener Server Setup ==="

# --- System packages ---
apt-get update
apt-get install -y \
  postgresql postgresql-contrib \
  python3 python3-pip python3-venv \
  nodejs npm \
  nginx certbot python3-certbot-nginx \
  git curl wget unzip htop

# Upgrade npm and install n for node version management
npm install -g n
n lts
hash -r

# --- PostgreSQL setup ---
echo "=== Setting up PostgreSQL ==="
sudo -u postgres psql -c "CREATE USER market_user WITH PASSWORD 'market_pass';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE market OWNER market_user;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE market TO market_user;" 2>/dev/null || true

# --- Create app user ---
echo "=== Creating app user ==="
id -u screener &>/dev/null || useradd -m -s /bin/bash screener

# --- Create app directories ---
echo "=== Creating directories ==="
mkdir -p /opt/strategy-screener
mkdir -p /opt/data-store
mkdir -p /var/log/screener
chown -R screener:screener /opt/strategy-screener /opt/data-store /var/log/screener

# --- Python venv for backend ---
echo "=== Setting up Python virtual environment ==="
sudo -u screener python3 -m venv /opt/strategy-screener/venv

# --- Install systemd services ---
echo "=== Installing systemd services ==="
cp /opt/strategy-screener/deploy/screener-backend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable screener-backend

# --- Install cron jobs ---
echo "=== Installing cron jobs ==="
cp /opt/strategy-screener/deploy/screener-cron /etc/cron.d/screener-cron
chmod 644 /etc/cron.d/screener-cron

# --- Nginx config ---
echo "=== Configuring Nginx ==="
cp /opt/strategy-screener/deploy/nginx-screener.conf /etc/nginx/sites-available/screener
ln -sf /etc/nginx/sites-available/screener /etc/nginx/sites-enabled/screener
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "=== Setup Complete ==="
echo "Next steps:"
echo "  1. Deploy the app: bash /opt/strategy-screener/deploy/deploy.sh"
echo "  2. Set up SSL: sudo certbot --nginx -d yourdomain.com"
echo "  3. Update DNS: Point your domain A record to this server's IP"
echo "  4. Copy fyers_access_token.txt to /opt/data-store/"
