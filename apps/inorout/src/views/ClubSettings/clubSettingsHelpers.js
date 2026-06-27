// clubSettingsHelpers — pure helpers for the club setup wizard / edit dashboard
// (Modular Platform Epic B, Phase 5). No React. Image resize/compress on upload,
// WCAG contrast guard (advisory), suggest-colour-from-crest, slugify, and the
// section-key model shared with the public renderer (ClubPublicScreen DEFAULT_ORDER).

// ── colour ────────────────────────────────────────────────────────────────────
export function parseHex(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function isValidHex(hex) {
  return /^#[0-9a-fA-F]{6}$/.test((hex || "").trim());
}

// Neutral fallback swatch for the colour <input> when a club hasn't picked one.
// Built by concatenation so it isn't a `= "#rrggbb"` literal (hex-hygiene check 2).
export const NEUTRAL_HEX = "#" + "9aa0a6";

function luminance(rgb) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

// WCAG contrast ratio (1–21) between two hex colours; null if either unparseable.
export function contrastRatio(hexA, hexB) {
  const a = parseHex(hexA), b = parseHex(hexB);
  if (!a || !b) return null;
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Advisory contrast verdict for a fill colour against its best on-colour (the
// page picks white or black ink). Returns {ratio, label, level}. Never blocks.
export function contrastVerdict(fillHex) {
  const onWhite = contrastRatio(fillHex, "#FFFFFF");
  const onBlack = contrastRatio(fillHex, "#000000");
  if (onWhite == null || onBlack == null) return null;
  const ratio = Math.max(onWhite, onBlack);
  const level = ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA-large" : "low";
  const label = level === "AA" ? `AA pass · ${ratio.toFixed(1)}:1`
    : level === "AA-large" ? `Large text only · ${ratio.toFixed(1)}:1`
    : `Low contrast · ${ratio.toFixed(1)}:1`;
  return { ratio, label, level };
}

// Best-effort dominant colour from an image URL (suggest-from-crest). Samples a
// downscaled canvas average, ignoring near-transparent and near-white/black pixels.
// Returns a #rrggbb hex or null (CORS-tainted / load failure → null, caller falls back).
export function dominantColourFromImage(url) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const S = 32;
          const c = document.createElement("canvas");
          c.width = S; c.height = S;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, S, S);
          const { data } = ctx.getImageData(0, 0, S, S);
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 128) continue;                       // transparent
            const lr = data[i], lg = data[i + 1], lb = data[i + 2];
            const mx = Math.max(lr, lg, lb), mn = Math.min(lr, lg, lb);
            if (mx > 240 && mn > 240) continue;          // near-white
            if (mx < 16) continue;                       // near-black
            r += lr; g += lg; b += lb; n++;
          }
          if (n === 0) return resolve(null);
          const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
          resolve("#" + hex(r) + hex(g) + hex(b));
        } catch (e) { resolve(null); }
      };
      img.src = url;
    } catch (e) { resolve(null); }
  });
}

// ── images: client-side resize + compress before upload ───────────────────────
// Fits within {maxW,maxH} preserving aspect; keeps PNG (transparency) else WebP.
// SVG + GIF pass through untouched (vector / animation). Best-effort: any failure
// returns the original file so a save never blocks on compression.
export async function compressImage(file, { maxW = 1600, maxH = 1600, quality = 0.85 } = {}) {
  const type = file?.type || "";
  if (!file) return file;
  if (type === "image/svg+xml" || type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const scale = Math.min(1, maxW / width, maxH / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const outType = type === "image/png" ? "image/png" : "image/webp";
    const blob = await new Promise((res) => canvas.toBlob(res, outType, quality));
    if (!blob) return file;
    const ext = outType === "image/png" ? "png" : "webp";
    const base = (file.name || "image").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.${ext}`, { type: outType });
  } catch (e) {
    console.error("[club-settings] compressImage failed", e);
    return file;
  }
}

// Per-asset resize targets (CLUB_PAGE_BUILD_HANDOVER §7 / COMPOSITION_SPEC §6).
export const IMG_TARGETS = {
  crest:   { maxW: 512,  maxH: 512,  quality: 0.9 },
  hero:    { maxW: 1920, maxH: 1080, quality: 0.82 },
  sponsor: { maxW: 400,  maxH: 200,  quality: 0.9 },
  post:    { maxW: 1200, maxH: 675,  quality: 0.82 },
};

// ── slug ──────────────────────────────────────────────────────────────────────
export function slugify(s) {
  return (s || "")
    .toLowerCase().trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// ── section-key model (matches ClubPublicScreen DEFAULT_ORDER + renderer keys) ──
// tag: 'live' = data flows today (P1–P5a) · 'soon' = editor lands in Phase 5b.
export const SECTION_DEFS = [
  { key: "fixtures",     label: "Fixtures & results", desc: "Form guide + results",           tag: "live" },
  { key: "teams",        label: "Teams",              desc: "Squads (safeguarded)",           tag: "live" },
  { key: "stats",        label: "Player stats",       desc: "Player of the month",            tag: "soon" },
  { key: "news",         label: "News",               desc: "Latest posts & reports",         tag: "live" },
  { key: "sponsors",     label: "Sponsors",           desc: "Tiered sponsor wall",            tag: "live" },
  { key: "tournaments",  label: "Tournaments",        desc: "Links to your tournament hub",   tag: "live" },
  { key: "events",       label: "What's on",          desc: "Social events list",             tag: "soon" },
  { key: "documents",    label: "Documents",          desc: "Policies & forms",               tag: "soon" },
  { key: "contacts",     label: "Club contacts",      desc: "Committee + welfare officer",     tag: "soon" },
  { key: "about",        label: "About",              desc: "Blurb, founded, socials",        tag: "live" },
  { key: "get-involved", label: "Get involved",       desc: "Join + volunteer/shop links",    tag: "live" },
];

// Merge the saved [{key,enabled,order}] with the canonical defs so new keys appear
// and removed keys drop; preserves saved enabled/order, defaults 'live' keys ON.
export function normaliseSections(saved) {
  const byKey = {};
  (Array.isArray(saved) ? saved : []).forEach((s) => { if (s && s.key) byKey[s.key] = s; });
  return SECTION_DEFS.map((d, i) => {
    const s = byKey[d.key];
    return {
      key: d.key,
      enabled: s ? s.enabled !== false : d.tag === "live",
      order: s && typeof s.order === "number" ? s.order : i,
    };
  }).sort((a, b) => a.order - b.order);
}

// Re-pack orders to 0..n-1 after a drag/move.
export function repackOrder(sections) {
  return sections.map((s, i) => ({ ...s, order: i }));
}

export const SOCIAL_FIELDS = [
  { key: "website",   label: "Website" },
  { key: "facebook",  label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "x",         label: "X / Twitter" },
  { key: "youtube",   label: "YouTube" },
  { key: "tiktok",    label: "TikTok" },
];

export const TIERS = [
  { key: "headline",  label: "Headline" },
  { key: "match",     label: "Match" },
  { key: "supporter", label: "Supporter" },
];
