#!/bin/sh
# One command to run on the host: install if needed, preflight, start.
#   ./scripts/run.sh          (then open http://localhost:6171/)
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
npm run doctor
exec npm start
