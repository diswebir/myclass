#!/usr/bin/env bash
# Live HTTP checks against a running myclass instance.
# Usage: scripts/e2e-http.sh <base_url> <mode: pre-install|post-install>
# Prints one line per check: PASS/FAIL, method, path, status, expectation. Exits non-zero on any FAIL.
set -u
BASE="$1"; MODE="$2"
JAR="$(mktemp)"; PASS=0; FAIL=0
check() { # name, actual, expected(regex)
  if [[ "$2" =~ ^($3)$ ]]; then PASS=$((PASS+1)); echo "PASS  $1 => $2"; else FAIL=$((FAIL+1)); echo "FAIL  $1 => $2 (expected $3)"; fi
}
code() { curl -s -m 10 -o "${OUT:-/dev/null}" -w "%{http_code}" "$@"; }
loc()  { curl -s -m 10 -o /dev/null -w "%{redirect_url}" "$@"; }

if [ "$MODE" = "pre-install" ]; then
  OUT=/tmp/e2e_body; check "GET /install renders installer" "$(code "$BASE/install")" 200
  check "installer is RTL Persian" "$(curl -s -m 10 "$BASE/install" | grep -c 'lang="fa" dir="rtl"')" "[1-9][0-9]*"
  check "GET /login redirects to installer" "$(code "$BASE/login")" 302
  check "  ...to /install" "$(loc "$BASE/login" | sed 's#.*/install$#/install#')" "/install"
  check "GET /admin redirects to installer" "$(code "$BASE/admin")" 302
  check "POST /install without CSRF rejected" "$(code -X POST -d 'x=1' "$BASE/install")" 403
  check "GET /health (DB down) is 503" "$(code "$BASE/health")" 503
  check "GET /assets/app.css" "$(code "$BASE/assets/app.css")" 200
  check "static traversal not served" "$(code --path-as-is "$BASE/assets/../../package.json")" "302|404"
  # Before installation every unknown path is sent to the installer (design: no pre-install route map leaks).
  check "unknown path before install -> installer" "$(code "$BASE/no-such-page")" 302
fi

if [ "$MODE" = "post-install" ]; then
  OUT=/tmp/e2e_body
  check "GET /install after install is 404" "$(code "$BASE/install")" 404
  # CSRF middleware runs before the installed-check, so a tokenless POST gets 403 (no information about install state).
  check "POST /install after install rejected" "$(code -X POST -d 'x=1' "$BASE/install")" "403|404"
  check "GET /login renders" "$(code -c "$JAR" "$BASE/login")" 200
  check "login page is RTL Persian" "$(curl -s -m 10 "$BASE/login" | grep -c 'lang="fa" dir="rtl"')" "[1-9][0-9]*"
  check "login sets csrf cookie" "$(grep -c csrf "$JAR")" "[1-9][0-9]*"
  check "POST /login without CSRF rejected" "$(code -X POST -d 'username=a&password=b' "$BASE/login")" 403
  CSRF="$(awk '/csrf/{print $7}' "$JAR" | tail -1)"
  check "POST /login with wrong CSRF rejected" "$(code -b "$JAR" -X POST -d '_csrf=bad&username=a&password=b' "$BASE/login")" 403
  for p in /admin /admin/users /admin/users/new /admin/users/1 /admin/roles /admin/roles/new /admin/roles/1 \
           /admin/settings/institute /admin/audit /admin/system/health /account/password; do
    check "anon GET $p" "$(code "$BASE$p")" 302
    check "  -> /login" "$(loc "$BASE$p" | sed 's#.*/login.*#/login#')" "/login"
  done
  for p in /admin/users /admin/roles /admin/settings/institute /admin/system/migrate /admin/users/1/status /logout /account/password; do
    check "anon POST $p without CSRF" "$(code -X POST -d 'x=1' "$BASE$p")" "403|302"
  done
  check "API without auth returns JSON 401" "$(code -H 'Accept: application/json' "$BASE/api/health")" 401
  check "GET /health public minimal" "$(code "$BASE/health")" "200|503"
  check "unknown path 404 after install" "$(code "$BASE/no-such-page")" 404
  H="$(curl -s -m 10 -D - -o /dev/null "$BASE/login")"
  check "CSP present and no unsafe-inline" "$(echo "$H" | grep -ci 'content-security-policy')" "[1-9][0-9]*"
  check "CSP forbids unsafe-inline" "$(echo "$H" | grep -ci 'unsafe-inline')" 0
  check "X-Powered-By hidden" "$(echo "$H" | grep -ci 'x-powered-by')" 0
  check "X-Content-Type-Options nosniff" "$(echo "$H" | grep -ci 'x-content-type-options: nosniff')" 1
  LEAK="$(curl -s -m 10 -b "$JAR" -X POST -d "_csrf=$CSRF&username=a&password=b" "$BASE/login" | grep -ciE 'at [A-Za-z.]+ \(|ECONNREFUSED|ER_ACCESS|stack|mysql')"
  check "failed login (DB down) leaks no driver or stack text" "$LEAK" 0
  check "failed login (DB down) -> 503 Persian page" "$(code -b "$JAR" -X POST -d "_csrf=$CSRF&username=a&password=b" "$BASE/login")" 503
fi

rm -f "$JAR"
echo "SUMMARY mode=$MODE pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
