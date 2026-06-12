// ============================================================
// ui.jsx — shared crafted glyphs + small presentational bits,
// ported verbatim from the artifact (ui.jsx + live.jsx glyphs).
// No emoji; icons are simple shapes/strokes.
// ============================================================
import React, { useState, useEffect } from "react";

// ---------- glyphs ----------
export function GoalDot({ s = 16 }) { return <span className="bg-goal" style={{ width: s, height: s }} />; }
export function OGDot({ s = 16 }) { return <span className="bg-og" style={{ width: s, height: s }} />; }
export function CardGlyph({ red, w = 13, h = 18 }) { return <span className={"bg-card " + (red ? "bg-red" : "bg-yellow")} style={{ width: w, height: h }} />; }

export function SubGlyph({ s = 18, c = "currentColor" }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none">
      <path d="M5 11V4M5 4L2.5 6.5M5 4l2.5 2.5" stroke="#16A35A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 7v7M13 14l2.5-2.5M13 14l-2.5-2.5" stroke={c === "currentColor" ? "#F0443E" : c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function PauseIcon({ s = 15 }) {
  return <svg width={s} height={s} viewBox="0 0 14 14"><rect x="2" y="1.5" width="3.4" height="11" rx="1.2" fill="currentColor" /><rect x="8.6" y="1.5" width="3.4" height="11" rx="1.2" fill="currentColor" /></svg>;
}
export function PlayIcon({ s = 15 }) {
  return <svg width={s} height={s} viewBox="0 0 14 14"><path d="M3 1.8v10.4a.6.6 0 00.92.5l8-5.2a.6.6 0 000-1l-8-5.2A.6.6 0 003 1.8z" fill="currentColor" /></svg>;
}
export function CheckIcon({ s = 16, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4.5" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function RefreshIcon({ s = 16 }) {
  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2v3h-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function WhistleIcon({ s = 18, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 18 18" fill="none"><circle cx="6.5" cy="10" r="4.2" stroke={c} strokeWidth="1.6" /><path d="M10.5 8.2L16 6.2v3.6l-5.5-1.6M6.5 5.8V3.2h3" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function FlagIcon({ s = 16, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M4 2.2v11.6" stroke={c} strokeWidth="1.8" strokeLinecap="round" /><path d="M4 3h8l-1.8 2.4L12 7.8H4z" fill={c} /></svg>;
}
export function NoteGlyph({ s = 16, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M3 2.5h7l3 3v8H3z" stroke={c} strokeWidth="1.5" strokeLinejoin="round" /><path d="M9.5 2.7v3.3H13M5.5 9h5M5.5 11.4h3" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function SunIcon({ s = 15, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.2" stroke={c} strokeWidth="1.6" /><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7L13 13M13 3l-1.3 1.3M4.3 11.7L3 13" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
export function ChevR({ s = 16, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function PlusIcon({ s = 16, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke={c} strokeWidth="2" strokeLinecap="round" /></svg>;
}
export function SinBinGlyph({ s = 18, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9.5" r="6.2" stroke={c} strokeWidth="1.6" /><path d="M9 6.2v3.5l2.3 1.4" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.6 2.3h4.8" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
export function ListGlyph({ s = 13, c = "currentColor" }) {
  return <svg width={s} height={s} viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

export function DaylightToggle() {
  const [on, setOn] = useState(() => (typeof document !== "undefined" && document.documentElement.classList.contains("daylight")) || localStorage.getItem("ioo-ref-daylight") === "1");
  useEffect(() => { document.documentElement.classList.toggle("daylight", on); localStorage.setItem("ioo-ref-daylight", on ? "1" : "0"); }, [on]);
  return <button className={"sun-btn" + (on ? " on" : "")} onClick={() => setOn((v) => !v)} aria-label="Daylight mode" title="Daylight / high-contrast"><SunIcon s={15} c="currentColor" /></button>;
}

export function Swatch({ c, size = 12 }) { return <span className="swatch" style={{ width: size, height: size, background: c || "#666" }} />; }
export function SwatchBar({ c }) { return <span className="swatch-bar" style={{ background: c || "#666" }} />; }

// ---------- badge cluster from playerStatus ----------
export function Badges({ st }) {
  if (!st || (!st.goals && !st.og && !st.yellows && !st.red)) return null;
  return (
    <span className="badge-row">
      {st.goals > 0 && <><GoalDot />{st.goals > 1 && <span className="bg-count">×{st.goals}</span>}</>}
      {st.og > 0 && <><OGDot />{st.og > 1 && <span className="bg-count">×{st.og}</span>}</>}
      {st.yellows > 0 && <><CardGlyph />{st.yellows > 1 && <span className="bg-count">×{st.yellows}</span>}</>}
      {st.red && <CardGlyph red />}
    </span>
  );
}

// ---------- date/time helper ----------
export function fmtKick(date, time) {
  if (!date) return { big: "Time TBC", small: "" };
  const d = new Date(date + "T00:00:00");
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const big = time ? time.slice(0, 5) : "—";
  return { big, small: day };
}
