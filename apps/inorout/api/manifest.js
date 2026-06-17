// /api/manifest.js — personalised PWA manifest for admin installs.
//
// CRITICAL — Public install helper for iOS/Android PWAs. Keep MINIMAL.
// Rules baked in to avoid accidental scope creep:
// - NO database lookup (do not validate token against teams; regex format only)
// - NO token logging (do not log query strings — admin tokens are bearer credentials)
// - NO redirects (serve JSON only)
// - NO caching (Cache-Control: no-store, CDN-Cache-Control: no-store)
// - ONLY emits start_url: /admin/<validatedToken> OR start_url: /
// If you change any of these, see apps/inorout/src/onboarding/steps/SquadReady.jsx
// and the plan at /Users/tarny/.claude/plans/rippling-meandering-dahl.md
//
// Why this exists:
// iOS Safari "Add to Home Screen" installs a PWA whose launch URL is the
// manifest's start_url at install time. The static /manifest.json has
// start_url: "/" — fine for unauthenticated landing but wrong for admins
// who just created a team. Per-install personalisation here means iOS
// bakes /admin/<token> into the home-screen icon. localStorage breadcrumbs
// don't survive the Safari→PWA storage boundary on iOS, so this manifest
// swap is the only reliable path.

const ADMIN_TOKEN_RE  = /^admin_[A-Za-z0-9_-]+$/;
const PLAYER_TOKEN_RE = /^p_[A-Za-z0-9_-]+$/;
const BASE_URL = "https://www.in-or-out.com";

module.exports = function handler(req, res) {
  const adminParam  = typeof req.query?.admin  === "string" ? req.query.admin  : null;
  const playerParam = typeof req.query?.player === "string" ? req.query.player : null;

  // Multi-context nav (Phase 1): non-squad users (guardians / club-only members)
  // have no squad token, so ?feed=1 makes /feed the installable home. start_url
  // stays domain-relative — it inherits BASE_URL's host automatically, so this
  // works on www.in-or-out.com today and app.in-or-out.com after the domain move.
  const feedParam = typeof req.query?.feed === "string" ? req.query.feed : null;

  // Admin takes precedence over player if (somehow) both are passed.
  // Invalid / missing → safe default of "/".
  let startUrl = "/";
  if (adminParam && ADMIN_TOKEN_RE.test(adminParam)) {
    startUrl = `/admin/${adminParam}`;
  } else if (playerParam && PLAYER_TOKEN_RE.test(playerParam)) {
    startUrl = `/p/${playerParam}`;
  } else if (feedParam === "1" || feedParam === "true") {
    startUrl = "/feed";
  }

  const manifest = {
    name: "In or Out",
    short_name: "In or Out",
    description: "The fastest way to organise your weekly football game",
    start_url: startUrl,
    display: "standalone",
    background_color: "#0A0A08",
    theme_color: "#0A0A08",
    orientation: "portrait",
    scope: "/",
    icons: [
      { src: `${BASE_URL}/icons/favicon-96x96.png`,            sizes: "96x96",   type: "image/png" },
      { src: `${BASE_URL}/icons/apple-touch-icon.png`,         sizes: "180x180", type: "image/png" },
      { src: `${BASE_URL}/icons/web-app-manifest-192x192.png`, sizes: "192x192", type: "image/png" },
      { src: `${BASE_URL}/icons/web-app-manifest-512x512.png`, sizes: "512x512", type: "image/png" },
    ],
    categories: ["sports", "utilities"],
  };

  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.status(200).send(JSON.stringify(manifest));
};
