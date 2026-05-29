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
