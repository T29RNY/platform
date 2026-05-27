import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  refRecordGoal,
  refRecordCard,
  refRecordSubstitution,
  refSetPeriod,
  refUndoEvent,
  refConfirmFullTime,
} from "@platform/core/storage/supabase.js";
import {
  enqueue as queueEnqueue,
  deletePending as queueDelete,
  listPending as queueList,
  isPending as queueIsPending,
} from "../lib/offlineQueue.js";

const LONG_PRESS_MS = 600;     // hold ⚽ this long → own goal
const UNDO_WINDOW_MS = 30000;  // toast visible for 30s after each event

// Replay a queued row by calling the matching wrapper. Kind/args
// mirror the wrapper signatures so the drain loop stays trivial.
async function fireQueued(refToken, row) {
  const a = row.args;
  switch (row.kind) {
    case "goal":   return refRecordGoal(refToken, a);
    case "card":   return refRecordCard(refToken, a);
    case "sub":    return refRecordSubstitution(refToken, a);
    case "period": return refSetPeriod(refToken, a.period, a.clientEventId, a.localTimestamp);
    default: throw new Error(`unknown queue kind: ${row.kind}`);
  }
}

// Derive the current period from the events array (most recent
// period_change wins; default to 1H before any have happened).
function derivePeriod(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === "period_change") return events[i].period;
  }
  return "1H";
}

// Score: regular goals add to the scorer's team; own_goals add to the
// OPPOSITE team (RPC stores own_goal under the scorer's own team_id).
function deriveScore(events, homeTeamId, awayTeamId) {
  let home = 0, away = 0;
  for (const e of events) {
    if (e.event_type === "goal") {
      if (e.team_id === homeTeamId) home++;
      else if (e.team_id === awayTeamId) away++;
    } else if (e.event_type === "own_goal") {
      if (e.team_id === homeTeamId) away++;
      else if (e.team_id === awayTeamId) home++;
    }
  }
  return { home, away };
}

function yellowCountFor(events, playerId) {
  let n = 0;
  for (const e of events) {
    if (e.event_type === "yellow_card" && e.player_id === playerId) n++;
  }
  return n;
}

function hasRed(events, playerId) {
  for (const e of events) {
    if (e.event_type === "red_card" && e.player_id === playerId) return true;
  }
  return false;
}

export default function LiveMatch({ state, refToken, onRefresh }) {
  const fixture   = state.fixture   ?? {};
  const homeTeam  = state.home_team  ?? {};
  const awayTeam  = state.away_team  ?? {};
  const homeSquad = state.home_squad ?? [];
  const awaySquad = state.away_squad ?? [];

  // Merge server-confirmed events with locally-optimistic ones. A local
  // event is replaced (matched by client_event_id) once the server returns.
  const [localEvents, setLocalEvents] = useState([]);
  const events = useMemo(() => {
    const server = state.events ?? [];
    const seen = new Set(server.map((e) => e.client_event_id).filter(Boolean));
    return [...server, ...localEvents.filter((e) => !seen.has(e.client_event_id))];
  }, [state.events, localEvents]);

  const period = derivePeriod(events);
  const score  = deriveScore(events, fixture.home_team_id, fixture.away_team_id);

  // ── Clock ────────────────────────────────────────────────────────
  const kickoffAt = fixture.actual_kickoff_at ? new Date(fixture.actual_kickoff_at).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedSec = kickoffAt ? Math.max(0, Math.floor((now - kickoffAt) / 1000)) : 0;
  const clockLabel = formatClock(elapsedSec);
  const currentMinute = Math.floor(elapsedSec / 60);

  // ── Undo toast ───────────────────────────────────────────────────
  // Single most-recent toast. Tapping Undo fires ref_undo_event then
  // removes the row from the events list.
  const [toast, setToast] = useState(null); // { clientEventId, label, expiresAt }
  useEffect(() => {
    if (!toast) return;
    const ms = toast.expiresAt - Date.now();
    if (ms <= 0) { setToast(null); return; }
    const id = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(id);
  }, [toast]);

  // ── Offline queue + connection state ─────────────────────────────
  // Every event tap writes a row to IndexedDB BEFORE the RPC call.
  // On success we delete the row. On failure (offline, transient
  // network) we leave it queued; the drain loop replays on reconnect
  // or next page load. Every ref_* RPC is idempotent on
  // client_event_id, so duplicate replays are server-side no-ops.
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [drainError, setDrainError] = useState(null);
  const drainingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const rows = await queueList(fixture.id);
      setPendingCount(rows.length);
    } catch (err) {
      console.error("[ref] queue list failed", err);
    }
  }, [fixture.id]);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    if (!fixture.id) return;
    drainingRef.current = true;
    try {
      const rows = await queueList(fixture.id);
      for (const row of rows) {
        try {
          await fireQueued(refToken, row);
          await queueDelete(row.client_event_id);
        } catch (err) {
          console.error("[ref] drain row failed", err);
          setDrainError(err?.message || String(err));
          // Stop on first failure — assume transient. The next online
          // event or manual retry will pick up where we left off.
          return;
        }
      }
      setDrainError(null);
      await refreshPendingCount();
      await onRefresh();
    } finally {
      drainingRef.current = false;
    }
  }, [fixture.id, refToken, refreshPendingCount, onRefresh]);

  // Resume on mount: count pending rows + try draining immediately.
  // Covers the page-crash recovery case — open the link again, any
  // unsynced rows from the prior session drain straight away.
  useEffect(() => {
    refreshPendingCount();
    if (typeof navigator === "undefined" || navigator.onLine) drain();
  }, [refreshPendingCount, drain]);

  // Browser online/offline events. The 'online' transition fires a
  // drain attempt automatically.
  useEffect(() => {
    function goOnline()  { setOnline(true); drain(); }
    function goOffline() { setOnline(false); }
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [drain]);

  // Beforeunload guard: warn if anything is still queued. The queue
  // survives a reload (it's in IDB), but a ref accidentally closing
  // the tab mid-match should get a confirm prompt.
  useEffect(() => {
    function beforeUnload(e) {
      if (pendingCount > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [pendingCount]);

  // ── Generic event sender (optimistic + enqueue + try RPC) ────────
  // Always succeeds locally. Network failure leaves the row queued —
  // no error toast on offline, because that's expected.
  const sendEvent = useCallback(async ({ optimistic, kind, args, toastLabel }) => {
    const clientEventId = optimistic.client_event_id;

    setLocalEvents((xs) => [...xs, optimistic]);
    setToast({ clientEventId, label: toastLabel, expiresAt: Date.now() + UNDO_WINDOW_MS });

    try {
      await queueEnqueue({
        client_event_id: clientEventId,
        fixture_id:      fixture.id,
        kind,
        args,
        created_at:      new Date().toISOString(),
      });
    } catch (err) {
      // IDB failure is rare (private-mode Safari, quota exceeded).
      // Surface it — without IDB we can't guarantee durability.
      console.error("[ref] queue enqueue failed", err);
      alert(`Could not save locally: ${err?.message || String(err)}`);
      setLocalEvents((xs) => xs.filter((e) => e.client_event_id !== clientEventId));
      setToast(null);
      return;
    }

    setPendingCount((c) => c + 1);

    try {
      await fireQueued(refToken, { kind, args });
      await queueDelete(clientEventId);
      setPendingCount((c) => Math.max(0, c - 1));
      await onRefresh();
    } catch (err) {
      console.error("[ref] event RPC failed — will retry from queue", err);
      // Leave the row in the queue. drainError gets set by the
      // background drain loop the next time it runs.
    }
  }, [fixture.id, refToken, onRefresh]);

  // ── Handlers ─────────────────────────────────────────────────────
  function teamIdFor(player) {
    if (homeSquad.some((p) => p.id === player.id)) return fixture.home_team_id;
    if (awaySquad.some((p) => p.id === player.id)) return fixture.away_team_id;
    return null;
  }

  function onGoal(player, ownGoal = false) {
    if (period === "HT" || period === "FT") return;
    const clientEventId = crypto.randomUUID();
    const teamId = teamIdFor(player);
    sendEvent({
      optimistic: {
        client_event_id: clientEventId,
        event_type: ownGoal ? "own_goal" : "goal",
        team_id: teamId, player_id: player.id,
        minute: currentMinute, period,
      },
      kind: "goal",
      args: {
        playerId: player.id, minute: currentMinute, period,
        clientEventId, ownGoal,
        localTimestamp: new Date().toISOString(),
      },
      toastLabel: `${ownGoal ? "Own goal" : "Goal"} — ${player.name}`,
    });
  }

  function onCard(player, colour) {
    if (period === "HT" || period === "FT") return;
    if (hasRed(events, player.id) && colour !== "red") return;
    const clientEventId = crypto.randomUUID();
    const teamId = teamIdFor(player);
    sendEvent({
      optimistic: {
        client_event_id: clientEventId,
        event_type: `${colour}_card`,
        team_id: teamId, player_id: player.id,
        minute: currentMinute, period,
      },
      kind: "card",
      args: {
        playerId: player.id, minute: currentMinute, period, colour,
        clientEventId,
        localTimestamp: new Date().toISOString(),
      },
      toastLabel: `${colour === "red" ? "Red" : "Yellow"} — ${player.name}`,
    });
  }

  function handleYellow(player) {
    if (yellowCountFor(events, player.id) >= 1) {
      const ok = window.confirm(`${player.name} already has a yellow. Show red?`);
      if (ok) onCard(player, "red");
      return;
    }
    onCard(player, "yellow");
  }

  // Sub picker state
  const [subPicker, setSubPicker] = useState(null); // { offPlayer, squad }
  function openSubPicker(player) {
    const teamId = teamIdFor(player);
    const squad = teamId === fixture.home_team_id ? homeSquad : awaySquad;
    setSubPicker({ offPlayer: player, squad });
  }
  function chooseSubOn(onPlayer) {
    const offPlayer = subPicker.offPlayer;
    setSubPicker(null);
    if (onPlayer.id === offPlayer.id) return;
    const clientEventId = crypto.randomUUID();
    const teamId = teamIdFor(offPlayer);
    sendEvent({
      optimistic: {
        client_event_id: clientEventId,
        event_type: "substitution",
        team_id: teamId,
        sub_player_on_id: onPlayer.id,
        sub_player_off_id: offPlayer.id,
        minute: currentMinute, period,
      },
      kind: "sub",
      args: {
        onPlayerId: onPlayer.id, offPlayerId: offPlayer.id,
        minute: currentMinute, period,
        clientEventId,
        localTimestamp: new Date().toISOString(),
      },
      toastLabel: `Sub — ${onPlayer.name} on for ${offPlayer.name}`,
    });
  }

  function setPeriodTo(nextPeriod) {
    const clientEventId = crypto.randomUUID();
    sendEvent({
      optimistic: {
        client_event_id: clientEventId,
        event_type: "period_change",
        team_id: fixture.home_team_id,
        minute: currentMinute, period: nextPeriod,
      },
      kind: "period",
      args: { period: nextPeriod, clientEventId, localTimestamp: new Date().toISOString() },
      toastLabel: periodLabel(nextPeriod),
    });
  }

  // Full-time confirm
  const [confirmFT, setConfirmFT] = useState(false);
  const [confirmingFT, setConfirmingFT] = useState(false);
  async function doConfirmFullTime() {
    setConfirmingFT(true);
    try {
      await refConfirmFullTime(refToken);
      await onRefresh();   // App will flip to PreMatch terminal banner
    } catch (err) {
      console.error("[ref] confirm_full_time failed", err);
      alert(`Could not confirm full time: ${err?.message || String(err)}`);
      setConfirmingFT(false);
      setConfirmFT(false);
    }
  }

  async function doUndo() {
    if (!toast) return;
    const cid = toast.clientEventId;
    setLocalEvents((xs) => xs.filter((e) => e.client_event_id !== cid));
    setToast(null);
    try {
      // If the event hasn't synced yet, just remove it from the queue
      // — the server never saw it, no undo RPC needed.
      const stillQueued = await queueIsPending(cid);
      if (stillQueued) {
        await queueDelete(cid);
        setPendingCount((c) => Math.max(0, c - 1));
        return;
      }
      await refUndoEvent(refToken, cid);
      await onRefresh();
    } catch (err) {
      console.error("[ref] undo failed", err);
      alert(`Could not undo: ${err?.message || String(err)}`);
    }
  }

  return (
    <main className="live">
      <div className="live-bar">
        <div className="live-clock">{clockLabel}</div>
        <div className="live-score">
          <span className="live-score-num">{score.home}</span>
          <span className="live-score-sep">–</span>
          <span className="live-score-num">{score.away}</span>
        </div>
        <div className={`live-period live-period-${period.toLowerCase()}`}>{period}</div>
      </div>

      {(pendingCount > 0 || !online) && (
        <div className={`live-offline-banner ${online ? "is-syncing" : "is-offline"}`}>
          <span className="live-offline-dot" />
          <span className="live-offline-label">
            {online
              ? `Syncing · ${pendingCount} event${pendingCount === 1 ? "" : "s"} pending`
              : `Offline · ${pendingCount} event${pendingCount === 1 ? "" : "s"} queued`}
            {drainError ? ` — ${drainError}` : ""}
          </span>
          <button className="live-offline-retry" onClick={drain} disabled={drainingRef.current}>
            Retry
          </button>
        </div>
      )}

      <div className="live-teams">
        <TeamColumn
          team={homeTeam}
          squad={homeSquad}
          side="home"
          period={period}
          events={events}
          onGoal={(p) => onGoal(p, false)}
          onOwnGoal={(p) => onGoal(p, true)}
          onYellow={handleYellow}
          onRed={(p) => onCard(p, "red")}
          onSub={openSubPicker}
        />
        <TeamColumn
          team={awayTeam}
          squad={awaySquad}
          side="away"
          period={period}
          events={events}
          onGoal={(p) => onGoal(p, false)}
          onOwnGoal={(p) => onGoal(p, true)}
          onYellow={handleYellow}
          onRed={(p) => onCard(p, "red")}
          onSub={openSubPicker}
        />
      </div>

      <div className="live-period-actions">
        {period === "1H" && (
          <button className="btn-ghost" onClick={() => setPeriodTo("HT")}>Half Time</button>
        )}
        {period === "HT" && (
          <button className="btn-primary" onClick={() => setPeriodTo("2H")}>Start 2H</button>
        )}
        {(period === "2H" || period === "ET1" || period === "ET2" || period === "PEN") && (
          <button className="btn-primary live-ft-btn" onClick={() => setConfirmFT(true)}>Full Time</button>
        )}
      </div>

      {toast && (
        <div className="live-toast">
          <span className="live-toast-label">{toast.label}</span>
          <button className="live-toast-undo" onClick={doUndo}>Undo</button>
        </div>
      )}

      {subPicker && (
        <div className="live-overlay" onClick={() => setSubPicker(null)}>
          <div className="live-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Sub OFF: {subPicker.offPlayer.name}</h2>
            <p className="muted">Pick who comes ON:</p>
            <ul className="live-sub-list">
              {subPicker.squad
                .filter((p) => p.id !== subPicker.offPlayer.id)
                .map((p) => (
                  <li key={p.id}>
                    <button className="live-sub-row" onClick={() => chooseSubOn(p)}>
                      {p.shirt_number != null && <span className="squad-shirt">{p.shirt_number}</span>}
                      <span>{p.name}</span>
                    </button>
                  </li>
                ))}
            </ul>
            <button className="btn-ghost" onClick={() => setSubPicker(null)}>Cancel</button>
          </div>
        </div>
      )}

      {confirmFT && (
        <div className="live-overlay">
          <div className="live-modal">
            <h2>Confirm full time?</h2>
            <p className="muted">
              Final score: <strong>{homeTeam.name} {score.home} – {score.away} {awayTeam.name}</strong>.
              Once confirmed you can&apos;t add more events; the venue admin can correct the result if needed.
            </p>
            <div className="live-modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmFT(false)} disabled={confirmingFT}>Cancel</button>
              <button className="btn-primary" onClick={doConfirmFullTime} disabled={confirmingFT}>
                {confirmingFT ? "Confirming…" : "Confirm full time"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TeamColumn({ team, squad, side, period, events, onGoal, onOwnGoal, onYellow, onRed, onSub }) {
  const locked = period === "HT" || period === "FT";
  return (
    <section className="live-team">
      <header className="live-team-head">
        <span className="squad-swatch" style={{ background: team?.primary_colour || "var(--surface-2)" }} />
        <span className="live-team-name">{team?.name || (side === "home" ? "Home" : "Away")}</span>
      </header>
      {squad.length === 0 ? (
        <div className="squad-empty">No confirmed squad</div>
      ) : (
        <ul className="live-player-list">
          {squad.map((p) => {
            const goalsFor = events.filter((e) => e.event_type === "goal" && e.player_id === p.id).length;
            const ownGoals = events.filter((e) => e.event_type === "own_goal" && e.player_id === p.id).length;
            const yellows  = yellowCountFor(events, p.id);
            const reds     = hasRed(events, p.id);
            return (
              <li key={p.id} className="live-player-row">
                <div className="live-player-id">
                  {p.shirt_number != null
                    ? <span className="squad-shirt">{p.shirt_number}</span>
                    : <span className="squad-shirt-blank">—</span>}
                  <span className="live-player-name">{p.name}</span>
                  <span className="live-player-badges">
                    {goalsFor > 0 && <span className="badge badge-goal">⚽{goalsFor > 1 ? `×${goalsFor}` : ""}</span>}
                    {ownGoals > 0 && <span className="badge badge-og">OG</span>}
                    {yellows > 0 && !reds && <span className="badge badge-yellow">🟨{yellows > 1 ? `×${yellows}` : ""}</span>}
                    {reds && <span className="badge badge-red">🟥</span>}
                  </span>
                </div>
                <div className="live-player-actions">
                  <GoalButton onTap={() => onGoal(p)} onLongPress={() => onOwnGoal(p)} disabled={locked} />
                  <button className="live-act" disabled={locked} onClick={() => onYellow(p)} aria-label="Yellow card">🟨</button>
                  <button className="live-act" disabled={locked || reds} onClick={() => onRed(p)} aria-label="Red card">🟥</button>
                  <button className="live-act" disabled={locked} onClick={() => onSub(p)} aria-label="Substitution">↕️</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function GoalButton({ onTap, onLongPress, disabled }) {
  const timerRef = useRef(null);
  const firedLongRef = useRef(false);

  function down() {
    if (disabled) return;
    firedLongRef.current = false;
    timerRef.current = setTimeout(() => {
      firedLongRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }
  function up() {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!firedLongRef.current) onTap();
  }
  function cancel() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  return (
    <button
      className="live-act live-act-goal"
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      aria-label="Goal (long-press for own goal)"
    >
      ⚽
    </button>
  );
}

function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function periodLabel(p) {
  if (p === "HT") return "Half time";
  if (p === "2H") return "Second half";
  if (p === "ET1") return "Extra time (1st)";
  if (p === "ET2") return "Extra time (2nd)";
  if (p === "PEN") return "Penalties";
  return p;
}
