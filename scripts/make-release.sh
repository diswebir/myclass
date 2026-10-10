#!/usr/bin/env bash
# Builds a host-uploadable release: compiled dist/, runtime-only node_modules (pure JS),
# migrations, standalone schema-mysql.sql / schema-sqlite.sql, and a ZIP. Requires Node.js and npm on the build machine only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
NAME="myclass-${VERSION}"
STAGE="release/${NAME}"

npm run build
rm -rf "release" && mkdir -p "$STAGE"
cp app.js package.json package-lock.json .env.example README.md "$STAGE/"
cp -r migrations public docs "$STAGE/"
mkdir -p "$STAGE/dist" && cp -r dist/. "$STAGE/dist/" && rm -rf "$STAGE/dist/tests"
mkdir -p "$STAGE/database"
# One standalone schema per engine, containing exactly the statements the web installer applies, in order.
for engine in mysql sqlite; do
  { echo "-- myclass ${VERSION}: standalone ${engine} schema (same statements as the web installer applies, in order)"; cat "migrations/${engine}"/*.sql; } > "$STAGE/database/schema-${engine}.sql"
done
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
(cd release && python3 - "$NAME" <<'PY'
import os, sys, zipfile
name = sys.argv[1]
out = f"{name}.zip"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(name):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, p)
print(out, os.path.getsize(out), "bytes")
PY
)
echo "release/${NAME}.zip ready"
