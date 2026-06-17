// lastContext — the single, context-aware "where to resume" store for the
// multi-context nav epic (Phase 1).
//
// Why this exists: the legacy `ioo_last_visited` breadcrumb is only written on
// squad routes (/p, /admin), so a multi-context user who was last on /sessions,
// /m/<pass> or /parent-home would, on reopen, be sent back to their last *squad*
// — a dormant context, the exact outcome the locked plan's cross-cutting decision
// #1 set out to avoid. This store is written on EVERY resumable context route, so
// recency is honest across squads, clubs and the guardian home.
//
// It deliberately stores the full canonical path (incl. query — e.g.
// `/sessions?club=<id>`), so resume lands on the exact context, not just the
// surface. `ioo_last_visited` is left intact (it backs the iOS fresh-install
// redirect bridge + InviteResolve/PWAWelcome) and is read as a fallback for users
// who predate this key.

const KEY = "ioo_last_context";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — same horizon as the redirect bridge

// Persist the current context as the resume point. `path` should be an in-app
// path beginning with "/" (pathname + search). No-ops safely in private mode.
export function writeLastContext(path) {
  if (typeof window === "undefined") return;
  if (typeof path !== "string" || !path.startsWith("/")) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, ts: Date.now() }));
  } catch { /* localStorage unavailable (Safari private mode) — non-fatal */ }
}

// Read the resume path if present and still fresh, else null. Validates the
// stored shape so a corrupt/legacy value can never throw or redirect off-site.
export function readLastContext() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { path, ts } = JSON.parse(raw);
    if (typeof path !== "string" || !path.startsWith("/")) return null;
    if (typeof ts !== "number" || Date.now() - ts > MAX_AGE_MS) return null;
    return path;
  } catch {
    return null;
  }
}
