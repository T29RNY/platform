#!/bin/bash
# scripts/check-workspace-deps.sh
# Validates every @platform/* dependency declared in any apps/* or
# packages/* package.json maps to a real packages/<name>/package.json
# with a matching `name` field.
#
# Catches the bug class: listing a Vite alias (or any non-existent
# workspace package) as if it were a real dep. That breaks Vercel's
# npm install in a clean container even though local builds pass
# (Vite resolves aliases at build time, never touching node_modules).
#
# Exit code: 0 = all valid, 1 = one or more invalid declarations.
# Usage: bash skills/scripts/check-workspace-deps.sh

ROOT=$(git rev-parse --show-toplevel)
FAILS=0

echo "--- WORKSPACE DEP CHECK ---"

PKG_FILES=$(find "$ROOT/apps" "$ROOT/packages" -name package.json -not -path "*/node_modules/*" 2>/dev/null)

for pkg in $PKG_FILES; do
  REL=${pkg#$ROOT/}

  DEPS=$(jq -r '
    ((.dependencies // {}) + (.devDependencies // {}) + (.peerDependencies // {}))
    | to_entries
    | .[]
    | select(.key | startswith("@platform/"))
    | .key
  ' "$pkg" 2>/dev/null)

  for dep in $DEPS; do
    short=${dep#@platform/}
    target="$ROOT/packages/$short/package.json"

    if [ ! -f "$target" ]; then
      echo "FAIL: $REL declares \"$dep\" but $ROOT/packages/$short/ does not exist."
      echo "      $dep is probably a Vite alias, not a real workspace package."
      echo "      Either create packages/$short/ as a real workspace, OR remove"
      echo "      the dep from package.json and import via the alias only."
      FAILS=$((FAILS + 1))
      continue
    fi

    actual=$(jq -r '.name // ""' "$target")
    if [ "$actual" != "$dep" ]; then
      echo "FAIL: $REL declares \"$dep\""
      echo "      but $target has name=\"$actual\""
      FAILS=$((FAILS + 1))
    fi
  done
done

if [ $FAILS -eq 0 ]; then
  echo "PASS — all @platform/* deps resolve to real workspace packages."
  exit 0
fi

echo ""
echo "$FAILS workspace dependency error(s) found."
echo "These will break npm install in any fresh container (e.g. Vercel CI)."
exit 1
