import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Shuffle, FloppyDisk, CheckCircle, Trash } from "@phosphor-icons/react";
import {
  saveTeamsDraft, confirmTeams,
  generateBalancedTeams,
  setPlayerGroup, clearAllGroups, saveGroupLabels,
} from "@platform/core";

const ENABLE_SMART_RANDOM = false;
// V2 — weighted random by IO Intelligence win rate + form
// Set to true when Phase 2 balance algorithm is ready

// Group Balancer thresholds passed to generateBalancedTeams for disclaimer
// level. Both are tunable as real data accumulates. See GROUP_BALANCER.md.
const MIN_TEAM_GAMES         = 30;
const MIN_AVG_PLAYER_GAMES   = 8;

function PentagonBadge({ number }) {
  return (
    <div style={{ position: "relative", width: 24, height: 28, flexShrink: 0 }}>
      <svg viewBox="0 0 54 60" width={24} height={28}>
        <path d="M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"
          style={{ fill: "var(--s3)" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, color: "var(--t2)",
        paddingBottom: 2,
      }}>
        {number}
      </div>
    </div>
  );
}

export default function TeamsScreen({
  teamId, adminToken = null, squad, schedule, matchHistory,
  tableData = { players: [] },
  settings = null,
  onBack,
}) {
  const matchId = schedule?.activeMatchId ||
    matchHistory?.find(m => !m.cancelled && !m.winner)?.id ||
    matchHistory?.find(m => !m.cancelled)?.id ||
    null;

  const [assignments, setAssignments] = useState({});
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmNudge, setConfirmNudge] = useState(false);
  const [teamsConfirmed, setTeamsConfirmed] = useState(false);
  const [error, setError] = useState(null);

  // ── Group Balancer state ────────────────────────────────────────────────
  // localGroups: { [playerId]: 1..5 | null }
  // Initialised additively from squad.groupNumber; never overwrites existing
  // entries (admin can stage changes locally before saving).
  const [localGroups,          setLocalGroups]          = useState({});
  const [groupLabels,          setGroupLabels]          = useState({});
  const [editingLabel,         setEditingLabel]         = useState(null);
  const [selectedPlayerId,     setSelectedPlayerId]     = useState(null);
  const [groupsCollapsed,      setGroupsCollapsed]      = useState(false);
  const [showClearGroupsConfirm, setShowClearGroupsConfirm] = useState(false);
  const [prediction,           setPrediction]           = useState(null);
  const [showNeedsGroupWarning,setShowNeedsGroupWarning]= useState(false);
  const [manuallyAdjusted,     setManuallyAdjusted]     = useState(false);

  const hasHydrated = useRef(false);
  const teamsConfirmedRef = useRef(false);
  const confirmedThisSession = useRef(false);
  // Players present at mount — anyone added to the squad later gets a "NEW"
  // badge in the Needs Group panel until assigned.
  const mountedPlayerIds = useRef(null);

  // ── Feature flag: Group Balancer ──────────────────────────────────────
  // PostHog-controlled. Defaults to OFF so existing Fisher-Yates behaviour
  // is preserved. Enable per-team in PostHog dashboard during rollout.
  const groupBalancerEnabled = useMemo(
    () => Boolean(window.posthog?.isFeatureEnabled?.('group_balancer')),
    []
  );

  // On mount — hydrate from existing match data
  useEffect(() => {
    if (!matchId || !matchHistory) return;
    const match = matchHistory.find(m => m.id === matchId);
    if (!match) return;

    if (match.teamsDraft && (match.teamsDraft.a?.length || match.teamsDraft.b?.length)) {
      const built = {};
      (match.teamsDraft.a || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "A"; });
      (match.teamsDraft.b || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "B"; });
      setAssignments(built);
    } else if (match.teamA?.length || match.teamB?.length) {
      const built = {};
      (match.teamA || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "A"; });
      (match.teamB || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "B"; });
      setAssignments(built);
      setTeamsConfirmed(true);
      teamsConfirmedRef.current = true;
    }
    hasHydrated.current = true;
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasHydrated.current) return;
    if (!squad?.length) return;
    const built = {};
    squad.forEach(p => {
      if (p.team === 'A' || p.team === 'B') {
        built[p.id] = p.team;
      }
    });
    const hasTeams = Object.keys(built).length > 0;
    if (hasTeams) {
      setAssignments(built);
      setTeamsConfirmed(true);
      teamsConfirmedRef.current = true;
    } else if (!confirmedThisSession.current) {
      setAssignments({});
    }
  }, [squad]); // eslint-disable-line react-hooks/exhaustive-deps

  const inPlayers = useMemo(() => {
    return (squad || [])
      .filter(p =>
        p.status === "in" &&
        !p.injured &&
        !p.disabled
      )
      .sort((a, b) => {
        const na = (a.nickname || a.name).toLowerCase();
        const nb = (b.nickname || b.name).toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
      });
  }, [squad]);

  // ── Group Balancer: derived ─────────────────────────────────────────────
  // Same filter as inPlayers — guests included (decision A). The Group
  // Balancer treats this as its working population for generation and panel
  // rendering. Reads groupNumber from squad on first load and from
  // localGroups thereafter.
  const inPlayersForGroups = useMemo(
    () => inPlayers,
    [inPlayers]
  );

  // ── Group Balancer: effects ─────────────────────────────────────────────

  // Init localGroups from squad. Additive: never overwrites existing entries
  // — the admin can stage group changes locally and they survive squad-prop
  // refreshes from realtime updates.
  useEffect(() => {
    setLocalGroups(prev => {
      const next = { ...prev };
      (squad || []).forEach(p => {
        if (!(p.id in next)) {
          next[p.id] = p.groupNumber ?? null;
        }
      });
      return next;
    });
  }, [squad]);

  // Init groupLabels from settings. Replaces local state when settings
  // refresh — the server is the source of truth for labels.
  useEffect(() => {
    setGroupLabels(settings?.groupLabels ?? {});
  }, [settings]);

  // Mount-only: capture initial player set + decide whether to start
  // collapsed (everyone already grouped → start collapsed).
  useEffect(() => {
    const eligible = (squad || []).filter(p =>
      p.status === 'in' && !p.injured && !p.disabled
    );
    const allGrouped = eligible.length > 0
      && eligible.every(p => (p.groupNumber ?? null) !== null);
    setGroupsCollapsed(allGrouped);
    mountedPlayerIds.current = new Set(eligible.map(p => p.id));
  }, []); // mount only — intentionally empty deps

  const countA = Object.values(assignments).filter(v => v === "A").length;
  const countB = Object.values(assignments).filter(v => v === "B").length;
  const allAssigned = inPlayers.length > 0 && inPlayers.every(p => assignments[p.id] === "A" || assignments[p.id] === "B");
  const teamAIds = inPlayers.filter(p => assignments[p.id] === "A").map(p => p.id);
  const teamBIds = inPlayers.filter(p => assignments[p.id] === "B").map(p => p.id);

  const clearError = () => setError(null);

  const handleAssign = useCallback((playerId, team) => {
    clearError();
    setAssignments(prev => ({
      ...prev,
      [playerId]: prev[playerId] === team ? null : team,
    }));
    setDraftSaved(false);
    setTeamsConfirmed(false);
    teamsConfirmedRef.current = false;
    confirmedThisSession.current = false;
  }, []);

  // ── Group Balancer: handlers ────────────────────────────────────────────

  // Tap-to-move primitive: tapping a chip selects/deselects it for assignment.
  const handleChipTap = useCallback((playerId) => {
    setSelectedPlayerId(prev => prev === playerId ? null : playerId);
  }, []);

  // Commit a player → group assignment with optimistic UI + revert on error.
  // groupNumber is 1–5 or null (Needs Group). RPC writes audit_events.
  const handleSetGroup = useCallback(async (playerId, groupNumber) => {
    const prev = localGroups[playerId] ?? null;
    setLocalGroups(g => ({ ...g, [playerId]: groupNumber }));
    setSelectedPlayerId(null);
    window.posthog?.capture('group_assigned', {
      group: groupNumber ?? 'needs_group',
    });
    try {
      await setPlayerGroup(adminToken, playerId, groupNumber);
    } catch (e) {
      console.error('handleSetGroup error:', e);
      setLocalGroups(g => ({ ...g, [playerId]: prev }));
      setError('Failed to save group — try again');
    }
  }, [localGroups, adminToken]);

  // Tap a group panel while a chip is selected → commits the move.
  const handlePanelTap = useCallback((groupNumber) => {
    if (!selectedPlayerId) return;
    handleSetGroup(selectedPlayerId, groupNumber);
  }, [selectedPlayerId, handleSetGroup]);

  // Inline label editing on group panels. Empty string clears the label.
  const handleSetLabel = useCallback(async (groupNumber, label) => {
    const trimmed = label.trim() || null;
    const prev = groupLabels;
    const next = trimmed
      ? { ...groupLabels, [String(groupNumber)]: trimmed }
      : Object.fromEntries(
          Object.entries(groupLabels)
            .filter(([k]) => k !== String(groupNumber))
        );
    setGroupLabels(next);
    setEditingLabel(null);
    try {
      // saveGroupLabels reuses admin_upsert_settings which requires group_name.
      // settings?.groupName is always populated post-onboarding.
      await saveGroupLabels(adminToken, settings?.groupName ?? '', next);
    } catch (e) {
      console.error('handleSetLabel error:', e);
      setGroupLabels(prev);
      setError('Failed to save label — try again');
    }
  }, [groupLabels, adminToken, settings?.groupName]);

  // Clears every group assignment server-side and locally.
  const handleClearAllGroups = useCallback(async () => {
    const prev = localGroups;
    const cleared = Object.fromEntries(
      Object.entries(localGroups).map(([id]) => [id, null])
    );
    setLocalGroups(cleared);
    setShowClearGroupsConfirm(false);
    try {
      await clearAllGroups(adminToken);
    } catch (e) {
      console.error('handleClearAllGroups error:', e);
      setLocalGroups(prev);
      setError('Failed to clear groups — try again');
    }
  }, [localGroups, adminToken]);

  // The flag-on Generate path. Replaces Fisher-Yates with the balanced
  // algorithm and stores the prediction for confirmTeams to persist.
  const handleGenerate = useCallback(() => {
    clearError();

    const needsGroupCount = inPlayersForGroups.filter(
      p => (localGroups[p.id] ?? null) === null
    ).length;

    // Friction step: every Generate with ungrouped players shows the
    // warning. Tapping Generate Anyway re-fires this handler with the
    // warning state set, which proceeds past the gate.
    if (needsGroupCount > 0 && !showNeedsGroupWarning) {
      setShowNeedsGroupWarning(true);
      return;
    }
    setShowNeedsGroupWarning(false);
    setManuallyAdjusted(false);

    const playersWithGroups = inPlayersForGroups.map(p => ({
      ...p,
      groupNumber: localGroups[p.id] ?? null,
    }));

    const completedGames = (matchHistory ?? [])
      .filter(m => !m.cancelled && m.winner)
      .length;

    const result = generateBalancedTeams(playersWithGroups, tableData, {
      teamGames: completedGames,
      MIN_TEAM_GAMES,
      MIN_AVG_PLAYER_GAMES,
    });

    const built = {};
    result.teamA.forEach(id => { built[id] = 'A'; });
    result.teamB.forEach(id => { built[id] = 'B'; });
    setAssignments(built);
    setPrediction({
      winner:          result.predictedWinner,
      confidence:      result.predictedConfidence,
      balanceScore:    result.balanceScore,
      avgGamesPlayed:  result.avgGamesPlayed,
      disclaimerLevel: result.disclaimerLevel,
    });
    setDraftSaved(false);
    setTeamsConfirmed(false);
    teamsConfirmedRef.current = false;
    confirmedThisSession.current = false;

    window.posthog?.capture('group_balancer_generate', {
      groupCount:       Object.values(localGroups)
                          .filter(g => g !== null).length,
      needsGroupCount,
      totalIn:          inPlayersForGroups.length,
    });
    if (showNeedsGroupWarning) {
      window.posthog?.capture('group_balancer_needs_group_confirmed');
    }
  }, [
    inPlayersForGroups, localGroups, matchHistory, tableData,
    showNeedsGroupWarning,
  ]);

  const handleRandom = useCallback(() => {
    clearError();
    const pool = [...inPlayers];
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const half = Math.floor(pool.length / 2);
    // Odd number: extra player goes to A
    const built = {};
    pool.forEach((p, i) => { built[p.id] = i < pool.length - half ? "A" : "B"; });
    setAssignments(built);
    setDraftSaved(false);
    setTeamsConfirmed(false);
    teamsConfirmedRef.current = false;
    confirmedThisSession.current = false;
  }, [inPlayers]);

  const handleSaveDraft = useCallback(async () => {
    if (isSavingDraft) return;
    clearError();
    setIsSavingDraft(true);
    try {
      await saveTeamsDraft(adminToken, matchId, teamAIds, teamBIds);
      setDraftSaved(true);
      setDraftSavedAt(new Date());
    } catch (e) {
      console.error("handleSaveDraft error:", e);
      setError("Failed to save draft — try again");
    }
    setIsSavingDraft(false);
  }, [isSavingDraft, adminToken, matchId, teamAIds, teamBIds]);

  const handleConfirm = useCallback(async () => {
    clearError();
    if (!allAssigned) {
      setConfirmNudge(true);
      setTimeout(() => setConfirmNudge(false), 3000);
      return;
    }
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      await confirmTeams(
        adminToken, matchId, teamAIds, teamBIds,
        prediction?.winner       ?? null,
        prediction?.confidence   ?? null,
        prediction?.balanceScore ?? null,
      );
      setTeamsConfirmed(true);
      teamsConfirmedRef.current = true;
      confirmedThisSession.current = true;
      setDraftSaved(false);

      // Fire teamsConfirmed push — fire and forget, IN players only
      const inPlayerIds = inPlayers.map(p => p.id);
      if (inPlayerIds.length) {
        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "teamsConfirmed",
            teamId,
            playerIds: inPlayerIds,
            payload: {
              title: "Teams are in ⚽",
              body: "Check which team you're on for tonight.",
              icon: "/icons/icon-192.png",
            },
          }),
        }).catch(console.error);
      }
    } catch (e) {
      console.error("handleConfirm error:", e);
      setError("Failed to confirm teams — try again");
    }
    setIsConfirming(false);
  }, [allAssigned, isConfirming, adminToken, matchId, teamAIds, teamBIds, inPlayers, prediction]);

  const handleClear = useCallback(() => {
    clearError();
    setShowClearConfirm(true);
  }, []);

  const handleClearConfirm = useCallback(async () => {
    setAssignments({});
    setDraftSaved(false);
    setTeamsConfirmed(false);
    teamsConfirmedRef.current = false;
    confirmedThisSession.current = false;
    setShowClearConfirm(false);
    setPrediction(null);
    setManuallyAdjusted(false);
    try {
      await confirmTeams(adminToken, matchId, [], []);
    } catch (e) {
      console.error("handleClearConfirm error:", e);
    }
  }, [adminToken, matchId]);

  const handleClearCancel = useCallback(() => {
    setShowClearConfirm(false);
  }, []);

  const formatTime = (date) => {
    if (!date) return "";
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  };

  // Empty state
  if (!matchId) {
    return (
      <div style={{ padding: "20px 16px" }}>
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          color: "var(--gold)", fontSize: 13, fontFamily: "DM Sans, sans-serif",
          fontWeight: 400, padding: 0, marginBottom: 24,
        }}>
          <ArrowLeft size={16} weight="thin" />
          Back to Admin
        </button>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 32,
          color: "var(--t1)", marginBottom: 8,
        }}>
          No active match
        </div>
        <div style={{ fontSize: 14, color: "var(--t2)", fontWeight: 400 }}>
          Go live first before picking teams
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px" }}>

      {/* Back link */}
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "none", border: "none", cursor: "pointer",
        color: "var(--gold)", fontSize: 13, fontFamily: "DM Sans, sans-serif",
        fontWeight: 400, padding: 0, marginBottom: 20,
      }}>
        <ArrowLeft size={16} weight="thin" />
        Back to Admin
      </button>

      {/* Heading */}
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 32,
        color: "var(--t1)", marginBottom: 16,
      }}>
        TEAM SELECTION
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>

        {/* Random Generator */}
        <button onClick={handleRandom} style={{
          flex: 1, height: 40, borderRadius: 8, border: "0.5px solid var(--purpleb)",
          background: "var(--purple2)", color: "var(--purple)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 1,
          cursor: "pointer",
        }}>
          <Shuffle size={16} weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, lineHeight: 1 }}>
            RANDOM
          </span>
        </button>

        {/* Save Draft */}
        <button onClick={handleSaveDraft} style={{
          flex: 1, height: 40, borderRadius: 8,
          background: "transparent", border: "0.5px solid var(--gold)",
          color: "var(--gold)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 1,
          cursor: isSavingDraft ? "default" : "pointer",
          opacity: isSavingDraft ? 0.6 : 1,
          pointerEvents: isSavingDraft ? "none" : "auto",
        }}>
          <FloppyDisk size={16} weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, lineHeight: 1 }}>
            SAVE DRAFT
          </span>
        </button>

        {/* Confirm Teams */}
        <button onClick={handleConfirm} style={{
          flex: 1, height: 40, borderRadius: 8, border: "0.5px solid var(--greenb)",
          background: "var(--green2)", color: "var(--green)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 1,
          cursor: isConfirming ? "default" : "pointer",
          opacity: isConfirming ? 0.6 : allAssigned ? 1 : 0.4,
          pointerEvents: isConfirming ? "none" : "auto",
        }}>
          <CheckCircle size={16} weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, lineHeight: 1 }}>
            CONFIRM
          </span>
        </button>
      </div>

      {/* Confirm nudge */}
      {confirmNudge && (
        <div style={{
          textAlign: "center", color: "var(--amber)",
          fontSize: 12, fontWeight: 400, marginTop: 8,
        }}>
          Assign all players before confirming
        </div>
      )}

      {/* Teams confirmed success state */}
      {teamsConfirmed && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--green2)", border: "0.5px solid var(--greenb)",
          borderRadius: 8, padding: 12, marginTop: 8,
        }}>
          <CheckCircle size={16} weight="thin" color="var(--green)" style={{ flexShrink: 0 }} />
          <span style={{
            fontSize: 13, color: "var(--green)", fontWeight: 400,
          }}>
            Teams confirmed and shared with players
          </span>
        </div>
      )}

      {/* Clear Teams / Clear confirm */}
      <div style={{ marginTop: 8 }}>
        {showClearConfirm ? (
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: 12, color: "var(--t2)", fontWeight: 400, marginBottom: 10,
            }}>
              This clears all assignments — are you sure?
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={handleClearConfirm} style={{
                height: 36, padding: "0 20px", borderRadius: 8,
                background: "transparent", border: "0.5px solid var(--red)",
                color: "var(--red)", cursor: "pointer",
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 14,
              }}>
                CONFIRM
              </button>
              <button onClick={handleClearCancel} style={{
                height: 36, padding: "0 20px", borderRadius: 8,
                background: "var(--s3)", border: "none",
                color: "var(--t2)", cursor: "pointer",
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 14,
              }}>
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <button onClick={handleClear} style={{
            width: "100%", height: 40, borderRadius: 8,
            background: "var(--red2)", border: "0.5px solid var(--redb)",
            color: "var(--red)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <Trash size={16} weight="thin" />
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.08em",
            }}>
              CLEAR TEAMS
            </span>
          </button>
        )}
      </div>

      {/* Draft status line */}
      {draftSaved && !teamsConfirmed && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          marginTop: 10,
        }}>
          <CheckCircle size={14} weight="thin" color="var(--green)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--t2)", fontWeight: 400 }}>
            Draft saved at {formatTime(draftSavedAt)} — not shared yet
          </span>
        </div>
      )}

      {/* Error line */}
      {error && (
        <div style={{
          fontSize: 12, color: "var(--red)", fontWeight: 400, marginTop: 8,
        }}>
          {error}
        </div>
      )}

      {/* Team A / VS / Team B split card */}
      <div style={{
        width: "100%", height: 48,
        display: "flex", marginTop: 16, marginBottom: 16,
      }}>
        {/* Team A — left half */}
        <div style={{
          flex: 1,
          background: "rgba(96,160,255,0.12)",
          borderTop: "1px solid #60A0FF",
          borderBottom: "1px solid #60A0FF",
          borderLeft: "1px solid #60A0FF",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
            color: "#60A0FF", letterSpacing: "0.08em",
          }}>TEAM A</span>
          <span style={{ color: "var(--t2)", opacity: 0.4, fontSize: 16, lineHeight: 1 }}>·</span>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: "var(--t1)",
          }}>{countA}</span>
        </div>

        {/* VS centre */}
        <div style={{
          width: 40, flexShrink: 0,
          background: "var(--s2)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          borderLeft: "none", borderRight: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
            color: "var(--t2)",
          }}>VS</span>
        </div>

        {/* Team B — right half */}
        <div style={{
          flex: 1,
          background: "rgba(255,96,96,0.12)",
          borderTop: "1px solid #FF6060",
          borderBottom: "1px solid #FF6060",
          borderRight: "1px solid #FF6060",
          borderLeft: "none",
          borderRadius: "0 6px 6px 0",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: "var(--t1)",
          }}>{countB}</span>
          <span style={{ color: "var(--t2)", opacity: 0.4, fontSize: 16, lineHeight: 1 }}>·</span>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
            color: "#FF6060", letterSpacing: "0.08em",
          }}>TEAM B</span>
        </div>
      </div>

      {/* Player rows section heading */}
      <div style={{
        fontFamily: "DM Sans, sans-serif", fontWeight: 500, fontSize: 11,
        color: "var(--t2)", letterSpacing: "0.1em",
        marginBottom: 8,
      }}>
        PLAYERS ({inPlayers.length})
      </div>

      {/* Player rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {inPlayers.map((p, idx) => {
          const aSelected = assignments[p.id] === "A";
          const bSelected = assignments[p.id] === "B";
          return (
            <div key={p.id} style={{
              background: "var(--s2)", borderRadius: 8, padding: "8px 12px",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              {/* Pentagon badge */}
              <PentagonBadge number={idx + 1} />

              {/* Name */}
              <div style={{
                flex: 1, fontSize: 15, color: "var(--t1)",
                fontFamily: "DM Sans, sans-serif", fontWeight: 500,
              }}>
                {p.nickname || p.name}
              </div>

              {/* A / B buttons */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => handleAssign(p.id, "A")}
                  style={{
                    width: 36, height: 26, borderRadius: 4,
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, fontWeight: 700,
                    cursor: "pointer",
                    background: aSelected ? "rgba(96,160,255,0.15)" : "var(--s3)",
                    color: "#60A0FF",
                    border: aSelected ? "1px solid #60A0FF" : "1px solid rgba(96,160,255,0.3)",
                  }}
                >
                  A
                </button>
                <button
                  onClick={() => handleAssign(p.id, "B")}
                  style={{
                    width: 36, height: 26, borderRadius: 4,
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, fontWeight: 700,
                    cursor: "pointer",
                    background: bSelected ? "rgba(255,96,96,0.15)" : "var(--s3)",
                    color: "#FF6060",
                    border: bSelected ? "1px solid #FF6060" : "1px solid rgba(255,96,96,0.3)",
                  }}
                >
                  B
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {inPlayers.length === 0 && (
        <div style={{
          textAlign: "center", fontSize: 13, color: "var(--t2)",
          fontWeight: 400, padding: "24px 0",
        }}>
          No confirmed players yet
        </div>
      )}

      {/* Done button */}
      <div style={{ marginTop: 24, marginBottom: 16 }}>
        <button onClick={onBack} style={{
          width: "100%", height: 48, borderRadius: 8,
          background: "var(--s2)", border: "0.5px solid var(--goldb)",
          color: "var(--gold)", cursor: "pointer",
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.08em",
        }}>
          DONE
        </button>
      </div>

    </div>
  );
}
