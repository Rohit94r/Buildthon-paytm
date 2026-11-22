#!/usr/bin/env bash
# Update a running LayerFlow VPS to the latest code (≈20–60 s of downtime for api/web).
#   bash scripts/vps/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f docker-compose.yml"

echo "==> backup before update"
bash scripts/backup.sh || echo "   (backup failed — continuing; check scripts/backup.sh output)"

echo "==> git pull"
git pull --ff-only

echo "==> rebuild images"
$COMPOSE build api web

echo "==> restart (the api container runs migrations on start)"
$COMPOSE up -d --remove-orphans

for i in $(seq 1 40); do
  if $COMPOSE exec -T api python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health',timeout=5)" >/dev/null 2>&1; then
    echo "==> healthy"; $COMPOSE ps; exit 0
  fi
  sleep 3
done
echo "API not healthy after update — check: $COMPOSE logs --tail 200 api" >&2
exit 1
