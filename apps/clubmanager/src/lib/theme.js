// Pure per-tenant theming helpers.
// Copied verbatim from apps/inorout/src/views/ClubPublic/clubPublicHelpers.js
// (Decision 6 — reuse the public-page white-label pattern). No React, no DB:
// turns a club branding record into the scoped --cp-* CSS vars the console
// container carries. Keep aligned with the inorout source if it changes.

// Parse a #rgb / #rrggbb string to {r,g,b} (0–255), or null if unparseable.
function parseHex(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// WCAG relative luminance (0 dark → 1 light).
function luminance(rgb) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

// Pick readable text token for a fill colour — ink on pale brands, white on dark.
// Returns a CSS var() reference (never a hex literal) so theming stays token-based.
export function onColour(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return "var(--white)";
  return luminance(rgb) > 0.6 ? "var(--black)" : "var(--white)";
}

// Build the per-club CSS custom properties injected on the console container.
// Missing colours fall back to the stylesheet defaults (gold), so a zero-config
// club still themes deliberately. accent defaults to primary.
export function themeVars(branding) {
  const b = branding || {};
  const vars = {};
  if (b.primary_colour)   vars["--cp-primary"]   = b.primary_colour;
  if (b.secondary_colour) vars["--cp-secondary"] = b.secondary_colour;
  vars["--cp-accent"]     = b.accent_colour || b.primary_colour || "var(--gold)";
  vars["--cp-on-accent"]  = onColour(b.accent_colour || b.primary_colour);
  return vars;
}

// Crest "initials" from a club short_name / name for the placeholder crest.
export function crestText(club) {
  if (!club) return "?";
  if (club.short_name) return club.short_name.slice(0, 3).toUpperCase();
  const name = (club.name || "").trim();
  if (!name) return "?";
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
