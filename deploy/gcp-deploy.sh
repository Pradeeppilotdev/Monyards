#!/bin/bash
# GCP deploy script — paste this into the VPS after SSH'ing in.
# Installs Node 22, clones the repo, builds, and starts with PM2.
set -e

echo "=== Installing Node 22 ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

echo "=== Installing PM2 ==="
npm install -g pm2
pm2 startup systemd -u $USER --hp $HOME | tail -1

echo "=== Cloning repo ==="
cd ~
git clone https://github.com/YOUR_GITHUB_USER/IDnad.git 2>/dev/null || true
cd IDnad

echo "=== Installing dependencies ==="
cd animation && npm ci && npm run build
cd ../mint && npm ci && npm run build
cd ../server && npm ci

echo "=== Copying env ==="
cp .env.example .env 2>/dev/null || true
echo ""
echo ">>> EDIT server/.env with your values:"
echo "    PINATA_JWT=..."
echo "    CONTRACT_ADDRESS=0xdfcfe6ca511d80e83f1b27680f738c2ee4372e3e"
echo "    PUBLIC_URL=https://cards.pradeeppilot.xyz"
echo "    PORT=8787"
echo ""
read -p "Press Enter after editing .env..."

echo "=== Starting server ==="
pm2 start index.js --name lanyard-server
pm2 save

echo "=== Done ==="
echo "Server running on port 8787"
echo "Point Cloudflare A record to this VPS IP"
