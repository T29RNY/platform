import { useState, useEffect } from "react";
import { Trophy, SealCheck, CheckCircle, Crown, Timer, X } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { submitPOTMVote } from "@platform/core/storage/supabase.js";
import { resolveMotm } from "@platform/core";

// Team accent hex — the ONLY two hardcoded colours the hygiene gate allows.
// All team tints below are derived from these via string concatenation (e.g.
// `${tc}40`), so no other hex literal ever appears in this file.
const TEAM_A = "#60A0FF";
const TEAM_B = "#FF6060";

// Clearance for the fixed bottom NavBar (position:fixed;bottom:0, height ≈
// 54px + max(26px, safe-area-inset-bottom)) plus a small gap. The overlay
// reserves this at the bottom so the centred card sits ABOVE the nav rather
// than tucking its lower edge behind it.
const NAV_CLEAR = "calc(70px + max(26px, env(safe-area-inset-bottom)))";

// Inject the modal's keyframes + press-utility classes once. Fresh page loads
// (production) get the full set; the id-guard just avoids duplicate <style>
// nodes across hot module evals.
if (typeof document !== "undefined" && !document.getElementById("potm-styles")) {
  const el = document.createElement("style");
  el.id = "potm-styles";
  el.textContent = `
    @keyframes potm-pulse{0%,100%{box-shadow:0 0 0 0 rgba(232,160,32,0)}50%{box-shadow:0 0 14px 1px var(--goldb)}}
    @keyframes breathe{0%,100%{box-shadow:0 30px 70px -20px rgba(0,0,0,.7),0 0 42px rgba(232,160,32,.16),0 0 0 1px var(--goldb)}50%{box-shadow:0 34px 80px -18px rgba(0,0,0,.72),0 0 72px rgba(232,160,32,.32),0 0 0 1px rgba(232,160,32,.62)}}
    @keyframes burst{0%{transform:translate(0,0) scale(.3);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
    @keyframes sealPop{0%{transform:scale(0) rotate(-28deg);opacity:0}55%{transform:scale(1.2) rotate(6deg)}75%{transform:scale(.92)}100%{transform:scale(1) rotate(0);opacity:1}}
    @keyframes trophyIn{0%{transform:rotate(-220deg) scale(0);opacity:0}60%{transform:rotate(12deg) scale(1.16);opacity:1}100%{transform:rotate(0) scale(1)}}
    @keyframes glowPulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.95;transform:scale(1.14)}}
    @keyframes ambient{0%,100%{opacity:.5;transform:translate(-50%,0) scale(1)}50%{opacity:.85;transform:translate(-50%,-14px) scale(1.06)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    .potm-press90:active{transform:scale(0.9)}
    .potm-press94:active{transform:scale(0.94)}
  `;
  document.head.appendChild(el);
}

function countdown(closesAt) {
  if (!closesAt) return "";
  const diff = Math.max(0, new Date(closesAt) - Date.now());
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (m <= 0 && s <= 0) return "Closed";
  return `${m}m ${s}s`;
}

// Gold particle burst — 16 dots flung outward on a stagger. Built in JS so each
// particle carries its own --dx/--dy vector + delay (matches the prototype).
function GoldBurst() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      {Array.from({ length: 16 }).map((_, i) => {
        const ang = (i / 16) * Math.PI * 2;
        const dist = i % 3 === 0 ? 82 : 62;
        const sz = i % 4 === 0 ? 8 : 5;
        return (
          <span
            key={i}
            style={{
              position: "absolute", width: sz, height: sz, borderRadius: "50%",
              background: i % 2 ? "var(--gold)" : "var(--amber)",
              "--dx": `${Math.cos(ang) * dist}px`,
              "--dy": `${Math.sin(ang) * dist}px`,
              animation: `burst 0.85s ${(0.015 * i).toFixed(3)}s cubic-bezier(.2,.8,.2,1) both`,
            }}
          />
        );
      })}
    </div>
  );
}

export default function POTMVotingModal({
  matchId, teamId, voterId, voterToken, voterName,
  eligiblePlayers, hasVoted, existingVote,
  votingOpen, votingClosesAt, motm, onClose,
  tally = [], totalVotes = 0, onVoted,
}) {
  // State machine: idle → selected → locked (via submit). Two-tap commit.
  const [selected,   setSelected]   = useState(null);
  const [phase,      setPhase]      = useState("idle"); // idle|selected|locked
  const [timeLeft,   setTimeLeft]   = useState(countdown(votingClosesAt));
  const [error,      setError]       = useState(null);
  const [submitting, setSubmitting]  = useState(false);
  // Bar-grow choreography: flipped ~520ms after entering a tally state so the
  // reveal reads burst → hero → bars grow. Pure local UI state.
  const [barsReady,  setBarsReady]   = useState(false);

  // Show result only when voting is closed AND a winner has been set
  const isResult  = !votingOpen && !!motm;
  const showLocked = !hasVoted && !isResult && phase === "locked";
  const showVoted  = hasVoted && !isResult;
  const inTally    = showLocked || showVoted || isResult;

  // Tick countdown every 1s (livelier than the old 10s cadence); clear on unmount.
  useEffect(() => {
    if (!votingClosesAt) return;
    const t = setInterval(() => setTimeLeft(countdown(votingClosesAt)), 1000);
    return () => clearInterval(t);
  }, [votingClosesAt]);

  // Drive the bar-grow once a tally state is on screen.
  useEffect(() => {
    if (!inTally) { setBarsReady(false); return; }
    setBarsReady(false);
    const t = setTimeout(() => setBarsReady(true), 520);
    return () => clearTimeout(t);
  }, [inTally, showLocked, showVoted, isResult]);

  const teamA = eligiblePlayers.filter(p => p.team === "A");
  const teamB = eligiblePlayers.filter(p => p.team === "B");

  const handleSelect = (player) => {
    if (hasVoted || isResult || submitting) return;
    setSelected(player);
    setPhase("selected");
    setError(null);
  };

  const handleChange = () => {
    setPhase("idle");
    setSelected(null);
  };

  const submitVote = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitPOTMVote(voterToken, matchId, teamId, selected.id);
      if (result?.error === "already_voted") {
        setPhase("locked");
        onVoted?.();
        return;
      }
      setPhase("locked");
      onVoted?.();
    } catch (e) {
      setError("Failed to submit. Try again.");
      setPhase("selected");
    } finally {
      setSubmitting(false);
    }
  };

  const dispName = (p) => (p?.nickname || p?.name || "Unknown");
  const votedPlayer = existingVote ? eligiblePlayers.find(p => p.id === existingVote) : null;
  const winnerName = resolveMotm(motm, eligiblePlayers); // already nickname||name

  // Live tally — server-gated (arrives empty until the voter has voted). Names
  // + initials all honour the nickname-first convention. Voter's pick =
  // existingVote || selected?.id (the current myPick logic).
  const nameFor = (id) => dispName(eligiblePlayers.find(x => x.id === id));
  const teamHexOf = (id) => (eligiblePlayers.find(x => x.id === id)?.team === "B" ? TEAM_B : TEAM_A);
  const myPick = existingVote || selected?.id || null;

  const renderTally = () => {
    if (!tally || tally.length === 0) return null;
    const maxVotes = tally[0]?.votes || 1;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--t2)" }}>
            Live tally
          </span>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.04em", color: "var(--gold)" }}>
            {totalVotes} VOTES
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {tally.map((row, i) => {
            const isWinner = i === 0;
            const isMine   = row.nominee_id === myPick;
            const tc       = teamHexOf(row.nominee_id);
            const pct      = Math.round((row.votes / maxVotes) * 100);
            return (
              <div key={row.nominee_id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <div style={{
                      flex: "0 0 auto", width: 28, height: 28, borderRadius: "50%",
                      display: "grid", placeItems: "center",
                      fontFamily: "var(--font-display)", fontSize: 15, lineHeight: 1, color: tc,
                      background: `${tc}22`, border: `1px solid ${tc}55`,
                    }}>
                      {nameFor(row.nominee_id).charAt(0).toUpperCase()}
                    </div>
                    <span style={{
                      fontSize: 14, fontWeight: 500, color: "var(--t1)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {nameFor(row.nominee_id)}
                    </span>
                    {isWinner && <Crown weight="thin" size={16} color="var(--gold)" style={{ flex: "0 0 auto" }} />}
                    {isMine && (
                      <span style={{
                        flex: "0 0 auto", fontSize: 9, letterSpacing: "0.1em", fontWeight: 700,
                        color: "var(--gold)", background: "var(--gold2)", border: "0.5px solid var(--goldb)",
                        borderRadius: "var(--r-pill)", padding: "3px 7px", whiteSpace: "nowrap",
                      }}>
                        YOUR VOTE
                      </span>
                    )}
                  </div>
                  <span style={{
                    flex: "0 0 auto", fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1,
                    letterSpacing: "0.02em", color: isWinner ? "var(--gold)" : "var(--t1)",
                  }}>
                    {row.votes}
                  </span>
                </div>
                <div style={{ height: 7, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 4,
                    width: barsReady ? `${pct}%` : "0%",
                    background: isWinner ? "var(--gold)" : "rgba(240,240,235,0.22)",
                    boxShadow: isWinner ? "0 0 12px rgba(232,160,32,0.45)" : "none",
                    transition: "width 0.9s cubic-bezier(.2,.8,.2,1)",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const isVoting = !hasVoted && !isResult && phase !== "locked";

  return (
    <div
      onClick={onClose}
      data-tour-suppress="potm-vote"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        // Top: clear the notch / Dynamic Island (safe-area-inset-top) so a tall
        // full-squad card never tucks its header + ✕ behind the status bar.
        // Bottom: reserve the fixed NavBar height (NAV_CLEAR) — see #334.
        paddingTop: "max(20px, env(safe-area-inset-top))",
        paddingLeft: 20, paddingRight: 20,
        paddingBottom: NAV_CLEAR,
        overflowY: "auto",
      }}>
      {/* Ambient gold glow drifting behind the modal (decorative). */}
      <div style={{
        position: "fixed", top: "8%", left: "50%", width: 520, height: 520, borderRadius: "50%",
        background: "radial-gradient(circle,rgba(232,160,32,0.12),transparent 62%)",
        filter: "blur(22px)", pointerEvents: "none", zIndex: 0,
        transform: "translate(-50%,0)", animation: "ambient 8s ease-in-out infinite",
      }} />
      <motion.div
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        style={{
          position: "relative", zIndex: 1,
          width: "100%", maxWidth: 320,
          maxHeight: `calc(100dvh - max(20px, env(safe-area-inset-top)) - ${NAV_CLEAR})`,
          display: "flex", flexDirection: "column",
          background: "linear-gradient(180deg,var(--s1-hi),var(--s1) 40%)",
          borderRadius: "var(--r)",
          border: "1px solid var(--goldb)",
          overflow: "hidden",
          animation: "breathe 5s ease-in-out infinite",
        }}>
        {/* Top sheen — pinned to the modal's top edge. */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 90,
          background: "linear-gradient(180deg,rgba(255,255,255,0.07),transparent)",
          pointerEvents: "none", zIndex: 30,
        }} />

        {/* Header (pinned) */}
        <div style={{
          flex: "0 0 auto", padding: "16px 18px 13px",
          borderBottom: "0.5px solid var(--border-subtle)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--gold)" }}>
                Player of the Match
              </div>
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 29, letterSpacing: "0.04em",
                color: "var(--t1)", lineHeight: 1.05, marginTop: 3,
              }}>
                {isResult ? "POTM RESULT" : "VOTE FOR POTM"}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="potm-press90"
              style={{
                flex: "0 0 auto", width: 34, height: 34, borderRadius: "50%",
                background: "var(--s2)", border: "0.5px solid var(--border-subtle)",
                color: "var(--t2)", display: "grid", placeItems: "center", cursor: "pointer",
                WebkitTapHighlightColor: "transparent", transition: "transform .15s",
              }}
            >
              <X weight="thin" size={19} />
            </button>
          </div>
          {isVoting && votingClosesAt && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
              background: "var(--s2)", border: "0.5px solid var(--border-subtle)",
              borderRadius: "var(--r-pill)", padding: "5px 11px", marginTop: 11,
            }}>
              <Timer weight="thin" size={15} color="var(--gold)" />
              <span style={{ fontSize: 12, color: "var(--t2)", whiteSpace: "nowrap" }}>
                {timeLeft === "Closed" ? "Closed" : `Closes in ${timeLeft}`}
              </span>
            </div>
          )}
        </div>

        {/* Content (the only scrolling region) */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 16 }}>

          {/* State A — Voting */}
          {isVoting && (() => {
            const renderTile = (player) => {
              const isMe  = player.id === voterId;
              const isSel = selected?.id === player.id;
              const tc    = player.team === "B" ? TEAM_B : TEAM_A;
              const baseTileStyle = {
                display: "flex", alignItems: "center", gap: 12, padding: 12,
                borderRadius: "var(--rs)",
                borderTop: "0.5px solid rgba(255,255,255,0.09)",
                borderLeft: "0.5px solid rgba(255,255,255,0.04)",
                borderRight: "0.5px solid rgba(255,255,255,0.04)",
                borderBottom: "0.5px solid rgba(0,0,0,0.4)",
                background: "linear-gradient(180deg,var(--tile-hi),var(--tile-lo))",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07),0 4px 0 rgba(0,0,0,0.35),0 9px 16px -4px rgba(0,0,0,0.5)",
                transition: "background .25s ease,border-color .25s ease,box-shadow .25s ease,transform .12s ease",
              };
              const tileStyle = isMe
                ? { ...baseTileStyle, opacity: 0.5 }
                : isSel
                  ? { ...baseTileStyle, background: "var(--gold2)", border: "1px solid var(--goldb)", boxShadow: "0 0 22px rgba(232,160,32,0.18)" }
                  : baseTileStyle;
              return (
                <div key={player.id} style={tileStyle}>
                  <div style={{
                    flex: "0 0 auto", width: 38, height: 38, borderRadius: "50%",
                    display: "grid", placeItems: "center",
                    fontFamily: "var(--font-display)", fontSize: 19, lineHeight: 1, color: tc,
                    background: `radial-gradient(120% 120% at 35% 25%,${tc}40,${tc}18)`,
                    border: `1px solid ${tc}66`,
                    boxShadow: "0 3px 7px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.15)",
                  }}>
                    {dispName(player).charAt(0).toUpperCase()}
                  </div>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, color: "var(--t1)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {dispName(player)}
                  </span>
                  {isMe && (
                    <span style={{
                      flex: "0 0 auto", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                      color: "var(--t2)", border: "0.5px solid var(--border-subtle)",
                      borderRadius: "var(--r-pill)", padding: "4px 9px",
                    }}>
                      You
                    </span>
                  )}
                  {!isMe && !isSel && (
                    <button
                      onClick={() => handleSelect(player)}
                      disabled={submitting}
                      className="potm-press94"
                      style={{
                        flex: "0 0 auto", fontSize: 13, fontWeight: 600, color: "var(--gold)",
                        background: "transparent", border: "1px solid var(--goldb)",
                        borderRadius: "var(--r-button)", padding: "8px 18px",
                        cursor: submitting ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                        transition: "transform .12s,background .2s",
                        animation: "potm-pulse 2.4s ease-in-out infinite",
                      }}
                    >
                      Vote
                    </button>
                  )}
                  {!isMe && isSel && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
                      <button
                        onClick={handleChange}
                        style={{
                          fontSize: 12, color: "var(--t2)", background: "transparent", border: "none",
                          cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "3px",
                        }}
                      >
                        Change
                      </button>
                      <button
                        onClick={submitVote}
                        disabled={submitting}
                        className="potm-press94"
                        style={{
                          fontSize: 13, fontWeight: 700, color: "var(--bg)", background: "var(--gold)",
                          border: "none", borderRadius: "var(--r-button)", padding: "8px 16px",
                          cursor: submitting ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                          boxShadow: "0 0 18px rgba(232,160,32,0.55)", transition: "transform .12s",
                        }}
                      >
                        Confirm →
                      </button>
                    </div>
                  )}
                </div>
              );
            };
            const renderSection = (players, label, dotHex) => (
              players.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotHex }} />
                    <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--t2)" }}>
                      {label}
                    </span>
                  </div>
                  {players.map(renderTile)}
                </div>
              )
            );
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeUp .45s ease both" }}>
                <div style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.45 }}>
                  Who was tonight's standout?{" "}
                  <span style={{ color: "var(--t1)" }}>Pick one — two taps to lock it in.</span>
                </div>
                {renderSection(teamA, "Team A", TEAM_A)}
                {renderSection(teamB, "Team B", TEAM_B)}
                {teamA.length === 0 && teamB.length === 0 && renderSection(eligiblePlayers, "Players", TEAM_A)}
              </div>
            );
          })()}

          {/* State B — Locked (just voted) */}
          {showLocked && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18, animation: "fadeUp .45s ease both" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "6px 0 2px" }}>
                <div style={{ position: "relative", display: "grid", placeItems: "center", width: 100, height: 100 }}>
                  <GoldBurst />
                  <div style={{
                    position: "absolute", inset: 6, borderRadius: "50%",
                    background: "radial-gradient(circle,var(--gold2),transparent 68%)",
                    animation: "glowPulse 3s ease-in-out infinite",
                  }} />
                  <div style={{ position: "relative", animation: "sealPop 0.7s cubic-bezier(.2,.9,.3,1.2) both" }}>
                    <SealCheck weight="thin" size={72} color="var(--gold)" />
                  </div>
                </div>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 32, letterSpacing: "0.05em", color: "var(--t1)", marginTop: 8 }}>
                  VOTE LOCKED IN
                </span>
                <span style={{ fontSize: 13, color: "var(--t2)", marginTop: 2 }}>
                  You voted for <span style={{ color: "var(--gold)", fontWeight: 600 }}>{dispName(selected)}</span>
                </span>
              </div>
              {renderTally()}
            </div>
          )}

          {/* State C — Already voted (returning) */}
          {showVoted && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18, animation: "fadeUp .45s ease both" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 13,
                background: "var(--gold2)", border: "1px solid var(--goldb)",
                borderRadius: "var(--r)", padding: "14px 15px",
              }}>
                <CheckCircle weight="thin" size={36} color="var(--gold)" style={{ flex: "0 0 auto" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--gold)" }}>
                    Your vote is in
                  </div>
                  <div style={{ fontSize: 15, color: "var(--t1)", marginTop: 3 }}>
                    You voted for <span style={{ color: "var(--gold)", fontWeight: 600 }}>{dispName(votedPlayer)}</span>
                  </div>
                </div>
              </div>
              {renderTally()}
            </div>
          )}

          {/* State D — Result */}
          {isResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "fadeUp .45s ease both" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "8px 0 0" }}>
                <div style={{ position: "relative", display: "grid", placeItems: "center", width: 130, height: 120 }}>
                  <GoldBurst />
                  <div style={{
                    position: "absolute", inset: 8, borderRadius: "50%",
                    background: "radial-gradient(circle,var(--gold2),transparent 66%)",
                    animation: "glowPulse 3.4s ease-in-out infinite",
                  }} />
                  <div style={{ position: "relative", animation: "trophyIn 0.95s cubic-bezier(.2,.85,.25,1.05) both" }}>
                    <Trophy weight="thin" size={92} color="var(--gold)" />
                  </div>
                </div>
                <span style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--t2)", marginTop: 6 }}>
                  Player of the Match
                </span>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: 46, letterSpacing: "0.03em",
                  color: "var(--gold)", lineHeight: 1, marginTop: 4,
                }}>
                  {winnerName || "Unknown"}
                </span>
                <span style={{ fontSize: 14, color: "var(--t2)", marginTop: 4 }}>
                  wins POTM tonight!
                </span>
              </div>
              {renderTally()}
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center", marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer (pinned) */}
        <div style={{ flex: "0 0 auto", padding: "11px 18px 15px", borderTop: "0.5px solid var(--border-subtle)" }}>
          <button
            onClick={onClose}
            style={{
              width: "100%", textAlign: "center", fontSize: 13, color: "var(--t2)",
              background: "transparent", border: "none", cursor: "pointer", padding: 7,
              fontFamily: "var(--font-body)", transition: "color .2s",
            }}
          >
            {isVoting ? "skip — I'll decide later" : "Close"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
