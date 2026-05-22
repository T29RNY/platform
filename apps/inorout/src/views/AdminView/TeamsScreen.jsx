import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft, Shuffle, FloppyDisk, CheckCircle, Trash,
  CaretUp, CaretDown, Plus, X as XIcon,
} from "@phosphor-icons/react";
import {
  saveTeamsDraft, confirmTeams,
  generateBalancedTeams,
  setPlayerGroup, clearAllGroups, saveGroupLabels,
} from "@platform/core";

// Group Balancer thresholds passed to generateBalancedTeams for disclaimer
// level. Both are tunable as real data accumulates. See GROUP_BALANCER.md.
const MIN_TEAM_GAMES         = 30;
const MIN_AVG_PLAYER_GAMES   = 8;

// Group panel visual styling. `border` is just the colour — composed at the
// call site with the width/style ("0.5px solid X"). #60A0FF / #FF6060 are
// the only hardcoded hex literals permitted across the codebase (Team A/B
// brand colours) and are reused here for visual continuity.
const GROUP_STYLES = {
  1:    { border: "#60A0FF",        bg: "rgba(96,160,255,0.08)" },
  2:    { border: "var(--purple)",  bg: "rgba(176,96,240,0.08)" },
  3:    { border: "var(--green)",   bg: "rgba(61,220,106,0.08)"  },
  4:    { border: "var(--amber)",   bg: "rgba(255,176,32,0.08)"  },
  5:    { border: "var(--red)",     bg: "rgba(255,64,64,0.08)"   },
  null: { border: "var(--amber)",   bg: "var(--amber2)"          },
};

// Recompute just the prediction (winner/confidence/balanceScore) from a
// teamA/teamB split + tableData. Same maths as STEP 6 inside
// generateBalancedTeams but on its own so manual moves can refresh the
// chip without re-running the algorithm. Caller preserves the
// avgGamesPlayed and disclaimerLevel from the previous prediction —
// those don't change with team swaps.
function computePrediction(teamAIds, teamBIds, tableData) {
  const winRateMap = {};
  for (const row of (tableData?.players ?? [])) {
    const usable = (row.played ?? 0) >= 3 && row.ranked !== false;
    winRateMap[row.playerId] = usable ? (row.winRate / 100) : null;
  }
  const mean = (arr) => {
    const ok = arr.filter(v => v !== null);
    return ok.length === 0 ? null : ok.reduce((s, v) => s + v, 0) / ok.length;
  };
  const avgA = mean(teamAIds.map(id => winRateMap[id] ?? null)) ?? 0.5;
  const avgB = mean(teamBIds.map(id => winRateMap[id] ?? null)) ?? 0.5;
  const signedDelta = avgA - avgB;
  const absDelta    = Math.abs(signedDelta);
  let winner;
  if (absDelta < 0.05)    winner = "draw";
  else if (signedDelta > 0) winner = "A";
  else                      winner = "B";
  return { winner, confidence: absDelta, balanceScore: absDelta };
}

// Single-line IO Prediction chip. absDelta is 0.0–1.0.
function predictionChipText(winner, absDelta) {
  if (winner === "draw")  return "Even game";
  const side = `Team ${winner}`;
  if (absDelta >= 0.30)   return `${side} strong favourites`;
  if (absDelta >= 0.15)   return `${side} favoured`;
  return `Slight edge to ${side}`;
}

// LiveBoard — two-column A | B grid showing player chips, designed to
// echo PlayerView's confirmed-teams tile. Selection is admin-only and
// shared with the SMART panel via `selectedPlayerId`. The whole tile is
// the primary surface for moving players between teams.
function LiveBoard({
  teamAPlayers, teamBPlayers,
  selectedPlayerId, onChipTap, onColumnTap,
}) {
  const renderChip = (p, color, avBg, avBorder) => {
    const isSelected = selectedPlayerId === p.id;
    const isDimmed   = selectedPlayerId && !isSelected;
    const parts = ((p.nickname || p.name) || "").trim().split(/\s+/);
    const ini = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : ((p.nickname || p.name) || "?").slice(0, 2).toUpperCase();
    return (
      <div
        key={p.id}
        onClick={(e) => { e.stopPropagation(); onChipTap(p.id); }}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 14px",
          background: isSelected ? "var(--gold2)" : "transparent",
          opacity: isDimmed ? 0.5 : 1,
          cursor: "pointer",
          transition: "opacity 0.1s, background 0.1s",
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 600, flexShrink: 0,
          background: isSelected ? "var(--gold2)" : avBg,
          border:     `0.5px solid ${isSelected ? "var(--goldb)" : avBorder}`,
          color:      isSelected ? "var(--gold)" : color,
          boxShadow:  isSelected ? "0 0 8px rgba(232,160,32,0.2)" : "none",
        }}>
          {ini}
        </div>
        <span style={{
          fontSize: 12, color: "var(--t1)", fontWeight: 400,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.nickname || p.name}
        </span>
      </div>
    );
  };

  return (
    <div style={{
      borderRadius: "var(--rs)", overflow: "hidden",
      border: "0.5px solid rgba(61,220,106,0.35)",
      background: "linear-gradient(135deg,rgba(61,220,106,0.18) 0%,rgba(61,220,106,0.05) 45%,rgba(10,10,8,0.6) 100%)",
      marginTop: 16, marginBottom: 12,
    }}>
      {/* Header row — counts */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{
          padding: "8px 14px", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase",
          color: "#60A0FF",
          display: "flex", alignItems: "center", gap: 6,
          borderRight: "0.5px solid rgba(255,255,255,0.06)",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#60A0FF",
            boxShadow: "0 0 6px rgba(96,160,255,0.5)", flexShrink: 0,
          }} />
          Team A · {teamAPlayers.length}
        </div>
        <div style={{
          padding: "8px 14px", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase",
          color: "#FF6060",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#FF6060",
            boxShadow: "0 0 6px rgba(255,96,96,0.5)", flexShrink: 0,
          }} />
          Team B · {teamBPlayers.length}
        </div>
      </div>

      {/* Body — two-column tap targets */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 80 }}>
        <div
          onClick={(e) => { if (e.target === e.currentTarget) onColumnTap("A"); }}
          style={{
            borderRight: "0.5px solid rgba(255,255,255,0.06)",
            paddingTop: 8, paddingBottom: 8,
            cursor: selectedPlayerId ? "pointer" : "default",
          }}
        >
          {teamAPlayers.map(p =>
            renderChip(p, "#60A0FF", "rgba(96,160,255,0.15)", "rgba(96,160,255,0.4)")
          )}
          {teamAPlayers.length === 0 && (
            <div style={{
              padding: "16px 14px", fontSize: 11, color: "var(--t2)",
              fontStyle: "italic", opacity: 0.6, textAlign: "center",
            }}>
              tap here to add
            </div>
          )}
        </div>
        <div
          onClick={(e) => { if (e.target === e.currentTarget) onColumnTap("B"); }}
          style={{
            paddingTop: 8, paddingBottom: 8,
            cursor: selectedPlayerId ? "pointer" : "default",
          }}
        >
          {teamBPlayers.map(p =>
            renderChip(p, "#FF6060", "rgba(255,96,96,0.15)", "rgba(255,96,96,0.4)")
          )}
          {teamBPlayers.length === 0 && (
            <div style={{
              padding: "16px 14px", fontSize: 11, color: "var(--t2)",
              fontStyle: "italic", opacity: 0.6, textAlign: "center",
            }}>
              tap here to add
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Player chip used inside group panels. Tap to select for assignment; tap
// again or tap outside to deselect.
function PlayerChip({ player, selected, dimmed, isNew, onTap }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onTap(player.id); }}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 8px", borderRadius: 8,
        background: selected ? "var(--gold2)" : "var(--s2)",
        border: selected
          ? "0.5px solid var(--gold)"
          : "0.5px solid rgba(255,255,255,0.08)",
        opacity: dimmed ? 0.5 : 1,
        cursor: "pointer",
        transition: "opacity 0.1s, border 0.1s, background 0.1s",
      }}
    >
      <div style={{
        width: 24, height: 24, borderRadius: "50%",
        background: "var(--s3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 9, color: "var(--t2)",
        fontFamily: "'Bebas Neue', sans-serif",
        flexShrink: 0,
      }}>
        {(player.nickname || player.name || "?")
          .split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
      </div>
      <span style={{
        fontSize: 12, color: "var(--t1)",
        fontFamily: "'DM Sans', sans-serif", fontWeight: 400,
      }}>
        {player.nickname || player.name}
      </span>
      {isNew && (
        <span style={{
          fontSize: 8, color: "var(--amber)",
          fontFamily: "'Bebas Neue', sans-serif",
          letterSpacing: "0.05em",
        }}>NEW</span>
      )}
    </div>
  );
}

// One group panel — Needs Group (groupNumber=null) or numbered 1–5.
// Tap the panel body when a chip is selected to commit the move.
function GroupPanel({
  groupNumber, label, players,
  selectedPlayerId, mountedPlayerIds,
  onChipTap, onPanelTap,
  isReceiving,
  isEditingLabel, onLabelTap, onLabelSave,
  canRemove, onRemove,
}) {
  const isNeedsGroup = groupNumber === null;
  const style = GROUP_STYLES[groupNumber] ?? GROUP_STYLES.null;

  return (
    <div
      onClick={onPanelTap}
      style={{
        background: style.bg,
        border: "0.5px solid " + (
          isReceiving && selectedPlayerId
            ? style.border
            : "rgba(255,255,255,0.08)"
        ),
        boxShadow: isReceiving && selectedPlayerId
          ? "0 0 0 1px " + style.border
          : "none",
        borderRadius: 10,
        padding: "8px 10px",
        marginBottom: 8,
        cursor: isReceiving ? "pointer" : "default",
        transition: "border 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between", marginBottom: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isNeedsGroup ? (
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 11,
              color: "var(--amber)", letterSpacing: "0.08em",
            }}>
              NEEDS GROUP
            </span>
          ) : isEditingLabel ? (
            <input
              autoFocus
              defaultValue={label === `Group ${groupNumber}` ? "" : label}
              placeholder={`Group ${groupNumber}`}
              maxLength={20}
              onBlur={e => onLabelSave(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") e.target.blur();
                if (e.key === "Escape") onLabelSave(label);
              }}
              onClick={e => e.stopPropagation()}
              style={{
                background: "var(--s3)", border: "none",
                borderBottom: "1px solid " + style.border,
                color: "var(--t1)", fontSize: 12,
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: "0.08em", outline: "none",
                width: 110, padding: "2px 4px",
              }}
            />
          ) : (
            <span
              onClick={e => { e.stopPropagation(); onLabelTap?.(); }}
              style={{
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 12,
                color: "var(--t1)", letterSpacing: "0.08em", cursor: "text",
              }}
            >
              {label}
            </span>
          )}
          <span style={{
            fontSize: 10, padding: "1px 6px",
            background: "rgba(255,255,255,0.08)",
            borderRadius: 10, color: "var(--t2)",
          }}>
            {players.length}
          </span>
        </div>
        {canRemove && (
          <button
            onClick={e => { e.stopPropagation(); onRemove?.(); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--t2)", padding: 0, display: "flex", alignItems: "center",
            }}
          >
            <XIcon size={12} weight="thin" />
          </button>
        )}
      </div>

      {/* Player chips */}
      {players.length === 0 ? (
        <span style={{
          fontSize: 11, color: "var(--t2)", fontStyle: "italic", opacity: 0.6,
        }}>
          Tap a player to move them here
        </span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {players.map(p => (
            <PlayerChip
              key={p.id}
              player={p}
              selected={selectedPlayerId === p.id}
              dimmed={selectedPlayerId !== null && selectedPlayerId !== p.id}
              isNew={
                mountedPlayerIds?.current &&
                !mountedPlayerIds.current.has(p.id)
              }
              onTap={onChipTap}
            />
          ))}
        </div>
      )}
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
  // True only for the in-session window between Confirm and the next
  // edit / reroll. Drives the green "Teams confirmed and shared" toast,
  // which would otherwise show every time the screen reopens.
  const [justConfirmed, setJustConfirmed] = useState(false);
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
  const [manuallyAdjusted,     setManuallyAdjusted]     = useState(false);
  // Groups that should be rendered as panels. Populated from three sources:
  // (1) Squad mount — every groupNumber currently assigned starts the
  //     session as a visible panel.
  // (2) localGroups sync — assigning a player into a group adds it.
  // (3) + ADD GROUP — admin can summon an empty panel.
  // Removal happens ONLY via the × button on an empty panel — once summoned
  // (or once it has ever had a player this session), the panel persists even
  // if all players move out. Prevents the surprise of a panel disappearing
  // mid-curation.
  const [summonedPanels,       setSummonedPanels]       = useState(() => new Set());
  // Hide the SMART TEAMS section by default. Reveals on first SMART tap,
  // or on mount if existing groups indicate the admin already engaged.
  const [smartTeamsRevealed,   setSmartTeamsRevealed]   = useState(false);
  // Flips true when admin edits groups since the last algorithm run.
  // Drives the contextual BUILD TEAMS button. Cleared by runAlgorithm.
  const [groupsDirty,          setGroupsDirty]          = useState(false);

  const hasHydrated = useRef(false);
  const teamsConfirmedRef = useRef(false);
  const confirmedThisSession = useRef(false);
  // One-shot guard for the auto-Smart effect. Reset by Clear Teams so
  // the screen never sits empty.
  const hasAutoFiredRef = useRef(false);
  // Players present at mount — anyone added to the squad later gets a "NEW"
  // badge in the Needs Group panel until assigned.
  const mountedPlayerIds = useRef(null);


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
    }
    // No else-branch: auto-Smart populates assignments locally without
    // touching squad.team, so clearing here would wipe its output on
    // every realtime squad refresh. handleClearConfirm is the only
    // explicit clearer.
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

  // Keep summonedPanels in sync with currently-assigned groups. Additive:
  // never auto-removes a panel even after all its players move away. The
  // only way to remove a panel is the × button on the empty state.
  useEffect(() => {
    const seen = new Set();
    for (const g of Object.values(localGroups)) {
      if (g != null) seen.add(g);
    }
    if (seen.size === 0) return;
    setSummonedPanels(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const g of seen) if (!next.has(g)) { next.add(g); changed = true; }
      return changed ? next : prev;
    });
  }, [localGroups]);

  // Active group panels = whatever's in summonedPanels, in sorted 1–5 order.
  const activeGroupNumbers = useMemo(
    () => [1,2,3,4,5].filter(n => summonedPanels.has(n)),
    [summonedPanels]
  );

  const needsGroupPlayers = useMemo(
    () => inPlayersForGroups.filter(p => (localGroups[p.id] ?? null) === null),
    [inPlayersForGroups, localGroups]
  );

  const getPlayersInGroup = useCallback(
    (groupNum) => inPlayersForGroups.filter(p => localGroups[p.id] === groupNum),
    [inPlayersForGroups, localGroups]
  );

  const hasAnyGroupAssigned = useMemo(
    () => inPlayersForGroups.some(p => (localGroups[p.id] ?? null) !== null),
    [inPlayersForGroups, localGroups]
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

  // Mount-only: capture initial player set + open the SMART TEAMS panel
  // from the start (admin sees the grouping affordance immediately
  // instead of having to tap SMART). Seeds Group 1 + Group 2 empty
  // panels when no existing groups.
  useEffect(() => {
    const eligible = (squad || []).filter(p =>
      p.status === 'in' && !p.injured && !p.disabled
    );
    const anyGrouped = eligible.some(p => (p.groupNumber ?? null) !== null);
    setSmartTeamsRevealed(true);
    setGroupsCollapsed(false);
    if (!anyGrouped) {
      setSummonedPanels(prev => {
        const next = new Set(prev);
        next.add(1); next.add(2);
        return next;
      });
    }
    mountedPlayerIds.current = new Set(eligible.map(p => p.id));
  }, []); // mount only — intentionally empty deps

  const countA = Object.values(assignments).filter(v => v === "A").length;
  const countB = Object.values(assignments).filter(v => v === "B").length;
  const allAssigned = inPlayers.length > 0 && inPlayers.every(p => assignments[p.id] === "A" || assignments[p.id] === "B");
  const teamAIds = inPlayers.filter(p => assignments[p.id] === "A").map(p => p.id);
  const teamBIds = inPlayers.filter(p => assignments[p.id] === "B").map(p => p.id);
  // Full player objects for the LiveBoard, A on left and B on right.
  const teamAPlayers = useMemo(
    () => inPlayers.filter(p => assignments[p.id] === "A"),
    [inPlayers, assignments]
  );
  const teamBPlayers = useMemo(
    () => inPlayers.filter(p => assignments[p.id] === "B"),
    [inPlayers, assignments]
  );

  const clearError = () => setError(null);

  // ── Group Balancer: handlers ────────────────────────────────────────────

  // Tap-to-move primitive: tapping a chip selects/deselects it for assignment.
  const handleChipTap = useCallback((playerId) => {
    setSelectedPlayerId(prev => prev === playerId ? null : playerId);
  }, []);

  // Unconditional team assignment used by the LiveBoard tap flow.
  // Recomputes the prediction chip on each move so it always reflects
  // the current split — no more strikethrough / stale state.
  // manuallyAdjusted still flips true so the BUILD TEAMS reroll warning
  // can fire, AND so the LiveBoard subtitle dismisses.
  const handleMoveToTeam = useCallback((playerId, team) => {
    clearError();
    const next = { ...assignments, [playerId]: team };
    setAssignments(next);
    setSelectedPlayerId(null);
    setDraftSaved(false);
    setTeamsConfirmed(false);
    setJustConfirmed(false);
    teamsConfirmedRef.current = false;
    confirmedThisSession.current = false;
    setManuallyAdjusted(true);
    if (prediction) {
      const nextA = inPlayers
        .filter(p => next[p.id] === "A").map(p => p.id);
      const nextB = inPlayers
        .filter(p => next[p.id] === "B").map(p => p.id);
      const fresh = computePrediction(nextA, nextB, tableData);
      setPrediction(prev => ({
        ...prev,
        winner:       fresh.winner,
        confidence:   fresh.confidence,
        balanceScore: fresh.balanceScore,
      }));
    }
  }, [assignments, inPlayers, tableData, prediction]);

  // LiveBoard chip tap: smarter than the group-panel chip tap because the
  // tapped chip itself encodes a target team. Rules:
  //   • no selection → select
  //   • same chip → deselect
  //   • another chip on same team → switch selection
  //   • another chip on other team → move selected to that team
  const handleLiveBoardChipTap = useCallback((playerId) => {
    if (selectedPlayerId === playerId) {
      setSelectedPlayerId(null);
      return;
    }
    if (!selectedPlayerId) {
      setSelectedPlayerId(playerId);
      return;
    }
    const tappedTeam   = assignments[playerId];
    const selectedTeam = assignments[selectedPlayerId];
    if (tappedTeam === selectedTeam || !tappedTeam) {
      setSelectedPlayerId(playerId);
    } else {
      handleMoveToTeam(selectedPlayerId, tappedTeam);
    }
  }, [selectedPlayerId, assignments, handleMoveToTeam]);

  // LiveBoard column tap: tap empty space in a column to drop the selected
  // player there. No-op if no selection, or if already on that team.
  const handleColumnTap = useCallback((team) => {
    if (!selectedPlayerId) return;
    if (assignments[selectedPlayerId] === team) return;
    handleMoveToTeam(selectedPlayerId, team);
  }, [selectedPlayerId, assignments, handleMoveToTeam]);

  // Commit a player → group assignment with optimistic UI + revert on error.
  // groupNumber is 1–5 or null (Needs Group). RPC writes audit_events.
  const handleSetGroup = useCallback(async (playerId, groupNumber) => {
    const prev = localGroups[playerId] ?? null;
    setLocalGroups(g => ({ ...g, [playerId]: groupNumber }));
    setSelectedPlayerId(null);
    setGroupsDirty(true);
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
  // The localGroups → summonedPanels useEffect handles persistence.
  const handlePanelTap = useCallback((groupNumber) => {
    if (!selectedPlayerId) return;
    handleSetGroup(selectedPlayerId, groupNumber);
  }, [selectedPlayerId, handleSetGroup]);

  // + ADD GROUP — summon the lowest unused 1–5 panel.
  const handleAddGroup = useCallback(() => {
    const next = [1,2,3,4,5].find(n => !summonedPanels.has(n));
    if (!next) return;
    setSummonedPanels(prev => {
      const ns = new Set(prev); ns.add(next); return ns;
    });
  }, [summonedPanels]);

  // × on an empty panel — purely visual, no DB write.
  const handleRemoveEmptyPanel = useCallback((groupNumber) => {
    setSummonedPanels(prev => {
      if (!prev.has(groupNumber)) return prev;
      const ns = new Set(prev); ns.delete(groupNumber); return ns;
    });
  }, []);

  // Tap-outside deselect — wraps the whole Group Balancer section.
  const handleSectionBgClick = useCallback((e) => {
    if (e.target === e.currentTarget) setSelectedPlayerId(null);
  }, []);

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

  // Clears every group assignment server-side and locally, and dismisses
  // every panel — full reset for the section.
  const handleClearAllGroups = useCallback(async () => {
    const prev = localGroups;
    const prevPanels = summonedPanels;
    const cleared = Object.fromEntries(
      Object.entries(localGroups).map(([id]) => [id, null])
    );
    setLocalGroups(cleared);
    setSummonedPanels(new Set());
    setShowClearGroupsConfirm(false);
    setGroupsDirty(true);
    try {
      await clearAllGroups(adminToken);
    } catch (e) {
      console.error('handleClearAllGroups error:', e);
      setLocalGroups(prev);
      setSummonedPanels(prevPanels);
      setError('Failed to clear groups — try again');
    }
  }, [localGroups, summonedPanels, adminToken]);

  // Pure run of the balancer. `silent: true` skips PostHog and side-effects
  // tied to a user-initiated Generate (used by the auto-Smart effect on
  // mount). Always clears manuallyAdjusted + groupsDirty since the live
  // board now reflects the algorithm's output.
  const runAlgorithm = useCallback(({ silent = false } = {}) => {
    clearError();
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
    setGroupsDirty(false);
    setDraftSaved(false);
    setTeamsConfirmed(false);
    setJustConfirmed(false);
    teamsConfirmedRef.current = false;
    confirmedThisSession.current = false;

    if (!silent) {
      window.posthog?.capture('group_balancer_generate', {
        groupCount: Object.values(localGroups)
                      .filter(g => g !== null).length,
        totalIn:    inPlayersForGroups.length,
      });
    }
  }, [
    inPlayersForGroups, localGroups, matchHistory, tableData,
  ]);

  // User-initiated re-balance via the BUILD TEAMS button. Same as
  // runAlgorithm but always non-silent.
  const handleGenerate = useCallback(() => {
    runAlgorithm({ silent: false });
  }, [runAlgorithm]);

  // Auto-Smart on first viable render: if the match has no teams set
  // (draft or confirmed) AND there are ≥4 IN players, silently run the
  // algorithm so the screen shows a balanced split the moment admin
  // arrives. Skips if assignments are already populated. Re-fires after
  // Clear Teams (hasAutoFiredRef reset in handleClearConfirm).
  useEffect(() => {
    if (hasAutoFiredRef.current) return;
    if (!hasHydrated.current) return;
    if (inPlayersForGroups.length < 4) return;
    const alreadyAssigned = Object.values(assignments)
      .some(v => v === 'A' || v === 'B');
    if (alreadyAssigned) {
      hasAutoFiredRef.current = true;
      return;
    }
    hasAutoFiredRef.current = true;
    runAlgorithm({ silent: true });
  }, [inPlayersForGroups.length, assignments, runAlgorithm]);

  // SMART button = show/hide the grouping panel. The mount-only effect
  // seeds + opens it from the start, so this handler is just a toggle.
  const handleSmartTap = useCallback(() => {
    setSmartTeamsRevealed(v => !v);
  }, []);

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
      // The prediction is kept live (handleMoveToTeam recomputes it on
      // every swap), so always save whatever's currently in state. The
      // accuracy stat is no longer at risk from manual edits.
      await confirmTeams(
        adminToken, matchId, teamAIds, teamBIds,
        prediction?.winner       ?? null,
        prediction?.confidence   ?? null,
        prediction?.balanceScore ?? null,
      );
      setTeamsConfirmed(true);
      setJustConfirmed(true);
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
  }, [allAssigned, isConfirming, adminToken, matchId, teamAIds, teamBIds, inPlayers, prediction, manuallyAdjusted]);

  const handleClear = useCallback(() => {
    clearError();
    setShowClearConfirm(true);
  }, []);

  const handleClearConfirm = useCallback(async () => {
    setAssignments({});
    setDraftSaved(false);
    setTeamsConfirmed(false);
    setJustConfirmed(false);
    teamsConfirmedRef.current = false;
    confirmedThisSession.current = false;
    setShowClearConfirm(false);
    setPrediction(null);
    setManuallyAdjusted(false);
    setGroupsDirty(false);
    // SMART panel collapses unless existing groups remain to surface.
    if (!Object.values(localGroups).some(g => g !== null)) {
      setSmartTeamsRevealed(false);
    }
    try {
      await confirmTeams(adminToken, matchId, [], []);
    } catch (e) {
      console.error("handleClearConfirm error:", e);
    }
    // Allow the auto-Smart effect to fire again so the live board never
    // sits empty after a clear.
    hasAutoFiredRef.current = false;
  }, [adminToken, matchId, localGroups]);

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

        {/* SMART — toggles the grouping panel. Algorithm runs via BUILD
            TEAMS (contextual gold button when groups are dirty) or the
            auto-Smart effect on screen entry. */}
        <button
          onClick={handleSmartTap}
          style={{
            flex: 1, height: 40, borderRadius: 8, border: "0.5px solid var(--purpleb)",
            background: "var(--purple2)", color: "var(--purple)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 1,
            cursor: "pointer",
          }}
        >
          <Shuffle size={16} weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, lineHeight: 1 }}>
            SMART
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

      {/* Reroll warning — appears once a generated split has been manually
          tweaked, so the admin knows Reroll/Generate again will reset
          their tweaks. */}
      {manuallyAdjusted && (
        <div style={{
          fontSize: 11, color: "var(--amber)",
          fontFamily: "'DM Sans', sans-serif",
          marginTop: 8, textAlign: "center",
        }}>
          Generating again will reset your manual changes
        </div>
      )}

      {/* Confirm nudge */}
      {confirmNudge && (
        <div style={{
          textAlign: "center", color: "var(--amber)",
          fontSize: 12, fontWeight: 400, marginTop: 8,
        }}>
          Assign all players before confirming
        </div>
      )}

      {/* Teams confirmed success state — only shown after a fresh confirm
          in this session. Re-opening the screen doesn't re-surface it. */}
      {teamsConfirmed && justConfirmed && (
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

      {/* LIVE BOARD heading — mirrors the player-side My View > Live Board
          (pulsing green dot + uppercase letterspaced label). */}
      <div style={{ display: "flex", alignItems: "center", marginTop: 16, marginBottom: 6 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          fontSize: 10, fontWeight: 400,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: "var(--t2)",
        }}>
          <span style={{
            width: 6, height: 6, background: "var(--green)",
            borderRadius: "50%",
            animation: "ioo-blink 2s infinite",
            boxShadow: "0 0 8px var(--green)",
            display: "inline-block", flexShrink: 0,
          }} />
          Live Board
        </div>
      </div>

      {/* Onboarding subtitle — fades out the moment admin makes the
          first manual swap. Until then it explains who built the split. */}
      {!manuallyAdjusted && (
        <div style={{
          fontSize: 11, color: "var(--t2)", fontWeight: 300,
          fontFamily: "'DM Sans', sans-serif",
          marginBottom: 8,
        }}>
          Teams drafted by IO Smart Teams. Tap to move players.
        </div>
      )}

      {/* The board itself. Tap a player chip to select; tap a chip on the
          other team (or empty space in the other column) to move them. */}
      <LiveBoard
        teamAPlayers={teamAPlayers}
        teamBPlayers={teamBPlayers}
        selectedPlayerId={selectedPlayerId}
        onChipTap={handleLiveBoardChipTap}
        onColumnTap={handleColumnTap}
      />


      {/* IO Prediction — small chip below the LiveBoard. Always live:
          recomputes on every manual move so it tracks the current split. */}
      {prediction && (
        <div style={{
          fontSize: 12, color: "var(--t2)",
          fontFamily: "'DM Sans', sans-serif", fontWeight: 300,
          textAlign: "center",
          padding: "6px 0", marginBottom: 12,
        }}>
          🎯 {predictionChipText(prediction.winner, prediction.confidence)}
        </div>
      )}

      {/* SMART TEAMS section — open by default, toggleable via SMART or
          the chevron. */}
      {smartTeamsRevealed && inPlayersForGroups.length >= 4 && (
        <div onClick={handleSectionBgClick} style={{ marginBottom: 16 }}>

          {/* Header row — title + collapse chevron. Clear All on its own line. */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", marginBottom: 4,
          }}>
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
              color: "var(--t2)", letterSpacing: "0.1em",
            }}>
              SMART TEAMS
            </span>
            <button
              onClick={() => setGroupsCollapsed(c => !c)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--t2)", display: "flex", alignItems: "center",
                padding: "4px 4px",
              }}
              aria-label={groupsCollapsed ? "Expand" : "Collapse"}
            >
              {groupsCollapsed ? <CaretDown size={16} weight="thin" /> : <CaretUp size={16} weight="thin" />}
            </button>
          </div>

          {/* Subtitle — explains the affordance. Only shown while expanded. */}
          {!groupsCollapsed && (
            <div style={{
              fontSize: 11, color: "var(--t2)", fontWeight: 300,
              fontFamily: "'DM Sans', sans-serif",
              marginBottom: 8,
            }}>
              Move players between groups, and IO builds a fair teamsheet.
            </div>
          )}

          {/* Clear All row — only present when there's something to clear,
              and only when the section is expanded. */}
          {!groupsCollapsed && (hasAnyGroupAssigned || showClearGroupsConfirm) && (
            <div style={{
              display: "flex", justifyContent: "flex-end",
              gap: 12, alignItems: "center", marginBottom: 8,
            }}>
              {showClearGroupsConfirm ? (
                <>
                  <span style={{ fontSize: 11, color: "var(--t2)" }}>Clear all groups?</span>
                  <button
                    onClick={handleClearAllGroups}
                    style={{
                      fontSize: 11, color: "var(--red)", background: "none",
                      border: "none", cursor: "pointer", padding: "4px 6px",
                    }}
                  >Yes, clear</button>
                  <button
                    onClick={() => setShowClearGroupsConfirm(false)}
                    style={{
                      fontSize: 11, color: "var(--t2)", background: "none",
                      border: "none", cursor: "pointer", padding: "4px 6px",
                    }}
                  >Cancel</button>
                </>
              ) : (
                <button
                  onClick={() => setShowClearGroupsConfirm(true)}
                  style={{
                    fontSize: 11, color: "var(--t2)", background: "none",
                    border: "none", cursor: "pointer", padding: "4px 6px",
                  }}
                >
                  Clear All
                </button>
              )}
            </div>
          )}

          {!groupsCollapsed && (
            <>
              {/* Needs Group panel — collapses to zero height when empty so
                  the section visually heals after the last ungrouped player
                  is placed. Wrapper stays mounted so the height/opacity
                  animation has something to play against. */}
              <div style={{
                maxHeight:    needsGroupPlayers.length > 0 ? 400 : 0,
                opacity:      needsGroupPlayers.length > 0 ? 1 : 0,
                overflow:     "hidden",
                transition:   "max-height 280ms ease, opacity 220ms ease",
                pointerEvents: needsGroupPlayers.length > 0 ? "auto" : "none",
              }}>
                <GroupPanel
                  groupNumber={null}
                  label="NEEDS GROUP"
                  players={needsGroupPlayers}
                  selectedPlayerId={selectedPlayerId}
                  mountedPlayerIds={mountedPlayerIds}
                  onChipTap={handleChipTap}
                  onPanelTap={() => handlePanelTap(null)}
                  isReceiving={selectedPlayerId !== null}
                />
              </div>

              {/* Active group panels */}
              {activeGroupNumbers.map(groupNum => {
                const playersInGroup = getPlayersInGroup(groupNum);
                return (
                  <GroupPanel
                    key={groupNum}
                    groupNumber={groupNum}
                    label={groupLabels[String(groupNum)] || `Group ${groupNum}`}
                    isEditingLabel={editingLabel === groupNum}
                    onLabelTap={() => setEditingLabel(groupNum)}
                    onLabelSave={(val) => handleSetLabel(groupNum, val)}
                    players={playersInGroup}
                    selectedPlayerId={selectedPlayerId}
                    mountedPlayerIds={mountedPlayerIds}
                    onChipTap={handleChipTap}
                    onPanelTap={() => handlePanelTap(groupNum)}
                    isReceiving={selectedPlayerId !== null}
                    canRemove={playersInGroup.length === 0}
                    onRemove={() => handleRemoveEmptyPanel(groupNum)}
                  />
                );
              })}

              {/* + ADD GROUP */}
              {activeGroupNumbers.length < 5 && (
                <button
                  onClick={handleAddGroup}
                  style={{
                    width: "100%", padding: "8px", marginTop: 4,
                    background: "none",
                    border: "0.5px dashed rgba(255,255,255,0.15)",
                    borderRadius: 10, color: "var(--t2)", fontSize: 12,
                    fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.08em",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  <Plus size={12} weight="thin" /> ADD GROUP
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* BUILD TEAMS — contextual gold CTA. Appears only when admin has
          edited groups since the last algorithm run and the SMART panel is
          open. Tapping runs the algorithm against the current groups and
          the live board updates. Auto-dismisses on success. */}
      {smartTeamsRevealed && groupsDirty && inPlayersForGroups.length >= 4 && (
        <button
          onClick={handleGenerate}
          style={{
            width: "100%", height: 48, borderRadius: 8,
            background: "var(--gold)", color: "var(--bg)",
            border: "none", cursor: "pointer",
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 16, letterSpacing: "0.08em",
            marginTop: 4, marginBottom: 16,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <Shuffle size={16} weight="thin" />
          BUILD TEAMS
        </button>
      )}

      {/* Confirm Teams (bottom) — explicit primary action. Mirrors the
          top CONFIRM but is far more discoverable. Disabled until every
          IN player is on a team. */}
      <div style={{ marginTop: 24, marginBottom: 16 }}>
        <button
          onClick={handleConfirm}
          disabled={!allAssigned || isConfirming}
          style={{
            width: "100%", height: 52, borderRadius: 8,
            background: allAssigned ? "var(--green)" : "var(--s2)",
            border: allAssigned ? "none" : "0.5px solid var(--greenb)",
            color: allAssigned ? "var(--bg)" : "var(--green)",
            cursor: (allAssigned && !isConfirming) ? "pointer" : "default",
            opacity: isConfirming ? 0.6 : 1,
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 18, letterSpacing: "0.08em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "background 0.15s, color 0.15s",
          }}
        >
          <CheckCircle size={18} weight="thin" />
          CONFIRM TEAMS
        </button>
      </div>

    </div>
  );
}
