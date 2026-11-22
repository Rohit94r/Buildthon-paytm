#!/usr/bin/env bash
# Pull the models named in .env into the Ollama container, then warm them up so the first chat is instant.
#   bash scripts/vps/pull-models.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
set -a; source .env; set +a
COMPOSE="docker compose -f docker-compose.yml"

MODELS=("${MODEL_FAST:-qwen2.5:3b-instruct}" "${MODEL_WRITER:-qwen2.5:7b-instruct}" "${MODEL_EMBED:-nomic-embed-text}")
# Optional vision model for image alt text
[ -n "${MODEL_VISION:-}" ] && MODELS+=("$MODEL_VISION")

for m in "${MODELS[@]}"; do
  echo "==> pulling $m"
  $COMPOSE exec -T ollama ollama pull "$m"
done

echo "==> warming up chat + writer models"
for m in "${MODEL_FAST:-qwen2.5:3b-instruct}" "${MODEL_WRITER:-qwen2.5:7b-instruct}"; do
  $COMPOSE exec -T ollama ollama run "$m" "Reply with OK." >/dev/null 2>&1 || true
done

$COMPOSE exec -T ollama ollama ps
echo "Models ready. Measure real speed with: docker compose exec api python /srv/layerflow/scripts/bench_model.py"
