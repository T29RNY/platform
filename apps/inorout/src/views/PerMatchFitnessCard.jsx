// PerMatchFitnessCard — per-match Apple Watch fitness for one game (Match Workout
// Tracking PR #3 + PR #6b). Reads get_match_health_for_match (mig 456): the caller's OWN row
// always, plus teammate rows ONLY for casual games where that player consented
// (share_match_fitness). Self-hides when there is no data AND health is unavailable.
//
// When empty + VITE_HEALTH_KIT_ENABLED + authenticated: shows an "Add Apple Watch workout"
// button that drives the match-to-game attach flow:
//   age-gate (18+ confirm, localStorage) → HealthKit auth → query workouts in the match
//   window → sanity-clamp → confirm (single) or picker (multiple) → save → refresh.
//
// Route/heatmap dropped 2026-07-04: Apple does not persist a retrievable GPS route for
// football workouts, so it never populated (see MATCH_FITNESS_DPIA_ADDENDUM.md). Only the
// duration/distance/HR/calories summary is stored now.
// Indoor vs outdoor: no distance (indoor games carry no GPS distance) → hide the distance stat.
// matchRef = matches.id (text) for casual, fixtures.id (uuid) for league.
// matchDate = "YYYY-MM-DD"; kickoffTime = "HH:MM:SS" or null.

import { useEffect, useRef, useState } from "react";
import { Lightning, Watch, ArrowClockwise, CheckCircle, Warning, PersonSimpleRun } from "@phosphor-icons/react";
import {
  getMatchHealthForMatch,
  saveMatchHealthSummary,
  getMyShareMatchFitness,
  setShareMatchFitness,
  deleteMatchHealthSession,
} from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import {
  isHealthAvailable,
  requestHealthAuth,
  queryWorkouts,
} from "../native/native-health.js";
import { setVenuePreference } from "../native/venue-preference.js";
import { formatDistance } from "../lib/formatDistance.js";

const AGE_KEY = "health_18plus_confirmed";
// One-time proactive sharing prompt (PR #6, LOCKED DECISION #11): shown once, at the FIRST
// successful attach, if the player isn't already sharing. Either choice sets this so it never
// re-appears; the PlayerProfile toggle stays the permanent control. Mirrors the AGE_KEY idiom.
// U18 never reaches it — the attach flow is age-gated and save_match_health_summary blocks
// under-18s server-side, so a successful attach implies 18+.
const SHARE_SEEN_KEY = "io_fitness_share_seen";
// Per-match throttle: set only once a workout has actually been SURFACED (confirm/pick) for a
// match, so we never re-modal a game the player was already offered. An empty/denied auto-search
// does NOT set it — the Watch may not have synced yet, so the next open retries (manifest's
// "sync-delay retry"). Mirrors the AGE_KEY localStorage idiom.
const AUTO_KEY = (matchRef) => `io_fitness_autoprompt_${matchRef}`;
// Only auto-detect for games in the recent window; older history never auto-fires (it would
// have prompted when recent, and this bounds the eager search to "just played").
const AUTO_RECENT_DAYS = 14;
function isRecentMatch(matchDate) {
  if (!matchDate) return false;
  const d = new Date(matchDate);
  if (isNaN(d.getTime())) return false;
  const days = (Date.now() - d.getTime()) / 86400000;
  return days >= 0 && days <= AUTO_RECENT_DAYS;
}

function fmtMinutes(seconds) {
  if (!seconds) return "—";
  return `${Math.round(seconds / 60)}`;
}
function fmtTime(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

// Build the HealthKit query window for a casual match.
// matchDate = "YYYY-MM-DD", kickoffTime = "HH:MM:SS" or "HH:MM" or null.
// Returns null if matchDate is missing (can't build a window).
function buildMatchWindow(matchDate, kickoffTime) {
  if (!matchDate) return null;
  const time = kickoffTime ? kickoffTime.slice(0, 5) : "12:00";
  const kickoff = new Date(`${matchDate}T${time}:00`);
  if (isNaN(kickoff.getTime())) return null;
  return {
    kickoff,
    fromISO: new Date(kickoff.getTime() - 30 * 60 * 1000).toISOString(),
    toISO: new Date(kickoff.getTime() + 150 * 60 * 1000).toISOString(),
  };
}

// Sanity-clamp: drop workouts shorter than 15 min or longer than 4 hours.
const MIN_SECS = 15 * 60;
const MAX_SECS = 4 * 60 * 60;
function clampWorkouts(workouts) {
  return workouts.filter(w => w.durationSeconds >= MIN_SECS && w.durationSeconds <= MAX_SECS);
}

function Stat({ label, value }) {
  // Sized so all five metrics fit on ONE row on a phone (no wrap to a second line).
  return (
    <div style={{ flex: "1 1 0", minWidth: 0, textAlign: "center" }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 9, color: "var(--t2)", marginTop: 4, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

function FitnessRow({ row, isTop = false, onRemove = null }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const distance = formatDistance(row.distance_meters);
  const indoor = !distance;

  return (
    <div style={{ padding: "10px 0", borderTop: "0.5px solid var(--b2)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "var(--t1)", fontFamily: "DM Sans, sans-serif" }}>
          {isTop && <PersonSimpleRun size={14} weight="thin" color="var(--gold)" />}
          {row.is_self ? "You" : (row.player_name || "Player")}
          {indoor && <span style={{ fontSize: 11, color: "var(--t2)", marginLeft: 8 }}>· Indoor</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {/* Detach affordance (PR #9d) — own row only. Two-tap confirm so a mis-attached workout
              can be removed without an accidental one-tap delete of special-category data. */}
          {onRemove && !confirmRemove && (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              style={{ background: "none", border: "none", color: "var(--t2)", fontSize: 11, fontFamily: "DM Sans, sans-serif", cursor: "pointer", padding: 0 }}
            >
              Remove
            </button>
          )}
          {onRemove && confirmRemove && (
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => { setConfirmRemove(false); onRemove(row.session_id); }}
                style={{ background: "none", border: "none", color: "var(--red)", fontSize: 11, fontWeight: 600, fontFamily: "DM Sans, sans-serif", cursor: "pointer", padding: 0 }}
              >
                Remove?
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                style={{ background: "none", border: "none", color: "var(--t2)", fontSize: 11, fontFamily: "DM Sans, sans-serif", cursor: "pointer", padding: 0 }}
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "nowrap", gap: 6 }}>
        <Stat label="Minutes" value={fmtMinutes(row.duration_seconds)} />
        {distance && <Stat label="Distance" value={distance} />}
        <Stat label="Calories" value={row.active_energy_kcal ? Math.round(row.active_energy_kcal) : "—"} />
        <Stat label="Avg HR" value={row.avg_hr ? `${row.avg_hr}` : "—"} />
        <Stat label="Max HR" value={row.max_hr ? `${row.max_hr}` : "—"} />
      </div>
    </div>
  );
}

// Overlay modal shell
function Modal({ children, onClose }) {
  return (
    <div
      role="dialog"
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.7)", display: "flex",
        alignItems: "flex-end", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", maxWidth: 430, borderRadius: "16px 16px 0 0",
        background: "var(--bg)", padding: "24px 20px 36px",
      }}>
        {children}
      </div>
    </div>
  );
}

function WorkoutRow({ w, onSelect }) {
  const dist = formatDistance(w.distanceMeters);
  return (
    <button
      type="button"
      onClick={() => onSelect(w)}
      style={{
        width: "100%", textAlign: "left", background: "var(--s2)",
        border: "0.5px solid var(--b2)", borderRadius: 10,
        padding: "12px 14px", marginBottom: 8, cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)", marginBottom: 4 }}>
        {fmtTime(w.startISO)} – {fmtTime(w.endISO)}
        {w.indoor && <span style={{ fontSize: 11, color: "var(--t2)", marginLeft: 6 }}>· Indoor</span>}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--t2)" }}>{fmtMinutes(w.durationSeconds)} min</span>
        {dist && <span style={{ fontSize: 12, color: "var(--t2)" }}>{dist}</span>}
        {w.activeEnergyKcal && <span style={{ fontSize: 12, color: "var(--t2)" }}>{Math.round(w.activeEnergyKcal)} kcal</span>}
        {w.avgHr && <span style={{ fontSize: 12, color: "var(--t2)" }}>avg {w.avgHr} bpm</span>}
      </div>
    </button>
  );
}

export default function PerMatchFitnessCard({ matchRef, matchDate, kickoffTime, matchContext = "casual", teamId = null }) {
  const [rows, setRows] = useState(null);
  const [hasSession, setHasSession] = useState(false);
  const [uid, setUid] = useState(null); // signed-in auth uid, for the HealthKit test-bed allowlist
  // attach flow: "idle"|"age-check"|"requesting"|"searching"|"no-workouts"|"confirm"|"pick"|"saving"|"error"
  const [attachState, setAttachState] = useState("idle");
  const [foundWorkouts, setFoundWorkouts] = useState([]);
  const [pendingWorkout, setPendingWorkout] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  // Quiet inline note for the AUTO path only (denied/empty) — never a modal, so opening a
  // result never spams a dialog when there's nothing to attach.
  const [autoNote, setAutoNote] = useState(null);
  const savingRef = useRef(false);
  const autoFiredRef = useRef(false);
  const [sharePrompt, setSharePrompt] = useState(false);
  const shareBusyRef = useRef(false);
  const removeRef = useRef(false);

  const healthAvail = isHealthAvailable(uid);

  // Initial data fetch
  useEffect(() => {
    if (!matchRef) return;
    let alive = true;
    (async () => {
      try {
        // get_match_health_for_match is authenticated-only; token-only/anon viewers skip
        // the fetch and self-hide rather than firing a request that will 403.
        const { data: { session } = {} } = await supabase.auth.getSession();
        const sess = !!session;
        if (alive) { setHasSession(sess); setUid(session?.user?.id ?? null); }
        if (!sess) { if (alive) setRows([]); return; }
        const res = await getMatchHealthForMatch(matchRef);
        if (alive) setRows(res?.rows || []);
      } catch (e) {
        console.error("[health] get_match_health_for_match failed", e);
        if (alive) setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [matchRef]);

  const refreshRows = async () => {
    try {
      const res = await getMatchHealthForMatch(matchRef);
      setRows(res?.rows || []);
    } catch (e) {
      console.error("[health] refresh get_match_health_for_match failed", e);
    }
  };

  // ── Attach flow ──────────────────────────────────────────────────────────

  const startAttach = () => {
    if (localStorage.getItem(AGE_KEY) === "yes") {
      runSearch();
    } else {
      setAttachState("age-check");
    }
  };

  const confirmAge = () => {
    localStorage.setItem(AGE_KEY, "yes");
    runSearch();
  };

  // `silent` = the auto-on-open path: no "requesting/searching" modal, and a quiet inline note
  // (not a modal) on denied/empty. A found workout surfaces the SAME confirm/pick sheet as the
  // manual path — one tap to add. Reuses the manual flow verbatim; only the noise differs.
  const runSearch = async ({ silent = false } = {}) => {
    if (silent) setAutoNote(null); else setAttachState("requesting");
    setErrorMsg(null);
    const auth = await requestHealthAuth();
    if (!auth.available) {
      if (silent) return;
      setAttachState("error");
      setErrorMsg(auth.error || "HealthKit is not available on this device.");
      return;
    }
    const win = buildMatchWindow(matchDate, kickoffTime);
    if (!win) {
      if (silent) return;
      setAttachState("error");
      setErrorMsg("This match has no date — can't search for a workout.");
      return;
    }
    if (!silent) setAttachState("searching");
    const raw = await queryWorkouts({ fromISO: win.fromISO, toISO: win.toISO });
    const workouts = clampWorkouts(raw);
    if (workouts.length === 0) {
      if (silent) { setAutoNote("No Apple Watch workout found for this game yet — it can take a few minutes to sync from your Watch."); return; }
      setAttachState("no-workouts");
    } else if (workouts.length === 1) {
      if (silent) localStorage.setItem(AUTO_KEY(matchRef), "1"); // surfaced → don't re-modal this match
      setPendingWorkout({ workout: workouts[0], win });
      setAttachState("confirm");
    } else {
      if (silent) localStorage.setItem(AUTO_KEY(matchRef), "1"); // surfaced → don't re-modal this match
      setFoundWorkouts(workouts.map(w => ({ ...w, _win: win })));
      setAttachState("pick");
    }
  };

  // Auto-detect on result-card mount: the moment a player opens a just-played casual game they
  // were IN for (no session yet), eagerly search Health and surface the one-tap confirm — zero
  // manual navigation (LOCKED DECISION #1/#2). Gated on AGE_KEY so it NEVER auto-pops the native
  // Health prompt or the age gate, and U18 is never auto-offered; the first attach stays manual
  // (establishing age + auth), every recent game after auto-surfaces. Fires once per match.
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (rows === null || rows.length > 0) return;              // still loading, or already attached
    if (!healthAvail || !hasSession || !matchDate) return;     // dark/unavailable → nothing to do
    if (localStorage.getItem(AGE_KEY) !== "yes") return;       // never auto-offer before age-confirm
    if (!isRecentMatch(matchDate)) return;                     // only just-played games
    if (localStorage.getItem(AUTO_KEY(matchRef)) === "1") return; // already surfaced for this match
    autoFiredRef.current = true;                               // reentrancy guard for THIS mount only
    runSearch({ silent: true });                              // persists AUTO_KEY only if a workout surfaces
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, healthAvail, hasSession, matchDate, matchRef]);

  const pickWorkout = (w) => {
    setPendingWorkout({ workout: w, win: w._win });
    setAttachState("confirm");
  };

  // One-time proactive consent prompt — offered once, at the first successful attach, when the
  // player isn't already sharing (LOCKED DECISION #11). NO new backend: uses the mig-457 consent
  // RPCs. U18 never sees it (age-gated attach + server U18 block ⇒ doSave success implies 18+).
  const maybeOfferShare = async () => {
    try {
      if (localStorage.getItem(SHARE_SEEN_KEY) === "1") return;   // already asked once
      if (localStorage.getItem(AGE_KEY) !== "yes") return;         // 18+ only
      const res = await getMyShareMatchFitness();
      if (res?.share_match_fitness) {                              // already sharing → never nag
        localStorage.setItem(SHARE_SEEN_KEY, "1");
        return;
      }
      setSharePrompt(true);
    } catch (e) {
      console.error("[health] share-prompt consent check failed", e);
    }
  };

  const acceptShare = async () => {
    if (shareBusyRef.current) return;
    shareBusyRef.current = true;
    try {
      await setShareMatchFitness(true);
      localStorage.setItem(SHARE_SEEN_KEY, "1");
      setSharePrompt(false);
    } catch (e) {
      // Leave the "seen" flag unset so a later attach can re-offer; the PlayerProfile toggle
      // remains the permanent control either way.
      console.error("[health] setShareMatchFitness failed", e);
      setSharePrompt(false);
    } finally {
      shareBusyRef.current = false;
    }
  };

  const declineShare = () => {
    localStorage.setItem(SHARE_SEEN_KEY, "1");
    setSharePrompt(false);
  };

  const doSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setAttachState("saving");
    setErrorMsg(null);
    const { workout, win } = pendingWorkout;
    try {
      // Route/heatmap dropped 2026-07-04 — Apple withholds a retrievable GPS route for
      // football workouts, so route is always null now (see MATCH_FITNESS_DPIA_ADDENDUM.md).
      await saveMatchHealthSummary({
        matchContext,
        matchRef,
        clientSessionId:   workout.uuid,
        durationSeconds:   workout.durationSeconds   ?? null,
        activeEnergyKcal:  workout.activeEnergyKcal  ?? null,
        distanceMeters:    workout.distanceMeters     ?? null,
        avgHr:             workout.avgHr              ?? null,
        maxHr:             workout.maxHr              ?? null,
        startedAt:         workout.startISO           ?? null,
        endedAt:           workout.endISO             ?? null,
        source:            "apple_health_manual",
        route:             null,
      });
      setVenuePreference(teamId, workout.indoor);
      setAttachState("idle");
      setPendingWorkout(null);
      setFoundWorkouts([]);
      await refreshRows();
      await maybeOfferShare();   // first successful attach → one-time "share your fitness?" prompt
    } catch (e) {
      console.error("[health] saveMatchHealthSummary failed", e);
      setAttachState("error");
      setErrorMsg("Couldn't save workout. Try again.");
    } finally {
      savingRef.current = false;
    }
  };

  // Detach a wrongly-attached workout (PR #9d) — own row only, by session id (mig 476). The route
  // cascades server-side; we refresh so the card reflects the removal (and self-hides if it was the
  // only session).
  const handleRemove = async (sessionId) => {
    if (removeRef.current) return;
    removeRef.current = true;
    try {
      await deleteMatchHealthSession(sessionId);
      await refreshRows();
    } catch (e) {
      console.error("[health] deleteMatchHealthSession failed", e);
    } finally {
      removeRef.current = false;
    }
  };

  const resetAttach = () => {
    setAttachState("idle");
    setFoundWorkouts([]);
    setPendingWorkout(null);
    setErrorMsg(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (rows === null) return null;

  // The one-time share prompt must render in BOTH the populated and empty branches: after a
  // successful attach refreshRows() repopulates the caller's OWN row, so rows.length>0 is exactly
  // where the player lands when maybeOfferShare() fires. Rendering it only in the empty branch
  // (as first written) made it dead UI.
  const shareModal = sharePrompt ? (
    <Modal onClose={declineShare}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", marginBottom: 8 }}>
        SHARE YOUR MATCH FITNESS?
      </div>
      <p style={{ fontSize: 14, color: "var(--t2)", lineHeight: 1.5, marginBottom: 18 }}>
        Let your squad see how you compare — head-to-head and on the squad board. Casual games
        only, and you can turn it off any time.
      </p>
      <button
        type="button"
        onClick={acceptShare}
        style={{
          width: "100%", background: "var(--gold)", border: "none", borderRadius: 10,
          padding: "13px 0", fontFamily: "DM Sans, sans-serif", fontSize: 14,
          fontWeight: 600, color: "var(--black)", cursor: "pointer", marginBottom: 10,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        <Lightning size={16} weight="thin" />
        Share my stats
      </button>
      <button type="button" onClick={declineShare} style={{ width: "100%", background: "none", border: "none", color: "var(--t2)", fontSize: 13, cursor: "pointer" }}>
        Not now
      </button>
    </Modal>
  ) : null;

  // Top runner = the furthest-distance row, but only when 2+ players have data (a self-only card
  // never singles anyone out). Rows are already consent-gated + casual-only + U18-guarded by the
  // reader; indoor/no-distance rows can't win.
  const runners = rows.filter((r) => Number(r.distance_meters) > 0);
  const topRunner =
    rows.length >= 2 && runners.length >= 1
      ? runners.reduce((a, b) => (Number(b.distance_meters) > Number(a.distance_meters) ? b : a))
      : null;

  if (rows.length > 0) {
    return (
      <>
        <div style={{ padding: 16, borderRadius: 12, background: "var(--s2)", border: "0.5px solid var(--b2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Lightning size={20} weight="thin" color="var(--gold)" />
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: "var(--t1)" }}>
              MATCH FITNESS
            </div>
          </div>
          {/* Top-runner highlight (PR #8): only when ≥2 players have data (a self-only card never
              singles anyone out). Ranks the already-fetched, consent-gated rows by distance —
              indoor/no-distance rows are excluded. No new backend. */}
          {topRunner && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <PersonSimpleRun size={16} weight="thin" color="var(--gold)" />
              <div style={{ fontSize: 12.5, fontFamily: "DM Sans, sans-serif", color: "var(--t2)" }}>
                Top runner this game:{" "}
                <span style={{ color: "var(--t1)", fontWeight: 600 }}>
                  {topRunner.is_self ? "You" : (topRunner.player_name || "Player")}
                </span>
                <span style={{ color: "var(--gold)", fontWeight: 600 }}> · {formatDistance(topRunner.distance_meters)}</span>
              </div>
            </div>
          )}
          {rows.map((row) => (
            <FitnessRow
              key={row.session_id}
              row={row}
              isTop={!!topRunner && row.session_id === topRunner.session_id}
              onRemove={row.is_self ? handleRemove : null}
            />
          ))}
        </div>
        {shareModal}
      </>
    );
  }

  // Empty — show attach button only when health is enabled, user is signed in, and date is known
  if (!healthAvail || !hasSession || !matchDate) return null;

  return (
    <>
      <button
        type="button"
        onClick={startAttach}
        style={{
          width: "100%", background: "none",
          border: "0.5px solid var(--b2)", borderRadius: 10,
          padding: "12px 14px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
          color: "var(--t2)", fontSize: 13, fontFamily: "DM Sans, sans-serif",
        }}
      >
        <Watch size={18} weight="thin" color="var(--gold)" />
        Add Apple Watch workout
      </button>

      {autoNote && (
        <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 8, fontFamily: "DM Sans, sans-serif" }}>
          {autoNote}
        </div>
      )}

      {attachState === "age-check" && (
        <Modal onClose={resetAttach}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", marginBottom: 8 }}>
            MATCH FITNESS
          </div>
          <p style={{ fontSize: 14, color: "var(--t2)", marginBottom: 20 }}>
            This feature reads your Apple Health data. It's only available to players aged 18 or older.
          </p>
          <button
            type="button"
            onClick={confirmAge}
            style={{
              width: "100%", background: "var(--gold)", border: "none", borderRadius: 10,
              padding: "13px 0", fontFamily: "DM Sans, sans-serif", fontSize: 14,
              fontWeight: 600, color: "var(--black)", cursor: "pointer", marginBottom: 10,
            }}
          >
            I'm 18 or older — continue
          </button>
          <button type="button" onClick={resetAttach} style={{ width: "100%", background: "none", border: "none", color: "var(--t2)", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </Modal>
      )}

      {(attachState === "requesting" || attachState === "searching") && (
        <Modal onClose={resetAttach}>
          <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
            <Watch size={32} weight="thin" color="var(--gold)" />
            <div style={{ fontSize: 14, color: "var(--t2)", marginTop: 12 }}>
              {attachState === "requesting" ? "Opening Apple Health… this can take a moment the first time" : "Searching for a workout…"}
            </div>
          </div>
        </Modal>
      )}

      {attachState === "no-workouts" && (
        <Modal onClose={resetAttach}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", marginBottom: 8 }}>
            NO WORKOUT FOUND
          </div>
          <p style={{ fontSize: 14, color: "var(--t2)", marginBottom: 20 }}>
            No Apple Watch workout found near this match time. Health data can take a few minutes to sync from your Watch — try again shortly.
          </p>
          <button
            type="button"
            onClick={() => runSearch()}
            style={{
              width: "100%", background: "var(--s2)", border: "0.5px solid var(--b2)", borderRadius: 10,
              padding: "12px 0", fontFamily: "DM Sans, sans-serif", fontSize: 14,
              color: "var(--t1)", cursor: "pointer", marginBottom: 10,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <ArrowClockwise size={16} weight="thin" />
            Try again
          </button>
          <button type="button" onClick={resetAttach} style={{ width: "100%", background: "none", border: "none", color: "var(--t2)", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </Modal>
      )}

      {attachState === "confirm" && pendingWorkout && (
        <Modal onClose={resetAttach}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", marginBottom: 8 }}>
            ADD THIS WORKOUT?
          </div>
          <WorkoutRow w={pendingWorkout.workout} onSelect={() => {}} />
          <button
            type="button"
            onClick={doSave}
            style={{
              width: "100%", background: "var(--gold)", border: "none", borderRadius: 10,
              padding: "13px 0", fontFamily: "DM Sans, sans-serif", fontSize: 14,
              fontWeight: 600, color: "var(--black)", cursor: "pointer", marginBottom: 10, marginTop: 4,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <CheckCircle size={16} weight="thin" />
            Add to match
          </button>
          <button type="button" onClick={resetAttach} style={{ width: "100%", background: "none", border: "none", color: "var(--t2)", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </Modal>
      )}

      {attachState === "pick" && (
        <Modal onClose={resetAttach}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", marginBottom: 12 }}>
            WHICH WORKOUT?
          </div>
          {foundWorkouts.map(w => (
            <WorkoutRow key={w.uuid} w={w} onSelect={pickWorkout} />
          ))}
          <button type="button" onClick={resetAttach} style={{ width: "100%", background: "none", border: "none", color: "var(--t2)", fontSize: 13, cursor: "pointer", marginTop: 4 }}>
            Cancel
          </button>
        </Modal>
      )}

      {attachState === "saving" && (
        <Modal onClose={() => {}}>
          <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
            <Watch size={32} weight="thin" color="var(--gold)" />
            <div style={{ fontSize: 14, color: "var(--t2)", marginTop: 12 }}>Saving workout…</div>
          </div>
        </Modal>
      )}

      {attachState === "error" && (
        <Modal onClose={resetAttach}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Warning size={20} weight="thin" color="var(--amber, #e8a020)" />
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--t1)" }}>
              COULDN'T ADD WORKOUT
            </div>
          </div>
          <p style={{ fontSize: 14, color: "var(--t2)", marginBottom: 20 }}>
            {errorMsg || "Something went wrong. Try again."}
          </p>
          <button type="button" onClick={resetAttach} style={{ width: "100%", background: "none", border: "none", color: "var(--t2)", fontSize: 13, cursor: "pointer" }}>
            Close
          </button>
        </Modal>
      )}

      {shareModal}
    </>
  );
}
