// /api/_fa_parser.js — FA Full-Time HTML adapter (Epic C / C1).
//
// The FA killed every structured feed (no JSON/XML/iCal/CSV; the "Code Snippets"
// embed is locked behind admin login). But the public Full-Time pages stay
// server-rendered and parseable — a real sample (session 223):
//   fulltime.thefa.com/index.html?league=…&selectedSeason=…&selectedDivision=…&selectedFixtureGroupKey=…
// returns an HTML table whose rows carry a fixture link
//   /displayFixture.html?id=28052869   (the stable per-fixture id → fa_fixture_key)
// dates as dd/mm/yy ("11/05/25") and scores as "H - A" ("4 - 1").
//
// This is a PROVIDER ADAPTER (decision 1b): built against the generic FA
// Full-Time markup, to be CALIBRATED against the real page at pilot onboarding
// (no real pilot league exists in the system yet). Brittle by nature — when the
// FA changes its markup we own the pipe. Pure string work, no dependency.
//
// Scope (decision 2b): fixtures + results ONLY. No league-table parse.

"use strict";

// Minimal HTML-entity decode for the handful that show up in club/team names.
function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&apos;|&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#0*38;/g, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#0*45;/g, "-");
}

// Strip tags from a cell's inner HTML → collapsed plain text.
function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// "11/05/25" or "11/05/2025" → "2025-05-11". Returns null if not a date.
function parseFaDate(text) {
  const m = String(text || "").match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  let yyyy = m[3];
  if (yyyy.length === 2) yyyy = "20" + yyyy;
  const d = Number(dd), mo = Number(mm);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${yyyy}-${mm}-${dd}`;
}

// "HH:MM" → "HH:MM" (24h), else null.
function parseKickoff(text) {
  const m = String(text || "").match(/^\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// "4 - 1" → {home:4, away:1}; anything else (time / "v" / empty) → null.
function parseScore(text) {
  const m = String(text || "").match(/^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

const DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const TIME_RE = /^\s*\d{1,2}:\d{2}\s*$/;
const SCORE_RE = /^\s*\d{1,3}\s*[-–]\s*\d{1,3}\s*$/;

// A plausible team-name cell: contains at least one letter and is not a
// date / kickoff time / score / pure punctuation.
function looksLikeTeam(text) {
  if (!text) return false;
  if (DATE_RE.test(text) || TIME_RE.test(text) || SCORE_RE.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

// Walk cells from `start` in `dir` (-1 left / +1 right) → first team-like cell.
function findTeam(cells, start, dir) {
  for (let i = start; i >= 0 && i < cells.length; i += dir) {
    if (looksLikeTeam(cells[i])) return cells[i];
  }
  return null;
}

// Parse a public FA Full-Time page → array of normalised fixtures:
//   { fa_fixture_key, scheduled_date, kickoff_time, home_team, away_team,
//     home_score, away_score, status }
// home/away are the RAW parsed names (team-mapping vs club_teams happens in the
// caller). status='completed' when a "H - A" score is present, else 'scheduled'.
function parseFullTimeHtml(html) {
  const out = [];
  const seen = new Set();
  const src = String(html || "");
  const rows = src.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const keyM = row.match(/displayFixture\.html\?id=(\d+)/i);
    if (!keyM) continue;
    const key = keyM[1];
    if (seen.has(key)) continue; // a row can repeat the link in two cells

    const cellHtml = row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
    const cells = cellHtml.map(stripTags);

    // The fixture link lives in the score/result cell; home is the team-cell to
    // its left, away to its right (the canonical FT column order:
    // Date | Home | Score(link) | Away | Venue…).
    let linkIdx = -1;
    for (let i = 0; i < cellHtml.length; i++) {
      if (/displayFixture\.html\?id=/i.test(cellHtml[i])) { linkIdx = i; break; }
    }
    if (linkIdx === -1) continue;

    const home = findTeam(cells, linkIdx - 1, -1);
    const away = findTeam(cells, linkIdx + 1, +1);
    if (!home || !away) continue; // unparseable row — skip, never fabricate

    const rowText = cells.join(" ");
    const scheduled_date = parseFaDate(rowText);
    const scoreCell = cells[linkIdx] || "";
    const score = parseScore(scoreCell);
    // kickoff: the link cell when it's a time, else any time-looking cell
    const kickoff_time = parseKickoff(scoreCell) ||
      parseKickoff((cells.find(c => TIME_RE.test(c)) || ""));

    seen.add(key);
    out.push({
      fa_fixture_key: key,
      scheduled_date,
      kickoff_time,
      home_team: home,
      away_team: away,
      home_score: score ? score.home : null,
      away_score: score ? score.away : null,
      status: score ? "completed" : "scheduled",
    });
  }
  return out;
}

// Normalise a team name for matching (lowercase, strip punctuation/extra spaces).
function normaliseTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

module.exports = {
  parseFullTimeHtml,
  parseFaDate,
  parseKickoff,
  parseScore,
  normaliseTeamName,
  stripTags,
};
