// clubTrialHelpers.js — pure helpers for the public trial flow (/c/<slug>/trial).
// No DB access, no side effects (except downloadIcs, which is user-gesture download).

// School year from DOB — a faithful JS mirror of the LIVE _school_year_for_dob
// (mig 588): anchor on 31 Aug of the school-year-start year, age at that anchor
// minus 4. Reception = 0, pre-school negative. Presentation only — mig 588's
// _class_age_eligibility is the real enforcer at booking time; this just lets S3
// show the child their eligible sessions instead of a cross-band picker.
// NOTE: this is presentation-only client filtering; the live _class_age_eligibility
// guard (which reads member_profiles.dob server-side) is authoritative at booking time.
// `new Date('YYYY-MM-DD')` parses as UTC-midnight but is read via local getters — for a
// UK audience (GMT/BST ≥ UTC) there is no day shift, so this equals the SQL cutoff exactly.
export function schoolYearForDob(dob, ref = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  // month is 0-based: 8 === September. On/after 1 Sep the anchor is this year's
  // 31 Aug, else last year's.
  const anchorYear = ref.getMonth() >= 8 ? ref.getFullYear() : ref.getFullYear() - 1;
  const anchor = new Date(anchorYear, 7, 31); // month 7 === August
  let age = anchor.getFullYear() - d.getFullYear();
  const m = anchor.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && anchor.getDate() < d.getDate())) age -= 1;
  return age - 4;
}

// Current age in whole years — matches the RPC's date_part('year', age(dob)),
// used only for the age-band branch. (Same shape as MembershipSignup's ageFromDob.)
export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a -= 1;
  return a;
}

// Is this child eligible for this session's class band? Mirrors
// _class_age_eligibility exactly: school-year band wins if present, else age
// band, else open. NULL dob → eligible (server admits it too, mig 584).
export function isEligible(session, dob) {
  if (!dob) return true;
  const s = session || {};
  const hasYear = s.school_year_min != null || s.school_year_max != null;
  if (hasYear) {
    const y = schoolYearForDob(dob);
    if (y == null) return true;
    if (s.school_year_min != null && y < s.school_year_min) return false;
    if (s.school_year_max != null && y > s.school_year_max) return false;
    return true;
  }
  const hasAge = s.min_age != null || s.max_age != null;
  if (hasAge) {
    const a = ageFromDob(dob);
    if (a == null) return true;
    if (s.min_age != null && a < s.min_age) return false;
    if (s.max_age != null && a > s.max_age) return false;
    return true;
  }
  return true;
}

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function slotDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dow: "", dnum: "", month: "" };
  return { dow: DOW[d.getDay()], dnum: d.getDate(), month: MON[d.getMonth()] };
}

// "5–6pm", "9:30–10:30am", "11am–12pm" — compact, en-GB, matches the design.
function clock(d) {
  let h = d.getHours();
  const min = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12; if (h === 0) h = 12;
  return { txt: min ? `${h}:${String(min).padStart(2, "0")}` : `${h}`, ap };
}
export function slotTime(startIso, endIso) {
  const a = new Date(startIso), b = new Date(endIso);
  if (Number.isNaN(a.getTime())) return "";
  const s = clock(a);
  if (Number.isNaN(b.getTime())) return `${s.txt}${s.ap}`;
  const e = clock(b);
  // Drop the first meridiem when both sides share it ("5–6pm" not "5pm–6pm").
  return s.ap === e.ap ? `${s.txt}–${e.txt}${e.ap}` : `${s.txt}${s.ap}–${e.txt}${e.ap}`;
}

// Longer, human date for the confirmation ("Wednesday 22 July").
export function longDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// ── .ics generation (client-side "Add to calendar", no server involved) ──────
function icsStamp(iso) {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function icsEscape(t) {
  // Escape RFC-5545 specials and fold any CR/LF (incl. a lone \r) to the literal \n
  // token so a value can never inject a new calendar line.
  return String(t || "").replace(/([,;\\])/g, "\\$1").replace(/\r\n|\r|\n/g, "\\n");
}
export function buildIcs({ title, start, end, location, description }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//In or Out//Trial//EN",
    "BEGIN:VEVENT",
    `UID:trial-${icsStamp(start)}@in-or-out.com`,
    `DTSTART:${icsStamp(start)}`,
    end ? `DTEND:${icsStamp(end)}` : "",
    `SUMMARY:${icsEscape(title)}`,
    location ? `LOCATION:${icsEscape(location)}` : "",
    description ? `DESCRIPTION:${icsEscape(description)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}
export function downloadIcs(filename, text) {
  try {
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error("[trial] ics download failed", e);
  }
}
