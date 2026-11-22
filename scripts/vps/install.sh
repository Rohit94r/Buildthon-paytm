#!/usr/bin/env bash
# LayerFlow — one-command install on a fresh Ubuntu 22.04/24.04 VPS (tested target: Hostinger KVM 8).
#
#   ssh root@YOUR_VPS_IP
#   git clone https://github.com/Rohit94r/Layerflow-agents.git /opt/layerflow
#   cd /opt/layerflow && sudo bash scripts/vps/install.sh
#
# What it does (safe to re-run):
#   1. firewall (22/80/443), 8 GB swap, unattended security updates
#   2. Docker Engine + Compose plugin
#   3. .env with generated secrets (asks for domain + admin login once)
#   4. builds and starts the stack, pulls the models, seeds demo workspaces (optional)
#   5. systemd units: start on boot + daily backup at 02:00
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

say()  { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash scripts/vps/install.sh"
command -v apt-get >/dev/null || die "This script supports Ubuntu/Debian only."

# ---------------------------------------------------------------- 1. host --
say "Host hardening"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw openssl unattended-upgrades >/dev/null
ufw allow 22/tcp >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ok "firewall: 22, 80, 443 open"

if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-layerflow.conf
  ok "8 GB swap enabled (safety net for model loads)"
else
  ok "swap already configured"
fi

# -------------------------------------------------------------- 2. docker --
say "Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null
docker compose version >/dev/null || die "Docker Compose plugin missing"
ok "$(docker --version)"

# ---------------------------------------------------------------- 3. .env --
say "Configuration (.env)"
if [[ ! -f .env ]]; then
  cp .env.example .env
  read -r -p "   Domain for LayerFlow (e.g. agents.yourcompany.com): " DOMAIN
  read -r -p "   Admin email: " ADMIN_EMAIL
  read -r -s -p "   Admin password (10+ chars): " ADMIN_PASSWORD; echo
  [[ ${#ADMIN_PASSWORD} -ge 10 ]] || die "Password must be at least 10 characters"
  [[ "$ADMIN_PASSWORD" != *"'"* ]] || die "Password must not contain a single quote (')"
  # Escape sed replacement metacharacters so any value is written literally.
  set_env() { local v; v=$(printf '%s' "$2" | sed -e 's/[\\|&]/\\&/g'); sed -i "s|^$1=.*|$1=$v|" .env; }
  set_env DOMAIN "$DOMAIN"
  set_env APP_BASE_URL "https://$DOMAIN"
  set_env ADMIN_EMAIL "$ADMIN_EMAIL"
  # single quotes: no $-interpolation by docker compose or bash
  set_env ADMIN_PASSWORD "'$ADMIN_PASSWORD'"
  set_env APP_SECRET_KEY "$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-64)"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  # Fernet key = 32 random bytes, urlsafe base64
  set_env TOKEN_ENCRYPTION_KEY "$(openssl rand -base64 32 | tr '+/' '-_')"
  set_env FETCH_USER_AGENT "\"LayerFlowBot/1.0 (+https://$DOMAIN/bot; $ADMIN_EMAIL)\""
  chmod 600 .env
  ok ".env created (secrets generated, file mode 600)"
else
  ok ".env exists — keeping it"
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

# The dev override exposes ports + hot reload; never use it on the VPS.
COMPOSE="docker compose -f docker-compose.yml"

# --------------------------------------------------------------- 4. stack --
say "Building and starting LayerFlow (first build takes 5–10 minutes)"
$COMPOSE up -d --build
ok "containers started"

say "Waiting for the API to become healthy"
for i in $(seq 1 60); do
  if $COMPOSE exec -T api python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health',timeout=5)" >/dev/null 2>&1; then
    ok "API healthy"; break
  fi
  sleep 5
  [[ $i -eq 60 ]] && die "API did not become healthy. Check: $COMPOSE logs api"
done

if [[ "${COMPOSE_PROFILES:-}" == *local-model* ]]; then
  bash "$ROOT/scripts/vps/pull-models.sh"
else
  warn "COMPOSE_PROFILES has no local-model: using the remote model at ${OLLAMA_BASE_URL}"
fi

read -r -p "   Create the two demo client workspaces (MarketPulse news + CollegeCompass)? [y/N] " SEED
if [[ "${SEED,,}" == "y" ]]; then
  $COMPOSE exec -T api python -m app.cli seed-demo-platform && ok "demo workspaces created"
fi

# ------------------------------------------------------------- 5. systemd --
say "Start on boot + daily backups"
cp infra/systemd/layerflow.service infra/systemd/layerflow-backup.service infra/systemd/layerflow-backup.timer /etc/systemd/system/
sed -i "s|/opt/layerflow|$ROOT|g" /etc/systemd/system/layerflow.service /etc/systemd/system/layerflow-backup.service
chmod +x scripts/*.sh scripts/vps/*.sh
systemctl daemon-reload
systemctl enable layerflow.service >/dev/null
systemctl enable --now layerflow-backup.timer >/dev/null
ok "layerflow.service enabled, backup timer at 02:00"

say "Done"
cat <<EOF

   Dashboard:  https://${DOMAIN}
   Health:     https://${DOMAIN}/api/v1/health
   Login:      ${ADMIN_EMAIL:-<ADMIN_EMAIL in .env>}

   DNS: make sure an A record for ${DOMAIN} points to this server's IP — Caddy gets the TLS certificate
   automatically on the first HTTPS request.

   Useful:
     docker compose -f docker-compose.yml ps
     docker compose -f docker-compose.yml logs -f worker
     bash scripts/vps/update.sh          # pull new code + rebuild + migrate
     docker compose -f docker-compose.yml exec api python /srv/layerflow/scripts/bench_model.py   # real tokens/sec
EOF
