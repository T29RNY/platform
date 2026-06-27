// RefFixtures.jsx — Referee track, the "My fixtures" list (amber).
//
// The referee's home inside /hub. Reads the EXISTING get_my_assignments(null) (mig
// 372, Swift-locked shape — untouched): one row per league/casual fixture this person
// is the match official for, already filtered server-side to live + upcoming only
// (status IN scheduled|allocated|in_progress, future-or-live). No new backend.
//
// Rows group into "Live now" (is_in_progress), "Upcoming", and "Past". Tapping a row
// hands the fixture's ref_token up to the shell, which opens the existing token-driven
// ref app (apps/ref) in a full-screen iframe overlay — the meticulous officiating UI is
// reused unchanged, never re-ported here. Live/upcoming come from get_my_assignments
// (mig 372, Swift-locked); Past comes from the separate get_my_officiating_history
// (mig 441) — completed games, read-only (the ref app routes a completed token to its
// own PostMatch view).
//
// PR #3 (mig 442) adds the ref's own WRITES, merged client-side from get_my_ref_status
// (the Swift-locked get_my_assignments still untouched): Accept/Decline on each upcoming
// row, and a "My availability" panel of blackout date ranges the venue assigns around.

import { useEffect, useState } from "react";
import {
  getMyAssignments, getMyTournamentAssignments, getMyOfficiatingHistory, getMyRefStatus,
  refRespondToAssignment, refAddUnavailability, refRemoveUnavailability,
} from "@platform/core";
import MIcon from "../icons.jsx";

const respKey = (g) => `${g.context}:${g.game_id}`;

// kickoff_at is a timestamp (league = local naive, casual = tz) — format defensively.
function fmtKick(iso) {
  if (!iso) return "Time TBC";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Time TBC";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${time}`;
}

// Past games show the date played, not a kickoff time.
function fmtPlayed(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Availability windows carry 'YYYY-MM-DD' date strings.
function fmtDay(ymd) {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function titleFor(g) {
  if (g.context === "casual") return g.squad_name || "Casual match";
  return `${g.home_team || "Home"}  v  ${g.away_team || "Away"}`;
}

// Three contexts: casual (amber), tournament/cup (green), league (blue, default).
const CONTEXT_CHIP = {
  casual:     { label: "Casual", bg: "var(--amber-soft)", fg: "var(--amber)" },
  tournament: { label: "Cup",    bg: "var(--ok-soft)",    fg: "var(--ok-ink)" },
  league:     { label: "League", bg: "var(--info-soft)",  fg: "var(--info-ink)" },
};
function ContextChip({ context }) {
  const c = CONTEXT_CHIP[context] || CONTEXT_CHIP.league;
  return (
    <span style={{
      flex: "none", fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase",
      padding: "3px 8px", borderRadius: "var(--r-pill)",
      background: c.bg, color: c.fg,
    }}>
      {c.label}
    </span>
  );
}

// A small accept/decline control bar shown under upcoming rows. response is
// "accepted" | "declined" | undefined (pending). Buttons are siblings of the
// open-button (never nested), so tapping them never opens the match.
function ResponseBar({ response, busy, onRespond }) {
  const Pill = ({ tone }) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800,
      padding: "4px 10px", borderRadius: "var(--r-pill)",
      background: tone === "ok" ? "var(--ok-soft, var(--amber-soft))" : "var(--alert-soft, var(--amber-soft))",
      color: tone === "ok" ? "var(--ok-ink, var(--amber))" : "var(--alert-ink, var(--ink2))",
    }}>
      <MIcon name={tone === "ok" ? "check" : "x"} size={13} />
      {tone === "ok" ? "Accepted" : "Declined"}
    </span>
  );
  const Btn = ({ kind, label }) => (
    <button
      onClick={() => onRespond(kind)}
      disabled={busy}
      style={{
        flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 800, cursor: busy ? "default" : "pointer",
        padding: "9px 10px", borderRadius: "var(--r-md)", opacity: busy ? 0.5 : 1,
        border: kind === "accepted" ? "none" : "1px solid var(--hair)",
        background: kind === "accepted" ? "var(--amber)" : "var(--s2)",
        color: kind === "accepted" ? "var(--amber-ink)" : "var(--ink2)",
      }}>
      <MIcon name={kind === "accepted" ? "check" : "x"} size={15}
             color={kind === "accepted" ? "var(--amber-ink)" : "var(--ink3)"} />
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 2px" }}>
      {response === "accepted" && <><Pill tone="ok" /><span style={{ flex: 1 }} />
        <button onClick={() => onRespond("declined")} disabled={busy}
          style={{ background: "none", border: "none", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer", textDecoration: "underline" }}>Decline instead</button></>}
      {response === "declined" && <><Pill tone="no" /><span style={{ flex: 1 }} />
        <button onClick={() => onRespond("accepted")} disabled={busy}
          style={{ background: "none", border: "none", color: "var(--amber)", fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 800, cursor: busy ? "default" : "pointer", textDecoration: "underline" }}>Accept instead</button></>}
      {!response && <><Btn kind="declined" label="Decline" /><Btn kind="accepted" label="Accept" /></>}
    </div>
  );
}

function FixtureRow({ g, onOpen, response, busy, onRespond }) {
  const live = g.is_in_progress;
  const showResponse = !live; // upcoming rows can accept/decline; live rows just open
  return (
    <div
      className="m-card"
      style={{
        width: "100%", fontFamily: "var(--m-font)", marginBottom: 9,
        padding: showResponse ? "13px 14px 11px" : "13px 14px",
        display: "flex", flexDirection: "column", gap: showResponse ? 11 : 0,
        background: live ? "var(--amber-soft)" : "var(--s2)",
        borderColor: live ? "var(--amber-glow)" : "var(--hair)",
      }}>
      <button
        onClick={() => onOpen(g)}
        style={{
          width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "var(--m-font)",
          background: "none", border: "none", padding: 0,
          display: "flex", alignItems: "center", gap: 12,
        }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, flex: "none", display: "flex",
          alignItems: "center", justifyContent: "center",
          background: live ? "var(--amber)" : "var(--s4)",
        }}>
          <MIcon name="whistle" size={20} color={live ? "var(--amber-ink)" : "var(--ink2)"} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {titleFor(g)}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {live ? "In progress" : fmtKick(g.kickoff_at)}{g.venue_name ? ` · ${g.venue_name}` : ""}
          </div>
        </div>
        <ContextChip context={g.context} />
        <MIcon name="chevron" size={16} color="var(--ink4)" />
      </button>
      {showResponse && <ResponseBar response={response} busy={busy} onRespond={onRespond} />}
    </div>
  );
}

// A completed game — muted, with the final score badge. Tapping reuses the same
// officiating overlay; the ref app routes a completed token to its read-only PostMatch.
function PastRow({ g, onOpen }) {
  const hasScore = g.home_score != null && g.away_score != null;
  return (
    <button
      onClick={() => onOpen(g)}
      className="m-card"
      style={{
        width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "var(--m-font)",
        padding: "13px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
        background: "var(--s2)", borderColor: "var(--hair)", opacity: 0.92,
      }}>
      <div style={{
        width: 40, height: 40, borderRadius: 11, flex: "none", display: "flex",
        alignItems: "center", justifyContent: "center", background: "var(--s4)",
      }}>
        <MIcon name="whistle" size={20} color="var(--ink3)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {titleFor(g)}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {fmtPlayed(g.kickoff_at)}{g.venue_name ? ` · ${g.venue_name}` : ""}
        </div>
      </div>
      {hasScore && (
        <span style={{
          flex: "none", fontFamily: "var(--m-font-num, var(--m-font))", fontSize: 14, fontWeight: 800,
          letterSpacing: "0.02em", color: "var(--ink)", padding: "4px 10px", borderRadius: "var(--r-pill)",
          background: "var(--s4)",
        }}>
          {g.home_score}–{g.away_score}
        </span>
      )}
      <MIcon name="chevron" size={16} color="var(--ink4)" />
    </button>
  );
}

// "My availability" — blackout date ranges the ref can't work. Venues assign around
// them (the operator's assign UI flags a clashing ref). Add a range with two date
// inputs; remove a window with the × button.
function AvailabilityPanel({ items, onAdd, onRemove, busy }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const add = () => {
    if (!from || !to) return;
    onAdd(from, to, () => { setFrom(""); setTo(""); setOpen(false); });
  };

  const inputStyle = {
    flex: 1, minWidth: 0, fontFamily: "var(--m-font)", fontSize: 13, color: "var(--ink)",
    background: "var(--s1)", border: "1px solid var(--hair)", borderRadius: "var(--r-md)", padding: "9px 10px",
  };

  return (
    <div className="m-card" style={{ padding: "14px 14px 13px", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s4)" }}>
          <MIcon name="calendar" size={18} color="var(--amber)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>My availability</div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>Dates you can't officiate — venues assign around them.</div>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Cancel" : "Add unavailable dates"}
          style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 800, cursor: "pointer", padding: "7px 11px", borderRadius: "var(--r-md)", border: "none", background: open ? "var(--s4)" : "var(--amber)", color: open ? "var(--ink2)" : "var(--amber-ink)" }}>
          <MIcon name={open ? "x" : "plus"} size={14} color={open ? "var(--ink2)" : "var(--amber-ink)"} />
          {open ? "Cancel" : "Add"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="date" aria-label="Unavailable from" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 700 }}>to</span>
            <input type="date" aria-label="Unavailable to" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </div>
          <button
            onClick={add}
            disabled={busy || !from || !to}
            style={{ width: "100%", fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 800, cursor: (busy || !from || !to) ? "default" : "pointer", opacity: (busy || !from || !to) ? 0.5 : 1, padding: "10px", borderRadius: "var(--r-md)", border: "none", background: "var(--amber)", color: "var(--amber-ink)" }}>
            Mark unavailable
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
          {items.map((u) => (
            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: "var(--r-md)", background: "var(--s2)", border: "1px solid var(--hair)" }}>
              <MIcon name="clock" size={15} color="var(--ink3)" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>
                {u.start_date === u.end_date ? fmtDay(u.start_date) : `${fmtDay(u.start_date)} – ${fmtDay(u.end_date)}`}
              </span>
              <button onClick={() => onRemove(u.id)} disabled={busy} aria-label="Remove"
                style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, cursor: busy ? "default" : "pointer", background: "none", border: "none", opacity: busy ? 0.5 : 1 }}>
                <MIcon name="x" size={15} color="var(--ink3)" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Eyebrow({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 2px 10px" }}>
      <div className="m-eyebrow">{children}</div>
      {right && <span style={{ fontSize: 11.5, color: "var(--ink4)", fontWeight: 600 }}>{right}</span>}
    </div>
  );
}

export default function RefFixtures({ onOpenMatch, toast }) {
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [games, setGames] = useState([]);          // league + casual (Swift-locked reader)
  const [tourGames, setTourGames] = useState([]);  // tournament (mig 443, separate reader)
  const [past, setPast] = useState([]);
  const [responses, setResponses] = useState({}); // `${context}:${game_id}` -> "accepted"|"declined"
  const [unavail, setUnavail] = useState([]);
  const [busyKey, setBusyKey] = useState(null); // which row/availability op is in flight

  const loadStatus = () => {
    getMyRefStatus()
      .then((res) => {
        const map = {};
        (res?.responses || []).forEach((r) => { map[`${r.context}:${r.game_id}`] = r.response; });
        setResponses(map);
        setUnavail(res?.unavailability || []);
      })
      .catch((e) => { console.error("[ref] get_my_ref_status failed", e); });
  };

  const load = () => {
    setStatus("loading");
    // Live/upcoming gates the screen; the read-only Past list and the ref-status
    // (responses + availability) are best-effort and never block the page.
    getMyAssignments(null)
      .then((res) => { setGames(res?.games || []); setStatus("ok"); })
      .catch((e) => { console.error("[ref] get_my_assignments failed", e); setStatus("error"); });
    // Tournament assignments — separate reader (mig 443), best-effort like Past; merged below.
    getMyTournamentAssignments()
      .then((res) => { setTourGames(res?.games || []); })
      .catch((e) => { console.error("[ref] get_my_tournament_assignments failed", e); setTourGames([]); });
    getMyOfficiatingHistory()
      .then((res) => { setPast(res?.games || []); })
      .catch((e) => { console.error("[ref] get_my_officiating_history failed", e); setPast([]); });
    loadStatus();
  };
  useEffect(() => { load(); }, []);

  const open = (g) => {
    if (!g.ref_token) { toast?.({ icon: "alert", text: "No officiating link for this match yet" }); return; }
    onOpenMatch(g);
  };

  // Optimistic accept/decline with revert on error.
  const respond = (g, response) => {
    const key = respKey(g);
    if (busyKey) return;
    const prev = responses[key];
    setBusyKey(key);
    setResponses((m) => ({ ...m, [key]: response }));
    refRespondToAssignment(g.context, g.game_id, response)
      .then(() => { toast?.({ icon: "check", text: response === "accepted" ? "Assignment accepted" : "Assignment declined" }); })
      .catch((e) => {
        console.error("[ref] respond failed", e);
        setResponses((m) => ({ ...m, [key]: prev }));
        toast?.({ icon: "alert", text: "Couldn't save — try again" });
      })
      .finally(() => setBusyKey(null));
  };

  const addUnavail = (from, to, onDone) => {
    if (busyKey) return;
    setBusyKey("avail");
    refAddUnavailability(from, to)
      .then((res) => {
        setUnavail((arr) => [...arr, { id: res.id, start_date: res.start_date, end_date: res.end_date, note: null }]
          .sort((a, b) => (a.start_date < b.start_date ? -1 : 1)));
        toast?.({ icon: "check", text: "Marked unavailable" });
        onDone?.();
      })
      .catch((e) => { console.error("[ref] add unavailability failed", e); toast?.({ icon: "alert", text: "Couldn't save those dates" }); })
      .finally(() => setBusyKey(null));
  };

  const removeUnavail = (id) => {
    if (busyKey) return;
    const prev = unavail;
    setBusyKey("avail");
    setUnavail((arr) => arr.filter((u) => u.id !== id));
    refRemoveUnavailability(id)
      .catch((e) => { console.error("[ref] remove unavailability failed", e); setUnavail(prev); toast?.({ icon: "alert", text: "Couldn't remove that" }); })
      .finally(() => setBusyKey(null));
  };

  if (status === "loading") {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: "22px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--ink3)" }}>Loading your fixtures…</div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: "20px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Couldn't load fixtures</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", margin: "5px 0 14px" }}>Check your connection and try again.</div>
          <button onClick={load}
            style={{ border: "none", borderRadius: "var(--r-md)", padding: "10px 18px", fontSize: 14, fontWeight: 700, color: "var(--amber-ink)", background: "var(--amber)", cursor: "pointer", fontFamily: "var(--m-font)" }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Merge league/casual (Swift-locked reader) with tournament (mig 443) into one list,
  // live first then soonest kickoff — they share the per-game shape; the chip distinguishes.
  const allGames = [...games, ...tourGames].sort((a, b) => {
    if (a.is_in_progress !== b.is_in_progress) return a.is_in_progress ? -1 : 1;
    const ka = a.kickoff_at ? new Date(a.kickoff_at).getTime() : Infinity;
    const kb = b.kickoff_at ? new Date(b.kickoff_at).getTime() : Infinity;
    return ka - kb;
  });
  const liveGames = allGames.filter((g) => g.is_in_progress);
  const upcoming = allGames.filter((g) => !g.is_in_progress);

  // Only a true blank slate (no live/upcoming AND no history) shows the empty card —
  // but availability is still offered so a brand-new ref can set it up front.
  if (allGames.length === 0 && past.length === 0) {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: "26px 18px", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name="whistle" size={26} color="var(--amber)" />
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--ink)" }}>No fixtures assigned</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 6, lineHeight: 1.5 }}>
            When a venue assigns you to officiate a match, it'll show up here — ready to run from your phone.
          </div>
        </div>
        <AvailabilityPanel items={unavail} onAdd={addUnavail} onRemove={removeUnavail} busy={busyKey === "avail"} />
      </div>
    );
  }

  return (
    <div className="m-view-enter">
      {liveGames.length > 0 && (
        <>
          <Eyebrow right={`${liveGames.length} on pitch`}>Live now</Eyebrow>
          {liveGames.map((g) => <FixtureRow key={g.game_id} g={g} onOpen={open} />)}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <Eyebrow right={`${upcoming.length} match${upcoming.length === 1 ? "" : "es"}`}>Upcoming</Eyebrow>
          {upcoming.map((g) => (
            <FixtureRow
              key={g.game_id} g={g} onOpen={open}
              response={responses[respKey(g)]}
              busy={busyKey === respKey(g)}
              onRespond={(r) => respond(g, r)}
            />
          ))}
        </>
      )}

      {past.length > 0 && (
        <>
          <Eyebrow right={`${past.length} game${past.length === 1 ? "" : "s"}`}>Past</Eyebrow>
          {past.map((g) => <PastRow key={g.game_id} g={g} onOpen={open} />)}
        </>
      )}

      <Eyebrow>Availability</Eyebrow>
      <AvailabilityPanel items={unavail} onAdd={addUnavail} onRemove={removeUnavail} busy={busyKey === "avail"} />

      {allGames.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "16px 2px 4px", lineHeight: 1.45 }}>
          Tap a match to open the officiating screen — record goals, cards and the clock right here.
        </div>
      )}
    </div>
  );
}
