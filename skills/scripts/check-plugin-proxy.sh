#!/bin/bash
# scripts/check-plugin-proxy.sh
# Deterministic guard against the Capacitor thenable-await footgun (PR #278).
#
# registerPlugin("Name") from @capacitor/core returns a Proxy whose get-handler
# returns a function for ANY property — INCLUDING `.then`. That makes the proxy
# accidentally "thenable". If you `await` the bare proxy, or return it out of an
# `async` function (which does Promise.resolve(proxy) → proxy.then(resolve,reject)),
# JS runs thenable-assimilation: the proxy treats `.then` as a native plugin method,
# throws "<Name>.then() is not implemented", and NEVER settles — the await HANGS
# FOREVER. That was the all-day "stuck on Requesting Health access…" hang (PR #278).
#
# THE RULE (see reference_capacitor_proxy_thenable_await_hang): a plugin-proxy
# resolver must be SYNCHRONOUS and returned un-awaited; call a METHOD on the proxy
# and await THAT (methods return real promises).
#
#   function plugin() { ...; return registerPlugin("Name"); }   // NOT async
#   const p = plugin();                 // NO await on the bare proxy
#   const r = await p.someMethod();     // await the METHOD result — fine
#
# WHAT THIS FLAGS (both halves of the footgun):
#   (A) an ASYNC resolver that returns a plugin proxy — `async` function/arrow whose
#       body does `return registerPlugin(` or `return <proxyVar>`, or an implicit
#       async arrow `async () => registerPlugin(`.
#   (B) an AWAIT of a plugin-proxy resolver — `await registerPlugin(`, a bare
#       `await <proxyVar>` (not a method call), or `await <resolver>()` (awaiting a
#       function that returns a proxy).
#
# WHAT IT DELIBERATELY IGNORES (the correct patterns + noise):
#   • `await <proxy>.method()`  — method-await is THE fix, never flagged (`.` follows).
#   • `await import(...)`        — dynamic import, not a proxy.
#   • synchronous `x = registerPlugin(...)` used locally — correct.
#   • // line comments and prose mentioning registerPlugin.
#
# Only files that reference `registerPlugin(` are inspected, so this is near-zero-cost
# and near-zero-false-positive. Called as CHECK 8 by check-hygiene.sh (so it fires on
# the per-edit PostToolUse hook and in the dev-loop proof gate) and runnable standalone.
#
# LIMITATION (accepted): resolver/proxy names are collected per-file, so a bare
# `await someResolver()` written in a DIFFERENT module from where the resolver is
# defined is not flagged. Module-local usage (the norm for these bridges) is covered.
#
# Usage: bash skills/scripts/check-plugin-proxy.sh [optional: path/to/file-or-dir]
# Exit code: 0 = clean, 1 = one or more violations.

ROOT=$(git rev-parse --show-toplevel)
TARGET="${1:-}"

if [ -n "$TARGET" ]; then
  SCAN_PATH="$ROOT/$TARGET"
else
  SCAN_PATH="$ROOT/apps/inorout/src $ROOT/packages/core"
fi

# Only .js/.jsx/.ts/.tsx files that actually call registerPlugin( are worth scanning.
FILES=$(grep -rlE "registerPlugin\(" $SCAN_PATH 2>/dev/null \
  | grep -E "\.(js|jsx|ts|tsx)$" \
  || true)

if [ -z "$FILES" ]; then
  echo "    PASS — no registerPlugin() callers in scope"
  exit 0
fi

VIOLATIONS=""
while IFS= read -r FILE; do
  [ -f "$FILE" ] || continue
  # Two passes over the same file: pass 1 collects proxy-var + resolver names,
  # pass 2 emits violations. Async-scope is tracked by a naive per-char brace scan.
  OUT=$(awk '
    function trim(s){ sub(/^[ \t]+/,"",s); sub(/[ \t]+$/,"",s); return s }
    function strip(s){ sub(/[ \t]*\/\/.*/,"",s); return s }   # naive // comment strip
    function hdrname(s,   n){
      if (match(s, /function[ \t]+[A-Za-z_$][A-Za-z0-9_$]*/)){
        n=substr(s,RSTART,RLENGTH); sub(/function[ \t]+/,"",n); return n }
      if (match(s, /(const|let|var)[ \t]+[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=/)){
        n=substr(s,RSTART,RLENGTH); sub(/(const|let|var)[ \t]+/,"",n); sub(/[ \t]*=.*/,"",n); return n }
      return ""
    }
    function curfn(   k){ for(k=sp;k>=1;k--) if(nameStack[k]!="") return nameStack[k]; return "" }
    # walk braces on a code line, maintaining name/async scope stacks
    function walk(code,  i,c,consumed){
      consumed=0
      for(i=1;i<=length(code);i++){
        c=substr(code,i,1)
        if(c=="{"){
          sp++
          if(isHeader && !consumed){ nameStack[sp]=hname; asyncStack[sp]=ahdr; if(ahdr)asyncOpen++; consumed=1 }
          else { nameStack[sp]=""; asyncStack[sp]=0 }
        } else if(c=="}"){
          if(sp>=1){ if(asyncStack[sp])asyncOpen--; delete nameStack[sp]; delete asyncStack[sp]; sp-- }
        }
      }
    }
    BEGIN{ sp=0; asyncOpen=0; pass= (ARGC>2)?1:1 }
    { rawline=$0; code=strip($0)
      isHeader = (code ~ /function[ \t]/ || code ~ /=>/)
      ahdr = isHeader && (code ~ /(^|[^A-Za-z0-9_$])async([^A-Za-z0-9_$]|$)/)
      hname = isHeader ? hdrname(code) : ""
      insideAsync = (asyncOpen > 0)
      enc = curfn()
    }
    # ---------- PASS 1 : collect proxy vars + resolver names ----------
    FNR==NR {
      # var assigned directly from registerPlugin()
      if (match(code, /[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=[ \t]*registerPlugin\(/)){
        pv=substr(code,RSTART,RLENGTH); sub(/[ \t]*=.*/,"",pv); sub(/^[ \t]+/,"",pv); proxyvar[pv]=1
      }
      # resolver: enclosing (or arrow-assigned) function returns a proxy
      if (code ~ /return[ \t]+registerPlugin\(/ && enc!="") resolver[enc]=1
      if (match(code, /return[ \t]+[A-Za-z_$][A-Za-z0-9_$]*/)){
        rv=substr(code,RSTART,RLENGTH); sub(/return[ \t]+/,"",rv); if((rv in proxyvar) && enc!="") resolver[enc]=1
      }
      # one-line body: header `{` and `return <proxy>` on the SAME physical line — the
      # brace scan hasnt opened the scope yet, so enc/insideAsync are stale here; key off
      # the header name directly so `function r(){ return registerPlugin("X") }` still
      # registers r as a resolver (and a later `await r()` fires).
      if (isHeader && hname!=""){
        if (code ~ /return[ \t]+registerPlugin\(/) resolver[hname]=1
        if (match(code, /return[ \t]+[A-Za-z_$][A-Za-z0-9_$]*/)){
          rv=substr(code,RSTART,RLENGTH); sub(/return[ \t]+/,"",rv); if(rv in proxyvar) resolver[hname]=1
        }
      }
      # implicit-return arrow assigned to NAME: const NAME = (async)? (...) => registerPlugin(
      if (code ~ /=>[ \t]*(await[ \t]+)?registerPlugin\(/ && hname!="") resolver[hname]=1
      walk(code); next
    }
    # ---------- PASS 2 : emit violations ----------
    {
      # (A) async resolver returns proxy — direct. `insideAsync` catches multi-line bodies
      # (scope opened on an earlier line); `ahdr` catches the one-line body case where the
      # async header `{` and the `return` share a physical line (scope not yet counted).
      if ((insideAsync || ahdr) && code ~ /return[ \t]+registerPlugin\(/)
        print FNR": [A] async function returns a registerPlugin() proxy — will hang on thenable-assimilation | "trim(rawline)
      # (A) async resolver returns a captured proxy var
      if ((insideAsync || ahdr) && match(code, /return[ \t]+[A-Za-z_$][A-Za-z0-9_$]*/)){
        rv=substr(code,RSTART,RLENGTH); sub(/return[ \t]+/,"",rv)
        if (rv in proxyvar)
          print FNR": [A] async function returns plugin-proxy var \""rv"\" — will hang on thenable-assimilation | "trim(rawline)
      }
      # (A) implicit-return async arrow: async (...) => registerPlugin(
      if (code ~ /async[^=]*=>[ \t]*(await[ \t]+)?registerPlugin\(/)
        print FNR": [A] async arrow returns a registerPlugin() proxy — will hang on thenable-assimilation | "trim(rawline)
      # (B) awaiting the proxy-producing call directly
      if (code ~ /await[ \t]+registerPlugin\(/)
        print FNR": [B] await of registerPlugin() — hangs forever; call a method and await THAT | "trim(rawline)
      # (B) bare await of a captured proxy var (NOT a method call: not followed by . or ( )
      if (match(code, /await[ \t]+[A-Za-z_$][A-Za-z0-9_$]*[^A-Za-z0-9_$.(]/) || match(code, /await[ \t]+[A-Za-z_$][A-Za-z0-9_$]*$/)){
        av=substr(code,RSTART,RLENGTH); sub(/await[ \t]+/,"",av); sub(/[^A-Za-z0-9_$].*$/,"",av)
        if (av in proxyvar)
          print FNR": [B] bare await of plugin-proxy var \""av"\" — hangs forever; await a method call instead | "trim(rawline)
      }
      # (B) awaiting a resolver call: await RESOLVER(
      if (match(code, /await[ \t]+[A-Za-z_$][A-Za-z0-9_$]*[ \t]*\(/)){
        rc=substr(code,RSTART,RLENGTH); sub(/await[ \t]+/,"",rc); sub(/[ \t]*\(.*$/,"",rc)
        if (rc in resolver)
          print FNR": [B] await of resolver \""rc"()\" which returns a bare proxy — hangs forever; do const p = "rc"(); await p.method() | "trim(rawline)
      }
      walk(code)
    }
  ' "$FILE" "$FILE")

  if [ -n "$OUT" ]; then
    REL="${FILE#$ROOT/}"
    while IFS= read -r L; do
      VIOLATIONS="$VIOLATIONS"$'\n'"    $REL:$L"
    done <<< "$OUT"
  fi
done <<< "$FILES"

if [ -z "$VIOLATIONS" ]; then
  echo "    PASS — no thenable-await plugin-proxy footguns"
  exit 0
else
  echo "    FAIL — Capacitor plugin-proxy thenable-await footgun (PR #278):"
  echo "$VIOLATIONS"
  echo "    Fix: keep the resolver SYNC + un-awaited; await a METHOD on the proxy, not the proxy."
  echo "    See reference_capacitor_proxy_thenable_await_hang / native-health.js healthPlugin()."
  exit 1
fi
