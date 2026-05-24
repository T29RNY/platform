import { useState, useEffect, useRef } from "react";
import { NumberSquareOne, TrendUp, Flag, Trophy, Check, ArrowLeft, ArrowsLeftRight } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { newMatch, updatePlayerRecords, resolveMotm } from "@platform/core";
import { saveMatchResult } from "@platform/core/storage/supabase.js";

// ── Module-level constants ────────────────────────────────────────────────────

// Spring used for every stage card entrance — confident landing without bounce.
const STAGE_SPRING = { type: "spring", stiffness: 280, damping: 26 };

const MODES = [
  {
    id: "exact", Icon: NumberSquareOne, title: "Exact Score", sub: "Full scoreline",
    color: "var(--green)", tint: "var(--green2)", border: "1px solid var(--greenb)",
    glow: "0 0 16px rgba(61,220,106,0.3)",
  },
  {
    id: "margin", Icon: TrendUp, title: "Won By", sub: "Winner + margin",
    color: "var(--gold)", tint: "var(--gold2)", border: "1px solid var(--goldb)",
    glow: "0 0 16px rgba(232,160,32,0.3)",
  },
  {
    id: "declared", Icon: Flag, title: "Declare", sub: "Just who won",
    color: "var(--amber)", tint: "var(--amber2)", border: "1px solid var(--amberb)",
    glow: "0 0 16px rgba(255,176,32,0.3)",
  },
];

const DECLARE_OPTS = [
  { val: "A", label: "TEAM A WIN", bg: "rgba(96,160,255,0.12)", c: "#60A0FF" },
  { val: "D", label: "DRAW 🤝",    bg: "var(--s2)",             c: "var(--t2)", unselBorder: "var(--t2)" },
  { val: "B", label: "TEAM B WIN", bg: "rgba(255,96,96,0.12)",  c: "#FF6060" },
];

// ── Helper components ─────────────────────────────────────────────────────────

function StageCard({ children, refProp, style }) {
  return (
    <motion.div
      ref={refProp}
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={STAGE_SPRING}
      style={{
        background: "var(--s1)", borderRadius: 12,
        border: "0.5px solid var(--s3)", padding: 16,
        marginBottom: 12, ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

function StageLbl({ children }) {
  return (
    <div style={{
      fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
      color: "var(--t2)", letterSpacing: "0.1em", marginBottom: 12,
    }}>{children}</div>
  );
}

function SpinBtn({ color, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 36, borderRadius: "50%",
      border: `1px solid ${color}55`, background: "transparent", color,
      fontSize: 20, cursor: "pointer", lineHeight: 1,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>{label}</button>
  );
}

function ScoreInput({ label, color, val, onDec, onInc }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color, letterSpacing: "0.12em",
        textTransform: "uppercase", marginBottom: 8,
      }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, color, lineHeight: 1 }}>
        {val}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 10 }}>
        <SpinBtn color={color} onClick={onDec} label="−" />
        <SpinBtn color={color} onClick={onInc} label="+" />
      </div>
    </div>
  );
}

function smBtn(color) {
  return {
    width: 28, height: 28, borderRadius: "50%",
    border: `1px solid ${color}55`, background: "transparent", color,
    fontSize: 16, cursor: "pointer", lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScoreScreen({
  squad, setSquad, teamId, adminToken = null, schedule, matchHistory, setMatchHistory,
  payments, bibHistory, onBack,
}) {
  // Stage 1 — mode
  const [mode, setMode] = useState(null);

  // Stage 2 — exact
  const [scoreA, setScoreA]           = useState(0);
  const [scoreB, setScoreB]           = useState(0);
  const [scoreConfirmed, setScoreConfirmed] = useState(false);
  const [exactScorers, setExactScorers]     = useState({});

  // Stage 2 — margin
  const [marginWinner, setMarginWinner] = useState(null);
  const [margin, setMargin]             = useState(0);

  // Stage 2 — declared
  const [declaredWinner, setDeclaredWinner] = useState(null);

  // Stage 3 — switches
  const [switches, setSwitches]               = useState([]);
  const [selectedForSwitch, setSelectedForSwitch] = useState(null);
  const [switchConfirm, setSwitchConfirm]     = useState(null);

  // Stage 4 — last goal winner
  const [lastGoalChoice, setLastGoalChoice]     = useState(null); // 'yes'|'no'
  const [lastGoalPlayerId, setLastGoalPlayerId] = useState(null);

  // Stage 5 — bibs: null=untouched, 'none'=no bibs, id=player selected
  const [bibsPlayerId, setBibsPlayerId] = useState(null);
  const [bibEligible,  setBibEligible]  = useState(null); // null until fetched at stage4Done

  // Save
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false); // synchronous guard — prevents double-fire before state update lands
  const [saved, setSaved]       = useState(false);
  const [saveError, setSaveError] = useState(null);

  // POTM countdown
  const [countdown, setCountdown] = useState("");

  // Scroll peek refs
  const s2Ref = useRef(null), s3Ref = useRef(null);
  const s4Ref = useRef(null), s5Ref = useRef(null);
  const s6Ref = useRef(null);
  const saveRef = useRef(null);
  const p1 = useRef(false), p2 = useRef(false);
  const p3 = useRef(false), p4 = useRef(false);
  const p5 = useRef(false);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const inPlayers  = squad.filter(p => p.status === "in" && !p.disabled);
  const eligible   = inPlayers.filter(p => !p.isGuest);
  const bibsSorted = [...eligible].sort((a, b) => a.name.localeCompare(b.name));

  const stage1Done = mode !== null;
  const stage2Done = (() => {
    if (!stage1Done) return false;
    if (mode === "exact")    return scoreConfirmed;
    if (mode === "margin")   return marginWinner === "D" || (marginWinner !== null && margin > 0);
    if (mode === "declared") return declaredWinner !== null;
    return false;
  })();
  const stage3Done = true; // switches — always valid
  const stage4Done = lastGoalChoice === "no" || (lastGoalChoice === "yes" && lastGoalPlayerId !== null);
  const bibsEnabled = schedule?.bibsEnabled !== false;
  const stage5Done = !bibsEnabled || bibsPlayerId !== null;
  const canSave    = stage1Done && stage2Done && stage4Done && stage5Done;

  const currentTeam = (p) => {
    const sw = switches.find(s => s.playerId === p.id);
    return sw ? (sw.from === "A" ? "B" : "A") : p.team;
  };

  const winner = (() => {
    if (mode === "exact")    return scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "D";
    if (mode === "margin")   return marginWinner;
    if (mode === "declared") return declaredWinner;
    return null;
  })();

  const finalScoreA = mode === "exact" ? scoreA
    : mode === "margin" ? (marginWinner === "A" ? margin : 0)
    : null;
  const finalScoreB = mode === "exact" ? scoreB
    : mode === "margin" ? (marginWinner === "B" ? margin : 0)
    : null;
  const scoreType = mode === "exact" ? "exact" : mode === "margin" ? "margin" : "declared";
  const scorers   = mode === "exact" ? exactScorers : {};

  const potmMatch = schedule?.activeMatchId
    ? matchHistory.find(m => m.id === schedule.activeMatchId)
    : null;

  const origTeamAPlayers = inPlayers.filter(p => p.team === "A");
  const origTeamBPlayers = inPlayers.filter(p => p.team === "B");

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!schedule?.votingClosesAt) return;
    const tick = () => {
      const diff = Math.max(0, new Date(schedule.votingClosesAt) - Date.now());
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(diff <= 0 ? "Closed" : `${m}m ${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [schedule?.votingClosesAt]);

  const peek = (ref) => {
    if (!ref?.current) return;
    setTimeout(() => {
      const top = window.scrollY + ref.current.getBoundingClientRect().top - window.innerHeight + 80;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }, 120);
  };

  useEffect(() => { if (stage1Done && !p1.current) { p1.current = true; peek(s2Ref); } }, [stage1Done]); // eslint-disable-line
  useEffect(() => { if (stage2Done && !p2.current) { p2.current = true; peek(s3Ref); } }, [stage2Done]); // eslint-disable-line
  useEffect(() => { if (stage4Done && !p4.current) { p4.current = true; peek(bibsEnabled ? s5Ref : s6Ref); } }, [stage4Done]); // eslint-disable-line
  useEffect(() => { if (stage5Done && bibsEnabled && !p5.current) { p5.current = true; peek(s6Ref); } }, [stage5Done]); // eslint-disable-line

  useEffect(() => {
    if (!stage4Done) return;
    setBibEligible(bibsSorted);
  }, [stage4Done]); // eslint-disable-line

  const changeMode = (m) => {
    setMode(m);
    setScoreConfirmed(false); setScoreA(0); setScoreB(0); setExactScorers({});
    setMarginWinner(null); setMargin(0); setDeclaredWinner(null);
    setSwitches([]); setSelectedForSwitch(null); setSwitchConfirm(null);
    setLastGoalChoice(null); setLastGoalPlayerId(null); setBibsPlayerId(null); setBibEligible(null);
    p2.current = false; p3.current = false; p4.current = false; p5.current = false;
  };

  const handleSwitchTap = (p) => {
    const isSwitched = switches.some(s => s.playerId === p.id);

    if (isSwitched) {
      setSwitchConfirm({
        undo: true,
        playerA: { id: p.id, name: p.nickname || p.name, team: currentTeam(p) },
        playerB: null,
      });
      setSelectedForSwitch(null);
      return;
    }

    if (selectedForSwitch === null) {
      setSelectedForSwitch(p.id);
      return;
    }

    if (selectedForSwitch === p.id) {
      setSelectedForSwitch(null);
      return;
    }

    const playerA = inPlayers.find(pl => pl.id === selectedForSwitch);
    setSwitchConfirm({
      playerA: { id: playerA.id, name: playerA.nickname || playerA.name, team: currentTeam(playerA) },
      playerB: { id: p.id, name: p.nickname || p.name, team: currentTeam(p) },
    });
    setSelectedForSwitch(null);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!canSave || isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true); setSaveError(null);
    try {
      const teamAPlayers = inPlayers.filter(p => currentTeam(p) === "A").map(p => p.name);
      const teamBPlayers = inPlayers.filter(p => currentTeam(p) === "B").map(p => p.name);
      const teamAIds     = inPlayers.filter(p => currentTeam(p) === "A").map(p => p.id);
      const teamBIds     = inPlayers.filter(p => currentTeam(p) === "B").map(p => p.id);
      const payMap    = Object.fromEntries(inPlayers.map(p => [p.id, { paid: payments[p.id] || false, amount: schedule.pricePerPlayer || 0 }]));
      const scorerMap = Object.fromEntries(inPlayers.map(p => [p.name, scorers[p.id] || 0]));
      const bibPlayerId = (bibsPlayerId && bibsPlayerId !== "none") ? bibsPlayerId : null;

      const match = newMatch({
        teamA: teamAPlayers, teamB: teamBPlayers,
        winner, bibHolder: "", scorers: scorerMap, payments: payMap,
      });
      // Overwrite after newMatch — declared mode needs null scores
      match.scoreA         = finalScoreA;
      match.scoreB         = finalScoreB;
      match.scoreType      = scoreType;
      match.lastGoalScorer = lastGoalChoice === "yes" ? lastGoalPlayerId : null;
      if (schedule?.activeMatchId) match.id = schedule.activeMatchId;

      // 1. Local state
      setMatchHistory([match, ...matchHistory]);
      setSquad(updatePlayerRecords(squad, match, scorers, null, payMap, schedule.pricePerPlayer));

      // 2. Persist — RPC handles match row, player_match rows, bib cascade in one call
      await saveMatchResult(adminToken, {
        id:             match.id,
        scoreType,
        scoreA:         finalScoreA,
        scoreB:         finalScoreB,
        winner,
        margin:         mode === "margin" ? margin : null,
        teamA:          teamAIds,
        teamB:          teamBIds,
        scorers,
        motm:           null,
        lastGoalScorer: lastGoalChoice === "yes" ? lastGoalPlayerId : null,
        bibHolder:      bibPlayerId,
        teamSwitches:   switches.length > 0 ? switches : null,
      });

      setSaved(true);
    } catch (e) {
      setSaveError("Save failed — check connection and try again.");
      console.error("[ioo] ScoreScreen save:", e);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  // ── Saved screen ──────────────────────────────────────────────────────────
  if (saved) {
    return (
      <div style={{ padding: "20px 16px" }}>
        <div style={{ textAlign: "center", paddingTop: 60 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: "var(--green)", letterSpacing: "0.06em" }}>
            RESULT SAVED ✓
          </div>
          <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, marginTop: 8 }}>
            All player records updated
          </div>
        </div>
        <button onClick={onBack} style={{
          width: "100%", padding: "16px 0", borderRadius: 12, border: "none",
          background: "var(--gold)", color: "var(--bg)",
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.1em",
          cursor: "pointer", marginTop: 32,
        }}>
          DONE
        </button>
      </div>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "20px 16px 100px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <button onClick={onBack} style={backBtn}>
          <ArrowLeft size={20} weight="thin" color="var(--t2)" />
        </button>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", letterSpacing: "0.08em" }}>
          FULL TIME
        </div>
      </div>

      {/* ── STAGE 1 — MODE SELECTION ────────────────────────────────────────── */}
      <div style={{ marginBottom: 12 }}>
        <StageLbl>HOW DO YOU WANT TO ENTER THE SCORE?</StageLbl>
        <div style={{ display: "flex", gap: 8 }}>
          {MODES.map(({ id, Icon, title, sub, color, tint, border, glow }) => {
            const active = mode === id;
            const other  = mode !== null && !active;
            return (
              <button key={id} onClick={() => changeMode(id)} style={{
                flex: 1, height: 110, borderRadius: 12,
                background: active ? tint : "var(--s2)",
                border: active ? border : "0.5px solid var(--s3)",
                boxShadow: active ? glow : "none",
                transform: active ? "scale(1.03)" : "scale(1)",
                opacity: other ? 0.35 : 1,
                filter: other ? "grayscale(0.6)" : "none",
                cursor: "pointer",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 5,
                transition: "all 0.18s ease", padding: 8,
              }}>
                <Icon size={28} weight="thin" color={active ? color : "var(--t2)"} />
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.1em", color: active ? color : "var(--t2)" }}>
                  {title}
                </div>
                <div style={{ fontSize: 10, color: active ? color : "var(--t2)", fontWeight: 300, opacity: 0.7 }}>
                  {sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── STAGE 2 — SCORE ENTRY ───────────────────────────────────────────── */}
      {stage1Done && (
        <StageCard refProp={s2Ref}>

          {mode === "exact" && (
            <>
              <StageLbl>SCORELINE</StageLbl>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <ScoreInput label="TEAM A" color="#60A0FF" val={scoreA}
                  onDec={() => setScoreA(v => Math.max(0, v - 1))} onInc={() => setScoreA(v => v + 1)} />
                <div style={{
                  display: "flex", alignItems: "center",
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 32,
                  color: "var(--t2)", paddingBottom: 20,
                }}>:</div>
                <ScoreInput label="TEAM B" color="#FF6060" val={scoreB}
                  onDec={() => setScoreB(v => Math.max(0, v - 1))} onInc={() => setScoreB(v => v + 1)} />
              </div>

              {eligible.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, marginBottom: 8, textAlign: "center" }}>
                    ⚽ Who scored? <span style={{ opacity: 0.5 }}>Optional</span>
                  </div>
                  {eligible.map(p => (
                    <div key={p.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px", borderRadius: 8, marginBottom: 6,
                      background: exactScorers[p.id] ? "rgba(61,220,106,0.06)" : "var(--s2)",
                      border: `0.5px solid ${exactScorers[p.id] ? "rgba(61,220,106,0.3)" : "var(--s3)"}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, color: "var(--t1)", fontWeight: 400 }}>{p.name}</span>
                        {p.team && (
                          <span style={{ fontSize: 10, color: p.team === "A" ? "#60A0FF" : "#FF6060", fontWeight: 600 }}>
                            {p.team}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {(exactScorers[p.id] || 0) > 0 && (
                          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--green)" }}>
                            {exactScorers[p.id]}
                          </span>
                        )}
                        {(exactScorers[p.id] || 0) > 0 && (
                          <button
                            onClick={() => setExactScorers(s => {
                              const u = { ...s, [p.id]: Math.max(0, (s[p.id] || 0) - 1) };
                              if (!u[p.id]) delete u[p.id];
                              return u;
                            })}
                            style={smBtn("var(--red)")}
                          >−</button>
                        )}
                        <button
                          onClick={() => setExactScorers(s => ({ ...s, [p.id]: (s[p.id] || 0) + 1 }))}
                          style={smBtn("var(--green)")}
                        >+</button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              <button
                onClick={() => setScoreConfirmed(true)}
                disabled={scoreConfirmed}
                style={{
                  width: "100%", height: 48, borderRadius: 10, marginTop: 12, border: "none",
                  background: scoreConfirmed ? "var(--s3)" : "var(--green)",
                  cursor: scoreConfirmed ? "default" : "pointer",
                  color: scoreConfirmed ? "var(--t2)" : "var(--bg)",
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.08em",
                }}
              >
                {scoreConfirmed ? `✓  ${scoreA} — ${scoreB}  CONFIRMED` : "SET SCORE →"}
              </button>
            </>
          )}

          {mode === "margin" && (
            <>
              <StageLbl>RESULT</StageLbl>
              <div style={{ display: "flex", gap: 12 }}>
                {/* Which team won */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, marginBottom: 10 }}>
                    Which team won?
                  </div>
                  {["A", "B"].map(t => {
                    const c   = t === "A" ? "#60A0FF" : "#FF6060";
                    const sel = marginWinner === t;
                    return (
                      <button key={t} onClick={() => setMarginWinner(t)} style={{
                        width: "100%", height: 44, borderRadius: 8, marginBottom: 6,
                        background: sel ? `${c}22` : "var(--s2)",
                        border: `1px solid ${sel ? c : "var(--s3)"}`,
                        boxShadow: sel ? `0 0 12px ${c}44` : "none",
                        color: sel ? c : "var(--t2)",
                        fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.06em",
                        cursor: "pointer",
                      }}>TEAM {t}{sel ? " ✓" : ""}</button>
                    );
                  })}
                  <button onClick={() => { setMarginWinner("D"); setMargin(0); }} style={{
                    width: "100%", padding: "7px 0", background: "none", border: "none",
                    cursor: "pointer", fontSize: 12,
                    color: marginWinner === "D" ? "var(--gold)" : "var(--t2)",
                    fontWeight: marginWinner === "D" ? 600 : 300,
                  }}>DRAW 🤝</button>
                </div>

                {/* Margin */}
                <div style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  opacity: (!marginWinner || marginWinner === "D") ? 0.4 : 1,
                  pointerEvents: (!marginWinner || marginWinner === "D") ? "none" : "auto",
                }}>
                  <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, marginBottom: 8 }}>
                    By how many? ⚽
                  </div>
                  {marginWinner === "D" ? (
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: "var(--t2)" }}>—</div>
                  ) : (
                    <>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, color: "var(--gold)", lineHeight: 1 }}>
                        {margin}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, marginTop: 2 }}>goals</div>
                      <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                        <SpinBtn color="var(--gold)" onClick={() => setMargin(v => Math.max(0, v - 1))} label="−" />
                        <SpinBtn color="var(--gold)" onClick={() => setMargin(v => v + 1)} label="+" />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {mode === "declared" && (
            <>
              <StageLbl>WHO WON?</StageLbl>
              {DECLARE_OPTS.map(({ val, label, bg, c, unselBorder }) => {
                const sel = declaredWinner === val;
                return (
                  <button key={val} onClick={() => setDeclaredWinner(val)} style={{
                    width: "100%", height: 56, borderRadius: 10, marginBottom: 8,
                    background: sel ? bg : "var(--s2)",
                    border: `1px solid ${sel ? c : (unselBorder || "var(--s3)")}`,
                    boxShadow: sel ? `0 0 14px ${c}44` : "none",
                    color: sel ? c : "var(--t2)",
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.06em",
                    cursor: "pointer", transition: "all 0.15s ease",
                  }}>{label}</button>
                );
              })}
            </>
          )}

        </StageCard>
      )}

      {/* ── STAGE 3 — TEAM SWITCHES ─────────────────────────────────────────── */}
      {stage2Done && (
        <StageCard refProp={s3Ref}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <ArrowsLeftRight size={18} weight="thin" color="var(--t2)" />
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--t2)", letterSpacing: "0.08em" }}>
              TEAM SWITCHES
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 300, color: "var(--t2)", marginBottom: 16 }}>
            Did any players swap teams during the game?
          </div>

          {(origTeamAPlayers.length > 0 || origTeamBPlayers.length > 0) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "TEAM A", color: "#60A0FF", players: origTeamAPlayers },
                { label: "TEAM B", color: "#FF6060", players: origTeamBPlayers },
              ].map(({ label, color, players }) => (
                <div key={label}>
                  <div style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
                    color, letterSpacing: "0.08em", marginBottom: 6,
                  }}>
                    {label}
                  </div>
                  {players.map(p => {
                    const isSwitched = switches.some(s => s.playerId === p.id);
                    const isSelected = selectedForSwitch === p.id;
                    return (
                      <div key={p.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 8px", borderRadius: 8, marginBottom: 4,
                        background: isSelected ? "var(--s2)" : "transparent",
                        border: isSelected ? "0.5px solid rgba(255,255,255,0.18)" : "0.5px solid transparent",
                      }}>
                        <span style={{
                          fontSize: 13, color: "var(--t1)", fontWeight: 400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {p.nickname || p.name}
                        </span>
                        <button
                          onClick={() => handleSwitchTap(p)}
                          style={{
                            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                            border: isSwitched ? "none" : "0.5px solid rgba(255,255,255,0.35)",
                            background: isSwitched ? "var(--gold2)" : "transparent",
                            color: isSwitched ? "var(--gold)" : "var(--s3)",
                            cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            padding: 0, marginLeft: 4,
                          }}
                        >
                          <ArrowsLeftRight size={14} weight="thin" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", paddingBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>
                Teams weren't confirmed for this match
              </span>
            </div>
          )}

          <button
            onClick={() => { setSwitches([]); setSelectedForSwitch(null); peek(s4Ref); }}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 10, marginTop: 16,
              background: "var(--s2)", border: "0.5px solid rgba(255,255,255,0.1)",
              color: "var(--t2)", fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16, letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            NO SWITCHES THIS WEEK
          </button>
        </StageCard>
      )}

      {/* ── STAGE 4 — LAST GOAL WINNER ──────────────────────────────────────── */}
      {stage2Done && (
        <StageCard refProp={s4Ref}>
          <StageLbl>LAST GOAL WINNER ⚽</StageLbl>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {[
              { val: "yes", label: "YES", bg: "var(--green2)", border: "var(--greenb)", color: "var(--green)" },
              { val: "no",  label: "NO",  bg: "var(--s3)",     border: "var(--t2)",     color: "var(--t1)"   },
            ].map(({ val, label, bg, border, color }) => (
              <button key={val}
                onClick={() => { setLastGoalChoice(val); if (val === "no") setLastGoalPlayerId(null); }}
                style={{
                  flex: 1, height: 48, borderRadius: 10,
                  background: lastGoalChoice === val ? bg : "var(--s2)",
                  border: `1px solid ${lastGoalChoice === val ? border : "var(--s3)"}`,
                  color: lastGoalChoice === val ? color : "var(--t2)",
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.06em",
                  cursor: "pointer", transition: "all 0.15s ease",
                }}
              >{label}</button>
            ))}
          </div>

          {lastGoalChoice === "yes" && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {eligible.map(p => (
                <div key={p.id} onClick={() => setLastGoalPlayerId(p.id)} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", borderRadius: 8, marginBottom: 6,
                  background: lastGoalPlayerId === p.id ? "rgba(61,220,106,0.07)" : "var(--s2)",
                  border: `0.5px solid ${lastGoalPlayerId === p.id ? "rgba(61,220,106,0.35)" : "var(--s3)"}`,
                  cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--t1)", fontWeight: 400 }}>{p.name}</span>
                    {p.team && (
                      <span style={{ fontSize: 10, color: p.team === "A" ? "#60A0FF" : "#FF6060", fontWeight: 600 }}>
                        {p.team}
                      </span>
                    )}
                  </div>
                  {lastGoalPlayerId === p.id && <Check size={16} weight="thin" color="var(--green)" />}
                </div>
              ))}
            </motion.div>
          )}
        </StageCard>
      )}

      {/* ── STAGE 5 — BIBS ──────────────────────────────────────────────────── */}
      {stage4Done && bibsEnabled && (
        <StageCard refProp={s5Ref}>
          <StageLbl>WHO TOOK THE BIBS? 👕</StageLbl>
          <div style={{ position: "relative" }}>
            <select
              value={bibsPlayerId ?? ""}
              onChange={e => setBibsPlayerId(e.target.value)}
              style={{
                width: "100%", padding: "12px 40px 12px 16px", borderRadius: 10,
                border: `0.5px solid ${bibsPlayerId ? "rgba(255,255,255,0.18)" : "var(--s3)"}`,
                background: "var(--s2)",
                color: bibsPlayerId ? "var(--t1)" : "var(--t2)",
                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 300,
                outline: "none", appearance: "none", cursor: "pointer",
              }}
            >
              <option value="" disabled>Select...</option>
              {(bibEligible ?? bibsSorted).map(p => <option key={p.id} value={p.id}>{p.nickname || p.name}</option>)}
              <option value="none">No Bibs</option>
            </select>
            <div style={{
              position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
              pointerEvents: "none", color: "var(--t2)", fontSize: 11,
            }}>▾</div>
          </div>
        </StageCard>
      )}

      {/* ── STAGE 6 — POTM (informational) ──────────────────────────────────── */}
      {stage5Done && (() => {
        if (schedule?.votingOpen) {
          return (
            <StageCard refProp={s6Ref} style={{ background: "var(--gold2)", border: "1px solid var(--goldb)" }}>
              <StageLbl>PLAYER OF THE MATCH 🏆</StageLbl>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", letterSpacing: "0.06em" }}>
                  VOTING OPEN
                </div>
                <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 4, fontWeight: 300 }}>
                  {countdown === "Closed" || !countdown ? "Closed" : `Closes in ${countdown}`}
                </div>
              </div>
            </StageCard>
          );
        }
        if (potmMatch?.motm) {
          return (
            <StageCard refProp={s6Ref} style={{ background: "var(--gold2)", border: "1px solid var(--goldb)" }}>
              <StageLbl>PLAYER OF THE MATCH 🏆</StageLbl>
              <div style={{ textAlign: "center" }}>
                <Trophy size={32} weight="thin" color="var(--gold)" />
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)", marginTop: 8, letterSpacing: "0.04em" }}>
                  {resolveMotm(potmMatch.motm, squad)}
                </div>
                <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 4, fontWeight: 300 }}>
                  wins POTM tonight
                </div>
              </div>
            </StageCard>
          );
        }
        return (
          <StageCard refProp={s6Ref}>
            <StageLbl>PLAYER OF THE MATCH 🏆</StageLbl>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>No winner yet</span>
              <button onClick={onBack} style={{
                padding: "7px 14px", borderRadius: 8,
                background: "none", border: "1px solid var(--goldb)",
                color: "var(--gold)", fontFamily: "var(--font-body)", fontSize: 12,
                cursor: "pointer", fontWeight: 500,
              }}>Admin Decide →</button>
            </div>
          </StageCard>
        );
      })()}

      {/* ── STAGE 7 — SAVE ──────────────────────────────────────────────────── */}
      {canSave && !saved && (
        <motion.div
          ref={saveRef}
          initial={{ opacity: 0, scale: 0.92, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          style={{ marginTop: 4 }}
        >
          {saveError && (
            <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center", marginBottom: 10, fontWeight: 300 }}>
              {saveError}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              width: "100%", height: 56, borderRadius: 12, border: "none",
              background: isSaving ? "var(--s3)" : "var(--green)",
              color: isSaving ? "var(--t2)" : "var(--bg)",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.08em",
              cursor: isSaving ? "not-allowed" : "pointer",
              boxShadow: isSaving ? "none" : "0 0 20px rgba(61,220,106,0.3)",
            }}
          >
            {isSaving ? "SAVING..." : "SAVE RESULT 💾"}
          </button>
        </motion.div>
      )}

      {/* ── SWITCH CONFIRM MODAL ────────────────────────────────────────────── */}
      {switchConfirm && (
        <div
          onClick={() => setSwitchConfirm(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 300,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 20px",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--s2)",
              border: "0.5px solid rgba(255,255,255,0.1)",
              borderRadius: 16, maxWidth: 360, width: "100%",
              padding: 24,
            }}
          >
            {switchConfirm.undo ? (
              <>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", letterSpacing: "0.06em" }}>
                  UNDO SWITCH?
                </div>
                <div style={{ fontSize: 13, fontWeight: 300, color: "var(--t2)", marginTop: 8 }}>
                  Move {switchConfirm.playerA.name} back to their original team?
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", letterSpacing: "0.06em" }}>
                  SWITCH THESE PLAYERS?
                </div>
                <div style={{ fontSize: 13, fontWeight: 300, color: "var(--t2)", marginTop: 8 }}>
                  {switchConfirm.playerA.name} ({switchConfirm.playerA.team === "A" ? "Team A" : "Team B"}) and {switchConfirm.playerB.name} ({switchConfirm.playerB.team === "A" ? "Team A" : "Team B"})
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
              <button
                onClick={() => {
                  if (switchConfirm.undo) {
                    setSwitches(prev => prev.filter(s => s.playerId !== switchConfirm.playerA.id));
                  } else {
                    setSwitches(prev => [
                      ...prev,
                      { playerId: switchConfirm.playerA.id, from: switchConfirm.playerA.team },
                      { playerId: switchConfirm.playerB.id, from: switchConfirm.playerB.team },
                    ]);
                  }
                  setSwitchConfirm(null);
                }}
                style={{
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.08em",
                  color: "var(--green)", background: "var(--green2)", border: "1px solid var(--greenb)",
                  borderRadius: 10, padding: "10px 24px", cursor: "pointer",
                }}
              >
                YES
              </button>
              <button
                onClick={() => setSwitchConfirm(null)}
                style={{
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.08em",
                  color: "var(--t2)", background: "var(--s3)", border: "0.5px solid rgba(255,255,255,0.1)",
                  borderRadius: 10, padding: "10px 24px", cursor: "pointer",
                }}
              >
                NO
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const backBtn = {
  background: "none", border: "none", cursor: "pointer",
  padding: 4, display: "flex",
};
