#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -d .venv ]]; then
  echo "❌ .venv not found. Run:"
  echo "   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

if [[ -f .env ]]; then
  set -a; source .env; set +a
else
  echo "⚠️  .env not found — relying on environment variables"
fi

PORT="${PORT:-5029}"
echo "🚀 Starting Polisense Python backend (dev) on port $PORT..."
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --reload
