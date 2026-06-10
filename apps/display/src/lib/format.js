// Display formatting helpers — no DB, pure functions.

export const pad2 = (n) => String(n).padStart(2, "0");

export function formatClock(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDateLong(d) {
  return d
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    .toUpperCase();
}

// Live match minute from kickoff. serverOffsetMs aligns the device clock to the
// server clock (server_time − Date.now() at fetch) so timer drift is server-true.
export function matchMinute(kickoffIso, serverOffsetMs = 0) {
  if (!kickoffIso) return null;
  const ko = new Date(kickoffIso).getTime();
  const now = Date.now() + serverOffsetMs;
  const mins = Math.floor((now - ko) / 60000);
  if (!isFinite(mins) || mins < 0) return 0;
  return Math.min(mins, 130);
}

// Display minute with half-time hold (HANDOVER §11): when the latest
// period_change event is half_time, show "HT" instead of a running minute.
export function displayMinute(fixture, serverOffsetMs = 0) {
  const events = fixture?.recent_events || [];
  const lastPeriod = events.find((e) => e.type === "period_change");
  if (lastPeriod && lastPeriod.period === "half_time") return "HT";
  const m = matchMinute(fixture?.actual_kickoff_at, serverOffsetMs);
  return m == null ? "" : `${m}'`;
}

// "IN 43M" / "IN 1H 43M" / "FAR" countdown label for Coming-Up rows.
// kickoffTime = "HH:MM[:SS]" today (Europe/London comes from the server filter).
export function kickoffCountdown(kickoffTime, serverOffsetMs = 0) {
  if (!kickoffTime) return { label: "", imminent: false };
  const [hh, mm] = String(kickoffTime).split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return { label: "", imminent: false };
  const now = new Date(Date.now() + serverOffsetMs);
  const ko = new Date(now); ko.setHours(hh, mm, 0, 0);
  const mins = Math.round((ko.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return { label: "NOW", imminent: true };
  if (mins <= 60) return { label: `IN ${mins}M`, imminent: true };
  if (mins <= 180) return { label: `IN ${Math.floor(mins / 60)}H ${mins % 60}M`, imminent: false };
  return { label: "FAR", imminent: false };
}

export function timeShort(t) {
  // t = "HH:MM:SS" | "HH:MM"
  if (!t) return "";
  return String(t).slice(0, 5);
}

export const EVENT_GLYPH = {
  goal: "⚽",
  own_goal: "⚽",
  yellow_card: "🟨",
  red_card: "🟥",
  substitution: "🔁",
  period_change: "⏱",
};

export function eventLabel(ev) {
  const g = EVENT_GLYPH[ev?.type] || "•";
  const name = ev?.player_name || "";
  const og = ev?.type === "own_goal" ? " (OG)" : "";
  return { glyph: g, text: `${name}${og}`.trim() };
}

// Deterministic vivid fallback colour when a team has no primary_colour.
const PALETTE = ["#36e3a0", "#2f6bff", "#ff7a5a", "#ffcb45", "#c06bff", "#19c8e6", "#ff5d8f", "#6ee06a"];
export function teamColour(hex, seed = "") {
  if (hex && /^#?[0-9a-fA-F]{3,8}$/.test(hex)) return hex[0] === "#" ? hex : `#${hex}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Up to two-letter monogram for a generated crest. "Demo Athletic" → "DA",
// "Rovers" → "RO", "FC United" → "FU". Skips trivial words so "AFC Wimbledon"
// reads "AW" not "AF".
const SKIP = new Set(["fc", "afc", "the", "of", "and", "&", "united", "city", "town"]);
export function teamInitials(name = "") {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const meaty = words.filter((w) => !SKIP.has(w.toLowerCase()));
  const use = meaty.length ? meaty : words;
  if (use.length === 0) return "?";
  if (use.length === 1) return use[0].slice(0, 2).toUpperCase();
  return (use[0][0] + use[use.length - 1][0]).toUpperCase();
}

// Readable ink (#000 / #fff) for text sitting on a coloured crest fill.
export function contrastInk(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // perceived luminance
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#0a0d14" : "#ffffff";
}

export const DEFAULT_CONFIG = {
  zones: ["live_scores", "standings", "top_scorers", "goals_ticker"],
  mode: "smart",
  interval_secs: 15,
  custom_message: "",
};

export function resolveConfig(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  return {
    zones: Array.isArray(raw.zones) && raw.zones.length ? raw.zones : DEFAULT_CONFIG.zones,
    mode: ["fixed", "cycle", "smart"].includes(raw.mode) ? raw.mode : DEFAULT_CONFIG.mode,
    interval_secs:
      Number.isFinite(raw.interval_secs) && raw.interval_secs >= 10 && raw.interval_secs <= 60
        ? raw.interval_secs
        : DEFAULT_CONFIG.interval_secs,
    custom_message: typeof raw.custom_message === "string" ? raw.custom_message : "",
  };
}
