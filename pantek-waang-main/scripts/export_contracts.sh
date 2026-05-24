#!/usr/bin/env bash
# Export frontend-facing contracts from this repo.
#
# Refreshes:
#   - contracts/openapi.json (REST spec)
#   - contracts/types/snapshot.ts (manual reconcile flag)
#
# Run from repo root:
#   bash scripts/export_contracts.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Generating OpenAPI spec from FastAPI app"
cd backend
APP_TESTING=1 python -c "
import json, sys
sys.path.insert(0, '.')
from app.main import app
with open('../contracts/openapi.json', 'w') as f:
    json.dump(app.openapi(), f, indent=2, default=str)
print('OK -> contracts/openapi.json')
"
cd ..

echo "==> Reminder: contracts/types/snapshot.ts is hand-written."
echo "    Diff against backend payload changes manually when shapes drift."

echo "==> Done. Frontend repo can now sync via:"
echo "    rsync -av contracts/ ../flowgreeks-frontend/contracts/"
