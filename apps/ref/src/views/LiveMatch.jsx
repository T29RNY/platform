// ============================================================
// LiveMatch — the core tool. Faithful re-skin of the artifact's
// live.jsx, wired to the real @platform/core ref wrappers and the
// IndexedDB offline queue. Houses the load-bearing optimistic /
// IDB-before-network / undo / drain machinery, the pause-aware clock
// (survives screen-lock), wake-lock, and the Ref V2 features:
// sin bin, incident notes, clock pause (offline-safe), persisted
// added time, and a config-driven clock that counts toward the
// resolved period length and prompts half/full time.
// ============================================================
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  getFixtureStateByRefToken,
  refRecordGoal,
  refRecordCard,
  refRecordSubstitution,
  refSetPeriod,
  refSetClock,
  refRecordNote,
  refRecordSinBin,
  refSetAddedTime,
  refUndoEvent,
  refConfirmFullTime,
  refRecordKnockoutDecider,
  refSetTournamentPeriod,
  refRecordTournamentGoal,
  refUndoTournamentGoal,
  refConfirmTournamentMatch,
  refRecordTournamentCard,
} from "@platform/core/storage/supabase.js";
import {
  enqueue,
  deletePending,
  listPending,
  isPending,
  fireQueued,
} from "../lib/offlineQueue.js";
import { useClockOwner } from "../lib/clockOwner.js";
import {
  uuid, nowISO, derivePeriod, deriveScore, hasLineup, isSuspended,
  playerStatus, sinBinRemaining, vibrate, elapsedMs, fmtClock,
  currentMinute, LOCKED_PERIODS, resolveFormat,
} from "../lib/engine.js";
import {
  GoalDot, OGDot, CardGlyph, SubGlyph, PauseIcon, PlayIcon, CheckIcon,
  FlagIcon, NoteGlyph, SinBinGlyph, ListGlyph, PlusIcon, DaylightToggle,
  Swatch, SwatchBar, Badges,
} from "../components/ui.jsx";

const sortEv = (list) => [...list].sort((a, b) => (a.minute - b.minute) || ((a.created_at || a.local_timestamp || "").localeCompare(b.created_at || b.local_timestamp || "")));

// ---------- penalty shootout logic (ABAB, best-of-5 then sudden death) ----------
function shootoutState(kicks, firstTeam) {
  let homeScored = 0, awayScored = 0, homeTaken = 0, awayTaken = 0;
  kicks.forEach((k) => { if (k.team === "home") { homeTaken++; if (k.scored) homeScored++; } else { awayTaken++; if (k.scored) awayScored++; } });
  let decided = false, winner = null;
  if (homeTaken <= 5 && awayTaken <= 5 && !(homeTaken === 5 && awayTaken === 5)) {
    const homeRem = 5 - homeTaken, awayRem = 5 - awayTaken;
    if (homeScored > awayScored + awayRem) { decided = true; winner = "home"; }
    else if (awayScored > homeScored + homeRem) { decided = true; winner = "away"; }
  }
  if (homeTaken === 5 && awayTaken === 5 && homeScored !== awayScored) { decided = true; winner = homeScored > awayScored ? "home" : "away"; }
  if (homeTaken > 5 && homeTaken === awayTaken && homeScored !== awayScored) { decided = true; winner = homeScored > awayScored ? "home" : "away"; }
  const other = firstTeam === "home" ? "away" : "home";
  const turnTeam = (kicks.length % 2 === 0) ? firstTeam : other;
  const turnKickNo = kicks.filter((k) => k.team === turnTeam).length + 1;
  return { homeScored, awayScored, homeTaken, awayTaken, decided, winner, turnTeam, turnKickNo };
}

// ---------- action sheet ----------
function ActionSheet({ player, events, onGoal, onOwnGoal, onYellow, onRed, onSub, onSinBin, onNote, sinBinActive, onClose }) {
  const st = playerStatus(events, player.id);
  const cardsBlocked = st.red; // red locks further cards
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <span className="shirt">{player.shirt_number ?? "—"}</span>
          <div style={{ flex: 1 }}>
            <div className="nm">{player.name}</div>
            <div className="sub" style={sinBinActive ? { color: "var(--amber)" } : undefined}>{sinBinActive ? "In sin bin — off the pitch" : (isSuspended(player) ? "Suspended — recording anyway" : "Log an event")}</div>
          </div>
          <Badges st={st} />
        </div>
        <div className="act-grid">
          <button className="act act-goal" disabled={sinBinActive} onClick={onGoal}>
            <span className="ico"><GoalDot s={26} /></span><span className="lbl">Goal</span>
          </button>
          <button className="act act-yellow" disabled={cardsBlocked} onClick={onYellow}>
            <span className="ico"><CardGlyph w={19} h={26} /></span><span>Yellow</span>
          </button>
          <button className="act act-red" disabled={cardsBlocked} onClick={onRed}>
            <span className="ico"><CardGlyph red w={19} h={26} /></span><span>Red</span>
          </button>
          <button className="act" disabled={sinBinActive} onClick={onSub}>
            <span className="ico"><SubGlyph s={26} /></span><span>Sub off</span>
          </button>
        </div>
        <div className="act-secondary three">
          <button className="act-sec og" disabled={sinBinActive} onClick={onOwnGoal}><OGDot s={16} /> Own goal</button>
          <button className="act-sec sinbin" disabled={cardsBlocked || sinBinActive} onClick={onSinBin}><SinBinGlyph s={16} c="currentColor" /> {sinBinActive ? "In bin" : "Sin bin"}</button>
          <button className="act-sec note" onClick={onNote}><NoteGlyph s={16} c="currentColor" /> Note</button>
        </div>
        <button className="sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- sub picker ----------
function SubPicker({ offPlayer, squad, onPick, onClose }) {
  const others = squad.filter((p) => p.id !== offPlayer.id);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <span className="shirt" style={{ opacity: 0.6 }}>{offPlayer.shirt_number ?? "—"}</span>
          <div style={{ flex: 1 }}>
            <div className="nm">Sub off: {offPlayer.name}</div>
            <div className="sub">Who comes on?</div>
          </div>
        </div>
        <div className="sub-list">
          {others.map((p) => (
            <div className="sub-row" key={p.id} onClick={() => onPick(p)}>
              <span className="shirt" style={{ width: 32, height: 32, fontSize: 14 }}>{p.shirt_number ?? "—"}</span>
              <div className="nm" style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{p.name}</div>
              <SubGlyph s={18} />
            </div>
          ))}
        </div>
        <button className="sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- confirm: two yellows ----------
function ConfirmRed({ player, onYes, onNo }) {
  return (
    <div className="scrim center" onClick={onNo}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Second yellow?</h3>
        <p><strong>{player.name}</strong> already has a yellow. Showing another records a second yellow <em>and</em> a red.</p>
        <div className="dialog-row">
          <button className="btn btn-ghost" onClick={onNo}>Cancel</button>
          <button className="btn" style={{ background: "var(--red)", color: "#fff" }} onClick={onYes}>Show red</button>
        </div>
      </div>
    </div>
  );
}

// ---------- full-time confirm ----------
function FTModal({ home, away, hs, as, busy, onConfirm, onCancel }) {
  return (
    <div className="scrim center" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Confirm full time?</h3>
        <div className="disp tabnum" style={{ fontSize: 40, textAlign: "center", margin: "6px 0 14px" }}>{hs} <span style={{ color: "var(--txt3)" }}>–</span> {as}</div>
        <p>No more events can be added after this. The venue admin can still correct the record later.</p>
        <div className="dialog-row">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>{busy ? "Confirming…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- decider (level knockout) ----------
function Stepper({ val, set }) {
  return (
    <div className="stepper">
      <button onClick={() => set(Math.max(0, val - 1))}>−</button>
      <span className="val tabnum">{val}</span>
      <button onClick={() => set(val + 1)}>+</button>
    </div>
  );
}
function KickSlots({ teamKey, kicks }) {
  const teamKicks = kicks.filter((k) => k.team === teamKey);
  const slots = Math.max(5, teamKicks.length);
  const arr = [];
  for (let i = 0; i < slots; i++) {
    const k = teamKicks[i];
    arr.push(<span key={i} className={"kick" + (k ? (k.scored ? " scored" : " missed") : "") + (i >= 5 ? " sd" : "")} />);
  }
  return <div className="kicks">{arr}</div>;
}
function DeciderModal({ home, away, hs, as, busy, onSave, onCancel }) {
  const [aetH, setAetH] = useState(0), [aetA, setAetA] = useState(0);
  const [kicks, setKicks] = useState([]);
  const [firstTeam, setFirstTeam] = useState("home");
  const [winner, setWinner] = useState(null);
  const so = shootoutState(kicks, firstTeam);
  useEffect(() => { if (so.decided) setWinner(so.winner === "home" ? home.id : away?.id); }, [so.decided, so.winner]);
  const aetFilled = aetH > 0 || aetA > 0;
  const canSave = winner && (aetFilled || kicks.length > 0);
  const addKick = (scored) => { if (so.decided) return; vibrate(scored ? 16 : 10); setKicks([...kicks, { team: so.turnTeam, scored }]); };
  const turnName = (so.turnTeam === "home" ? home.name : (away?.name || "Away")).split(" ")[0];
  const inSD = so.homeTaken >= 5 && so.awayTaken >= 5;
  return (
    <div className="scrim" onClick={busy ? undefined : onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head"><div style={{ flex: 1 }}><div className="nm">Decider</div><div className="sub">Level at full time · {hs}–{as} after normal time</div></div></div>
        <div style={{ overflowY: "auto" }}>
          <div className="subhead" style={{ paddingLeft: 4 }}>Extra time (optional)</div>
          <div className="num-grid">
            <div className="num-cell"><label>{home.name.split(" ")[0]}</label><Stepper val={aetH} set={setAetH} /></div>
            <div style={{ color: "var(--txt3)", fontWeight: 800 }}>–</div>
            <div className="num-cell"><label>{(away?.name || "Away").split(" ")[0]}</label><Stepper val={aetA} set={setAetA} /></div>
          </div>
          <div className="subhead" style={{ paddingLeft: 4 }}>Penalty shootout</div>
          {kicks.length === 0 && (
            <div className="so-first">
              <span className="lbl">First kick</span>
              <div className="opts">
                <button className={firstTeam === "home" ? "sel" : ""} onClick={() => setFirstTeam("home")}>{home.name.split(" ")[0]}</button>
                <button className={firstTeam === "away" ? "sel" : ""} onClick={() => setFirstTeam("away")}>{(away?.name || "Away").split(" ")[0]}</button>
              </div>
            </div>
          )}
          <div className="so-board">
            <div className="so-team-row"><span className="nm">{home.name}</span><KickSlots teamKey="home" kicks={kicks} /><span className="tot">{so.homeScored}</span></div>
            <div className="so-team-row"><span className="nm">{away?.name || "Away"}</span><KickSlots teamKey="away" kicks={kicks} /><span className="tot">{so.awayScored}</span></div>
          </div>
          {!so.decided ? (
            <>
              <div className="so-turn">Next: <b>{turnName}</b> · kick {so.turnKickNo}{inSD ? " · sudden death" : ""}</div>
              <div className="so-btns">
                <button className="so-btn so-scored" onClick={() => addKick(true)}>Scored</button>
                <button className="so-btn so-missed" onClick={() => addKick(false)}>Missed</button>
              </div>
              {kicks.length > 0 && <button className="so-undo" onClick={() => setKicks(kicks.slice(0, -1))}>Undo last kick</button>}
            </>
          ) : (
            <div className="so-result">{(so.winner === "home" ? home.name : (away?.name || "Away"))} win {so.homeScored}–{so.awayScored} on penalties</div>
          )}
          <div className="subhead" style={{ paddingLeft: 4 }}>Who goes through?</div>
          <div className="win-toggle">
            <button className={"win-opt" + (winner === home.id ? " sel" : "")} onClick={() => setWinner(home.id)}><Swatch c={home.primary_colour} /> {home.name}</button>
            <button className={"win-opt" + (winner === away?.id ? " sel" : "")} onClick={() => setWinner(away?.id)}><Swatch c={away?.primary_colour} /> {away?.name}</button>
          </div>
        </div>
        <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 14 }} disabled={!canSave || busy}
          onClick={() => onSave({ aetHome: aetH, aetAway: aetA, pensHome: so.homeScored, pensAway: so.awayScored, winnerTeamId: winner })}>
          {busy ? "Saving…" : "Save result"}
        </button>
        <button className="sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- incident note composer ----------
function NoteComposer({ player, onSave, onClose }) {
  const [text, setText] = useState("");
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head"><div style={{ flex: 1 }}><div className="nm">Incident note</div><div className="sub">Filed to the match report for the admin</div></div></div>
        <textarea className="note-area" autoFocus placeholder="Describe the incident — dissent, injury, timewasting, abuse, equipment…" value={text} onChange={(e) => setText(e.target.value)} />
        {player && <div className="note-attach">Attached to <span className="chip"><Swatch c="#5B8CFF" size={9} /> {player.name}</span></div>}
        <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 14 }} disabled={!text.trim()} onClick={() => onSave(text.trim())}>Save note</button>
        <button className="sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- team section ----------
function TeamColumn({ team, squad, events, locked, fixture, onTapPlayer }) {
  if (!squad || squad.length === 0) {
    return <div className="team-sec"><div className="team-head"><SwatchBar c={team?.primary_colour} /><span className="nm">{team?.name || "Team"}</span></div><div className="empty-state">No confirmed squad</div></div>;
  }
  const lineup = hasLineup(squad);
  const ordered = lineup ? [...squad].sort((a, b) => (a.lineup_role === "starting" ? 0 : 1) - (b.lineup_role === "starting" ? 0 : 1)) : squad;
  let benchShown = false;
  const rowFor = (p) => {
    const st = playerStatus(events, p.id);
    const sbSec = sinBinRemaining(st.sinBins, fixture);
    return (
      <div className={"prow" + (locked ? " locked" : "") + (st.red ? " sent-off" : "") + (sbSec > 0 ? " sinbin" : "")} key={p.id} onClick={() => !locked && onTapPlayer(p)}>
        <span className="shirt">{p.shirt_number ?? "—"}</span>
        <div className="who">
          <div className="nm"><span className="t">{p.name}</span>{isSuspended(p) && <span className="flag-susp">Susp</span>}{sbSec > 0 && <span className="sinbin-badge"><SinBinGlyph s={12} /> {Math.floor(sbSec / 60)}:{String(sbSec % 60).padStart(2, "0")}</span>}</div>
          <Badges st={st} />
        </div>
        {!locked && <span className="tap"><PlusIcon s={15} /></span>}
      </div>
    );
  };
  return (
    <div className="team-sec">
      <div className="team-head"><SwatchBar c={team?.primary_colour} /><span className="nm">{team?.name}</span><span className="ct">{squad.length}</span></div>
      {ordered.map((p) => {
        const out = [];
        if (lineup && !benchShown && p.lineup_role === "bench") { benchShown = true; out.push(<div className="subhead" key="bh">Bench</div>); }
        out.push(rowFor(p));
        return out;
      })}
    </div>
  );
}

// ---------- match log + added time sheet ----------
const LOG_ICONS = {
  goal: <GoalDot s={16} />, own_goal: <OGDot s={16} />, yellow_card: <CardGlyph />, red_card: <CardGlyph red />,
  sin_bin: <SinBinGlyph s={16} c="var(--amber)" />, substitution: <SubGlyph s={16} />, note: <NoteGlyph s={16} c="var(--blue)" />, period_change: <span style={{ width: 8, height: 8, borderRadius: 8, background: "var(--txt3)" }} />,
};
function MatchLogSheet({ events, homeSquad, awaySquad, period, curAdded, onAddMin, onSubMin, latestId, onUndo, onAddNote, onClose }) {
  const nameOf = (id) => [...homeSquad, ...awaySquad].find((p) => p.id === id)?.name || "—";
  const labelFor = (e) => {
    switch (e.event_type) {
      case "goal": return `Goal — ${nameOf(e.player_id)}`;
      case "own_goal": return `Own goal — ${nameOf(e.player_id)}`;
      case "yellow_card": return `Yellow — ${nameOf(e.player_id)}`;
      case "red_card": return `Red — ${nameOf(e.player_id)}`;
      case "sin_bin": return `Sin bin — ${nameOf(e.player_id)}`;
      case "substitution": return `${nameOf(e.sub_player_on_id)} on for ${nameOf(e.sub_player_off_id)}`;
      case "note": return e.note_text || "Note";
      case "period_change": return e.period === "HT" ? "Half time" : e.period === "FT" ? "Full time" : e.period === "2H" ? "Second half" : e.period;
      default: return e.event_type;
    }
  };
  const list = [...events].sort((a, b) => (b.minute - a.minute) || ((b.created_at || b.local_timestamp || "").localeCompare(a.created_at || a.local_timestamp || "")));
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head"><div style={{ flex: 1 }}><div className="nm">Match log</div><div className="sub">{list.length} event{list.length === 1 ? "" : "s"} · newest first</div></div></div>
        <div className="addtime">
          <div className="lab">Added time<small>{period} · shown on the big screen</small></div>
          <div className="stepper">
            <button onClick={onSubMin}>−</button>
            <span className="val tabnum">+{curAdded}</span>
            <button onClick={onAddMin}>+</button>
          </div>
        </div>
        <button className="log-addnote" onClick={onAddNote}><NoteGlyph s={15} c="currentColor" /> Add incident note</button>
        <div className="log-list">
          {list.length === 0 ? <div className="log-empty">No events yet.</div> : list.map((e, i) => (
            <div className="log-row" key={e.client_event_id || e.id || i}>
              <span className="log-syncdot" style={{ background: e.synced_at ? "var(--ok)" : "var(--amber)" }} />
              <div className="ico">{LOG_ICONS[e.event_type]}</div>
              <div className={"lbl" + (e.event_type === "note" ? " log-note-text" : "")}>{labelFor(e)}</div>
              {e.client_event_id === latestId && e.event_type !== "period_change"
                ? <button className="log-undo" onClick={() => onUndo([e.client_event_id])}>Undo</button>
                : <div className="min tabnum">{e.minute}′ · {e.period}</div>}
            </div>
          ))}
        </div>
        <button className="sheet-cancel" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ---------- tournament team section (no squad → big goal + card buttons) ----------
function TournamentCardModal({ team, onConfirm, onClose }) {
  const [name, setName] = useState("");
  const [cardType, setCardType] = useState("yellow");
  const busyRef = useRef(false);
  return (
    <div className="overlay-sheet">
      <div className="os-head">
        <span className="nm">{team?.name || "Team"} — Record Card</span>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: "16px 16px 8px" }}>
        <input
          className="txt-input"
          placeholder="Player name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          style={{ width: "100%", marginBottom: 14 }}
        />
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <button
            className={"btn btn-block" + (cardType === "yellow" ? " btn-primary" : " btn-ghost")}
            style={{ flex: 1, background: cardType === "yellow" ? "var(--yellow)" : undefined, color: cardType === "yellow" ? "#000" : undefined }}
            onClick={() => setCardType("yellow")}
          >Yellow</button>
          <button
            className={"btn btn-block" + (cardType === "red" ? " btn-primary" : " btn-ghost")}
            style={{ flex: 1, background: cardType === "red" ? "var(--red)" : undefined }}
            onClick={() => setCardType("red")}
          >Red</button>
        </div>
        <button
          className={"btn btn-primary btn-block" + (!name.trim() ? " disabled" : "")}
          disabled={!name.trim()}
          style={{ height: 52 }}
          onClick={() => {
            if (!name.trim() || busyRef.current) return;
            busyRef.current = true;
            onConfirm(name.trim(), cardType);
          }}
        >Record Card</button>
        <button className="btn btn-ghost btn-block" style={{ height: 46, marginTop: 8 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function TournamentGoalButton({ team, locked, onGoal, onCard }) {
  return (
    <div className="team-sec">
      <div className="team-head">
        <SwatchBar c={team?.primary_colour} />
        <span className="nm">{team?.name || "Team"}</span>
      </div>
      <div style={{ padding: "6px 0 14px" }}>
        <button
          className={"btn btn-primary btn-block" + (locked ? " disabled" : "")}
          disabled={locked}
          onClick={onGoal}
          style={{ minHeight: 72, fontSize: 20, fontWeight: 800, letterSpacing: "0.22em", paddingLeft: "0.22em" }}
        >
          GOAL
        </button>
        <button
          className={"btn btn-ghost btn-block" + (locked ? " disabled" : "")}
          disabled={locked}
          onClick={onCard}
          style={{ marginTop: 8, height: 44 }}
        >CARD</button>
      </div>
    </div>
  );
}

// ============================================================
// LiveMatch
// ============================================================
export default function LiveMatch({ state, refToken, onRefresh }) {
  const props = state;
  const [events, setEvents] = useState(() => sortEv(props.events || []));
  const [fixture, setFixture] = useState(props.fixture);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncError, setSyncError] = useState(null);
  const [toast, setToast] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const [ftBusy, setFtBusy] = useState(false);
  const [periodFx, setPeriodFx] = useState(null);
  const [returnAlert, setReturnAlert] = useState(null);
  const binActiveRef = useRef(new Set());
  const binDoneRef = useRef(new Set());
  const [, setTick] = useState(0);

  // Phase 0d — single-writer clock lock. Mounted only while in_progress, so claim
  // for the duration. DORMANT: badge + handoff only; writes are not yet blocked.
  const clockOwner = useClockOwner(refToken, true);

  const isTournament = !!props.fixture.home_competition_team_id;
  const [tournamentPeriod, setTournamentPeriod] = useState(
    isTournament ? (props.fixture.current_period || "1H") : "1H"
  );

  const fixtureId = fixture.id;
  const home = props.home_team, away = props.away_team;
  const period = isTournament ? tournamentPeriod : derivePeriod(events);
  const locked = LOCKED_PERIODS.has(period);
  const [hs, as] = isTournament
    ? [fixture.home_score ?? 0, fixture.away_score ?? 0]
    : deriveScore(events, fixture.home_team_id, fixture.away_team_id);
  const paused = !!fixture.clock_paused_at;
  const isOffline = (typeof navigator !== "undefined" && !navigator.onLine);
  const minute = () => currentMinute(fixture);

  // resolved match-format config (league → competition → fixture override)
  const fmt = useMemo(() => resolveFormat(props.match_format), [props.match_format]);

  const teamIdOf = (pid) => props.home_squad.some((p) => p.id === pid) ? fixture.home_team_id : fixture.away_team_id;

  // ---- the real RPC surface, bound to this ref token (keeps the body verbatim) ----
  const rpc = useMemo(() => ({
    getFixtureStateByRefToken: () => getFixtureStateByRefToken(refToken),
    refRecordGoal: (_t, a) => refRecordGoal(refToken, a),
    refRecordCard: (_t, a) => refRecordCard(refToken, a),
    refRecordSubstitution: (_t, a) => refRecordSubstitution(refToken, a),
    refRecordSinBin: (_t, a) => refRecordSinBin(refToken, a),
    refRecordNote: (_t, a) => refRecordNote(refToken, a),
    refSetPeriod: (_t, p, cid, lt) => refSetPeriod(refToken, p, cid, lt),
    refSetClock: (_t, action, cid, lt) => refSetClock(refToken, action, cid, lt),
    refUndoEvent: (_t, cid) => refUndoEvent(refToken, cid),
    refConfirmFullTime: () => refConfirmFullTime(refToken),
    refRecordKnockoutDecider: (_t, p) => refRecordKnockoutDecider(refToken, p),
  }), [refToken]);

  // ---- clock repaint ----
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);

  // ---- wake lock (keep screen on during live match) ----
  useEffect(() => {
    let lock = null, released = false;
    const acquire = async () => { try { if (navigator.wakeLock) lock = await navigator.wakeLock.request("screen"); } catch (e) {} };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible" && !released) acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { released = true; document.removeEventListener("visibilitychange", onVis); try { lock && lock.release(); } catch (e) {} };
  }, []);

  // ---- beforeunload guard while pending ----
  useEffect(() => {
    const h = (e) => { if (pendingCount > 0) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [pendingCount]);

  // ---- drain queue ----
  const refreshPending = useCallback(async () => { const q = await listPending(fixtureId); setPendingCount(q.length); return q; }, [fixtureId]);
  const reconcile = useCallback(async (serverEvents) => {
    const q = await listPending(fixtureId);
    const ids = new Set(serverEvents.map((e) => e.client_event_id));
    const extra = q.filter((r) => !ids.has(r.client_event_id)).map((r) => r.optimistic).filter(Boolean);
    setEvents(sortEv([...serverEvents, ...extra])); setPendingCount(q.length);
  }, [fixtureId]);
  const drain = useCallback(async () => {
    const q = await listPending(fixtureId);
    for (const row of q) {
      try { await fireQueued(refToken, row); await deletePending(row.client_event_id); }
      catch (e) { setSyncError("Sync failed — tap retry"); await refreshPending(); return; }
    }
    setSyncError(null); await refreshPending();
    try {
      const fresh = await rpc.getFixtureStateByRefToken();
      await reconcile(fresh.events);
      setFixture(fresh.fixture);
      setAddedTime(fresh.fixture.added_time || {});
    } catch (e) {}
  }, [fixtureId, refToken, refreshPending, reconcile, rpc]);

  useEffect(() => { refreshPending(); drain(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const h = () => drain(); window.addEventListener("online", h); return () => window.removeEventListener("online", h); }, [drain]);

  // ---- the write path ----
  const optEv = (over) => ({ id: null, event_type: "goal", minute: 0, period, team_id: null, player_id: null, player_name_override: null, sub_player_on_id: null, sub_player_off_id: null, client_event_id: uuid(), recorded_by_type: "referee", synced_at: null, local_timestamp: nowISO(), created_at: nowISO(), ...over });

  async function commitEvents(list, toastInfo) {
    vibrate(18);
    // 1+2. optimistic
    setEvents((ev) => sortEv([...ev, ...list.map((x) => x.optimistic)]));
    // 4. IndexedDB BEFORE network
    for (const x of list) {
      const row = { client_event_id: x.optimistic.client_event_id, fixture_id: fixtureId, kind: x.kind, args: x.args, local_timestamp: x.optimistic.local_timestamp, created_at: x.optimistic.created_at, optimistic: x.optimistic };
      try { await enqueue(row); }
      catch (e) {
        window.alert("Could not save event on this device. Event not recorded.");
        const ids = list.map((l) => l.optimistic.client_event_id);
        setEvents((ev) => ev.filter((e) => !ids.includes(e.client_event_id))); setToast(null); return;
      }
    }
    setToast({ ...toastInfo, key: Date.now() });
    // 5. pending++
    await refreshPending();
    // 6. network
    let allOk = true;
    for (const x of list) { try { await fireQueued(refToken, { kind: x.kind, args: x.args }); await deletePending(x.optimistic.client_event_id); } catch (e) { allOk = false; } }
    await refreshPending();
    if (allOk) { try { const fresh = await rpc.getFixtureStateByRefToken(); await reconcile(fresh.events); } catch (e) {} }
  }

  const closeOverlay = () => setOverlay(null);

  function doGoal(player, own) {
    const cid = uuid(), m = minute(), lt = nowISO(), tid = teamIdOf(player.id);
    commitEvents([{ kind: "goal", args: { playerId: player.id, minute: m, period, clientEventId: cid, ownGoal: own, localTimestamp: lt },
      optimistic: optEv({ client_event_id: cid, event_type: own ? "own_goal" : "goal", minute: m, team_id: tid, player_id: player.id, local_timestamp: lt }) }],
      { label: `${own ? "Own goal" : "Goal"} — ${player.name}`, icon: own ? "og" : "goal", ids: [cid] });
    closeOverlay();
  }
  function doCard(player, colour) {
    const cid = uuid(), m = minute(), lt = nowISO(), tid = teamIdOf(player.id);
    commitEvents([{ kind: "card", args: { playerId: player.id, minute: m, period, colour, clientEventId: cid, localTimestamp: lt },
      optimistic: optEv({ client_event_id: cid, event_type: colour === "red" ? "red_card" : "yellow_card", minute: m, team_id: tid, player_id: player.id, local_timestamp: lt }) }],
      { label: `${colour === "red" ? "Red" : "Yellow"} — ${player.name}`, icon: colour, ids: [cid] });
    closeOverlay();
  }
  function doSecondYellow(player) {
    const m = minute(), tid = teamIdOf(player.id), c1 = uuid(), c2 = uuid(), lt = nowISO(), lt2 = nowISO();
    commitEvents([
      { kind: "card", args: { playerId: player.id, minute: m, period, colour: "yellow", clientEventId: c1, localTimestamp: lt }, optimistic: optEv({ client_event_id: c1, event_type: "yellow_card", minute: m, team_id: tid, player_id: player.id, local_timestamp: lt }) },
      { kind: "card", args: { playerId: player.id, minute: m, period, colour: "red", clientEventId: c2, localTimestamp: lt2 }, optimistic: optEv({ client_event_id: c2, event_type: "red_card", minute: m, team_id: tid, player_id: player.id, local_timestamp: lt2 }) },
    ], { label: `Second yellow → Red — ${player.name}`, icon: "red", ids: [c1, c2] });
    closeOverlay();
  }
  function doSub(offPlayer, onPlayer) {
    if (offPlayer.id === onPlayer.id) { closeOverlay(); return; }
    const cid = uuid(), m = minute(), lt = nowISO(), tid = teamIdOf(offPlayer.id);
    commitEvents([{ kind: "sub", args: { onPlayerId: onPlayer.id, offPlayerId: offPlayer.id, minute: m, period, clientEventId: cid, localTimestamp: lt },
      optimistic: optEv({ client_event_id: cid, event_type: "substitution", minute: m, team_id: tid, sub_player_on_id: onPlayer.id, sub_player_off_id: offPlayer.id, local_timestamp: lt }) }],
      { label: `Sub — ${onPlayer.name} on for ${offPlayer.name}`, icon: "sub", ids: [cid] });
    closeOverlay();
  }
  function doSinBin(player) {
    const cid = uuid(), m = minute(), lt = nowISO(), tid = teamIdOf(player.id);
    commitEvents([{ kind: "sinbin", args: { playerId: player.id, minute: m, period, clientEventId: cid, durationMin: fmt.sinBinMins, localTimestamp: lt },
      optimistic: optEv({ client_event_id: cid, event_type: "sin_bin", minute: m, team_id: tid, player_id: player.id, duration: fmt.sinBinMins, local_timestamp: lt }) }],
      { label: `Sin bin (${fmt.sinBinMins}′) — ${player.name}`, icon: "sinbin", ids: [cid] });
    closeOverlay();
  }
  function setPeriod(p) {
    vibrate([30, 50, 30]);
    if (isTournament) {
      setTournamentPeriod(p);
      setPeriodFx({ label: p === "HT" ? "HALF TIME" : "SECOND HALF", sub: p === "HT" ? "Events paused" : "Clock running", key: Date.now() });
      const cid = uuid(), lt = nowISO();
      (async () => {
        try { await refSetTournamentPeriod(refToken, p, cid, lt); }
        catch (e) { console.error("[ref] set_tournament_period failed", e); }
      })();
      return;
    }
    const cid = uuid(), lt = nowISO();
    commitEvents([{ kind: "period", args: { period: p, clientEventId: cid, localTimestamp: lt }, optimistic: optEv({ client_event_id: cid, event_type: "period_change", minute: minute(), period: p, local_timestamp: lt }) }],
      { label: p === "HT" ? "Half time" : "Second half under way", icon: p === "HT" ? "pause" : "play", ids: [cid] });
    setPeriodFx({ label: p === "HT" ? "HALF TIME" : "SECOND HALF", sub: p === "HT" ? "Events paused" : "Clock running", key: Date.now() });
  }

  async function doTournamentGoal(side) {
    vibrate(18);
    const cid = uuid(), lt = nowISO(), m = minute();
    const teamName = (side === "home" ? home?.name : away?.name) || "Team";
    setFixture((f) => ({
      ...f,
      home_score: side === "home" ? (f.home_score ?? 0) + 1 : (f.home_score ?? 0),
      away_score: side === "away" ? (f.away_score ?? 0) + 1 : (f.away_score ?? 0),
    }));
    setToast({ label: `Goal — ${teamName.split(" ")[0]}`, icon: "goal", key: Date.now(), tournamentSide: side });
    try {
      const result = await refRecordTournamentGoal(refToken, { side, minute: m, period, clientEventId: cid, localTimestamp: lt });
      setFixture((f) => ({ ...f, home_score: result.home_score, away_score: result.away_score }));
    } catch (e) {
      console.error("[ref] tournament goal failed", e);
      setFixture((f) => ({
        ...f,
        home_score: side === "home" ? Math.max(0, (f.home_score ?? 0) - 1) : (f.home_score ?? 0),
        away_score: side === "away" ? Math.max(0, (f.away_score ?? 0) - 1) : (f.away_score ?? 0),
      }));
      window.alert("Goal not recorded — try again");
    }
  }

  async function doTournamentCard(side, playerName, cardType) {
    vibrate(14);
    const m = minute();
    const compTeamId = side === "home" ? props.fixture.home_competition_team_id : props.fixture.away_competition_team_id;
    closeOverlay();
    try {
      const result = await refRecordTournamentCard(refToken, compTeamId, playerName, cardType, m, period);
      const icon = cardType === "red" ? "red" : "yellow";
      const suspendedNote = result.is_suspended ? " — SUSPENDED" : "";
      setToast({ label: `${cardType === "red" ? "Red" : "Yellow"} — ${playerName}${suspendedNote}`, icon, key: Date.now() });
    } catch (e) {
      console.error("[ref] tournament card failed", e);
      window.alert("Card not recorded — try again");
    }
  }

  function doNote(text, player) {
    const cid = uuid(), m = minute(), lt = nowISO(), tid = player ? teamIdOf(player.id) : null;
    commitEvents([{ kind: "note", args: { text, playerId: player ? player.id : null, minute: m, period, clientEventId: cid, localTimestamp: lt },
      optimistic: optEv({ client_event_id: cid, event_type: "note", minute: m, team_id: tid, player_id: player ? player.id : null, note_text: text, local_timestamp: lt }) }],
      { label: `Note${player ? " — " + player.name : ""}`, icon: "note", ids: [cid] });
    closeOverlay();
  }
  async function undoIds(ids) {
    if (!ids || !ids.length) return;
    if (toast && toast.ids && ids.every((id) => toast.ids.includes(id))) setToast(null);
    for (const id of ids) {
      const pending = await isPending(id);
      if (pending) await deletePending(id);
      else { try { await rpc.refUndoEvent("tok", id); } catch (e) {} }
    }
    setEvents((ev) => ev.filter((e) => !ids.includes(e.client_event_id)));
    await refreshPending();
    try { const fresh = await rpc.getFixtureStateByRefToken(); await reconcile(fresh.events); } catch (e) {}
  }
  async function undoToast() {
    const t = toast;
    if (!t) return;
    if (t.tournamentSide) {
      setToast(null);
      try {
        const result = await refUndoTournamentGoal(refToken, t.tournamentSide);
        setFixture((f) => ({ ...f, home_score: result.home_score, away_score: result.away_score }));
      } catch (e) { console.error("[ref] undo_tournament_goal failed", e); }
      return;
    }
    await undoIds(t.ids || []);
  }

  // ---- clock pause (offline-safe: queued + replayed with the local timestamp) ----
  async function togglePause() {
    vibrate(12);
    const wasPaused = !!fixture.clock_paused_at;
    const action = wasPaused ? "resume" : "pause";
    const cid = uuid(), lt = nowISO();
    setFixture((f) => {
      const nf = { ...f };
      if (action === "pause") nf.clock_paused_at = lt;
      else { nf.clock_paused_ms = (Number(f.clock_paused_ms) || 0) + Math.max(0, Date.now() - new Date(f.clock_paused_at).getTime()); nf.clock_paused_at = null; }
      return nf;
    });
    const row = { client_event_id: cid, fixture_id: fixtureId, kind: "clock", args: { action, clientEventId: cid, localTimestamp: lt }, local_timestamp: lt, created_at: lt, optimistic: null };
    try { await enqueue(row); } catch (e) { return; }
    await refreshPending();
    try {
      await fireQueued(refToken, row); await deletePending(cid); await refreshPending();
      const fresh = await rpc.getFixtureStateByRefToken();
      setFixture((f) => ({ ...f, clock_paused_at: fresh.fixture.clock_paused_at, clock_paused_ms: fresh.fixture.clock_paused_ms }));
    } catch (e) { /* stays queued, drains on reconnect */ }
  }

  // ---- added / stoppage time (persisted absolute value; idempotent on cid) ----
  const [addedTime, setAddedTime] = useState(() => props.fixture.added_time || {});
  const curAdded = addedTime[period] || 0;
  function commitAddedTime(nextMinutes) {
    vibrate(10);
    setAddedTime((a) => ({ ...a, [period]: nextMinutes }));
    const cid = uuid(), lt = nowISO();
    const row = { client_event_id: cid, fixture_id: fixtureId, kind: "addedtime", args: { period, minutes: nextMinutes, clientEventId: cid, localTimestamp: lt }, local_timestamp: lt, created_at: lt, optimistic: null };
    (async () => {
      try { await enqueue(row); } catch (e) { return; }
      await refreshPending();
      try { await fireQueued(refToken, row); await deletePending(cid); await refreshPending(); } catch (e) {}
    })();
  }
  const addMin = () => commitAddedTime((addedTime[period] || 0) + 1);
  const subMin = () => commitAddedTime(Math.max(0, (addedTime[period] || 0) - 1));

  // ---- toast auto-dismiss ----
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 30000); return () => clearTimeout(id); }, [toast]);

  // ---- period-change flourish + return-alert auto-dismiss ----
  useEffect(() => { if (!periodFx) return; const id = setTimeout(() => setPeriodFx(null), 1900); return () => clearTimeout(id); }, [periodFx]);
  useEffect(() => { if (!returnAlert) return; const id = setTimeout(() => setReturnAlert(null), 5000); return () => clearTimeout(id); }, [returnAlert]);

  // ---- detect sin-bin expiry -> "may return" alert ----
  useEffect(() => {
    const id = setInterval(() => {
      [...props.home_squad, ...props.away_squad].forEach((p) => {
        const st = playerStatus(events, p.id);
        if (!st.sinBins.length) return;
        const sec = sinBinRemaining(st.sinBins, fixture);
        if (sec > 0) binActiveRef.current.add(p.id);
        else if (binActiveRef.current.has(p.id) && !binDoneRef.current.has(p.id)) {
          binActiveRef.current.delete(p.id); binDoneRef.current.add(p.id);
          vibrate([20, 40, 20]); setReturnAlert({ name: p.name, key: Date.now() });
        }
      });
    }, 1000);
    return () => clearInterval(id);
  }, [events, fixture, props.home_squad, props.away_squad]);

  // ---- onYellow logic (two-yellow → confirm) ----
  function onYellow(player) {
    const st = playerStatus(events, player.id);
    if (st.yellows >= 1 && !st.red) setOverlay({ type: "confirmRed", player });
    else doCard(player, "yellow");
  }

  // ---- full time ----
  async function confirmFT() {
    vibrate([60, 40, 60, 40, 140]);
    setFtBusy(true);
    try {
      if (isTournament) {
        await refConfirmTournamentMatch(refToken);
        await onRefresh();
      } else {
        const r = await rpc.refConfirmFullTime("tok");
        if (r && r.needs_decider) { setFtBusy(false); setOverlay({ type: "decider", hs: r.home_score, as: r.away_score }); }
        else { await onRefresh(); }
      }
    } catch (e) { setFtBusy(false); window.alert("Could not confirm full time. Try again."); }
  }
  async function saveDecider(payload) {
    setFtBusy(true);
    try { await rpc.refRecordKnockoutDecider("tok", payload); await onRefresh(); }
    catch (e) { setFtBusy(false); window.alert("Could not save decider."); }
  }

  // ---- config-driven clock: count toward period length, prompt half/full time ----
  const mark1 = fmt.periodLengthMins;                               // end of 1H
  const mark2 = fmt.matchDurationMins || fmt.numPeriods * fmt.periodLengthMins; // end of 2H
  const min = minute();
  const periodReady = (period === "1H" && min >= mark1) || (period === "2H" && min >= mark2);
  const periodMark = period === "1H" ? mark1 : period === "2H" ? mark2 : null;

  // ---- period control config ----
  const periodBtn = period === "1H" ? { label: "Half time", cls: "period-ht", icon: <PauseIcon s={16} />, onClick: () => setPeriod("HT") }
    : period === "HT" ? { label: "Start second half", cls: "period-2h", icon: <PlayIcon s={16} />, onClick: () => setPeriod("2H") }
    : { label: "Full time", cls: "period-ft", icon: <FlagIcon s={17} c="#fff" />, onClick: () => setOverlay({ type: "ft" }) };

  const latestEvt = [...events].filter((e) => e.event_type !== "period_change").sort((a, b) => (b.minute - a.minute) || ((b.created_at || b.local_timestamp || "").localeCompare(a.created_at || a.local_timestamp || "")))[0];
  const latestId = latestEvt && latestEvt.client_event_id;

  const toastIcon = { goal: <GoalDot s={20} />, og: <OGDot s={20} />, yellow: <CardGlyph />, red: <CardGlyph red />, sub: <SubGlyph />, sinbin: <SinBinGlyph s={20} c="var(--amber)" />, note: <NoteGlyph s={20} c="var(--blue)" />, pause: <PauseIcon />, play: <PlayIcon /> };
  const FLASH = { goal: "var(--accent)", og: "var(--og)", yellow: "var(--yellow)", red: "var(--red)", sub: "var(--blue)", sinbin: "var(--amber)", note: "var(--blue)", pause: "var(--txt3)", play: "var(--accent)" };

  const ms = elapsedMs(fixture);

  return (
    <div className="app">
      <div className="safetop" />
      {/* scoreboard */}
      <div className={"sb" + (paused ? " paused" : "")}>
        {toast && <div className="sb-flash go" key={toast.key} style={{ background: FLASH[toast.icon] || "var(--accent)", color: FLASH[toast.icon] || "var(--accent)" }} />}
        <div className="sb-top">
          <span className="eyebrow" style={{ color: "var(--txt3)", display: "flex", alignItems: "center", gap: 8 }}>
            {props.competition?.name}{props.fixture.week_number != null ? ` · Wk ${props.fixture.week_number}` : ""}
            {fmt.isOverridden && <span className="chip" style={{ color: "var(--amber)", background: "rgba(244,162,58,0.13)", height: 20 }} title="Match timing was overridden for this fixture"><FlagIcon s={11} c="currentColor" /> custom</span>}
          </span>
          <div className="sb-right">
            <DaylightToggle />
            {clockOwner.isOwner && (
              <span className="chip" style={{ height: 20, color: "var(--txt3)", background: "rgba(255,255,255,0.06)" }} title="This device controls the clock">⌚ CTRL</span>
            )}
            {!clockOwner.isOwner && clockOwner.owner?.is_live && (
              <button className="chip" style={{ height: 20, color: "var(--amber)", background: "rgba(244,162,58,0.13)", border: "none", cursor: "pointer" }} title="Another device controls the clock — tap to take control here" onClick={clockOwner.takeControl}>
                ⌚ {(clockOwner.owner.owner_kind || "other").toUpperCase()} · TAKE
              </button>
            )}
            <button className="sb-logbtn" onClick={() => setOverlay({ type: "log" })}><ListGlyph s={12} /> LOG{pendingCount > 0 ? ` · ${pendingCount}` : ""}</button>
            <span className="live-pill"><span className="live-dot" /> {paused ? "PAUSED" : "LIVE"}</span>
          </div>
        </div>
        <div className="sb-grid">
          <div className="sb-team">
            <div className="sb-team-name"><Swatch c={home.primary_colour} /><span>{home.name}</span></div>
            <div className="sb-score"><span key={hs}>{hs}</span></div>
            <span className="sb-uline" style={{ background: home.primary_colour, color: home.primary_colour }} />
          </div>
          <div className="sb-center">
            <div className="sb-clock tabnum">{fmtClock(ms)}</div>
            <div className="sb-period">
              {period}{curAdded > 0 && <span className="sb-added"> +{curAdded}′</span>}
              {periodReady && <span className="sb-added" style={{ color: "var(--yellow)" }}> · {periodMark}′ ✓</span>}
            </div>
            <div className="sb-pause" onClick={togglePause}>{paused ? <PlayIcon /> : <PauseIcon />}</div>
          </div>
          <div className="sb-team away">
            <div className="sb-team-name"><Swatch c={away?.primary_colour} /><span>{away?.name || "Bye"}</span></div>
            <div className="sb-score"><span key={as}>{as}</span></div>
            <span className="sb-uline" style={{ background: away?.primary_colour || "#555", color: away?.primary_colour || "#555" }} />
          </div>
        </div>
      </div>

      {/* sync / offline banner */}
      {(pendingCount > 0 || isOffline) && (
        <div className={"banner " + (isOffline ? "banner-offline" : "banner-sync")}>
          {isOffline ? <span className="dot" /> : <span className="spin" />}
          <span className="grow">
            {isOffline ? `Offline · ${pendingCount} event${pendingCount === 1 ? "" : "s"} queued` : `Syncing · ${pendingCount} pending`}
            {syncError ? ` · ${syncError}` : ""}
          </span>
          {(syncError || (!isOffline && pendingCount > 0)) && <button className="banner-retry" onClick={drain}>Retry</button>}
        </div>
      )}

      {returnAlert && (
        <div className="return-alert" key={returnAlert.key}>↩ {returnAlert.name} may return</div>
      )}

      {/* body */}
      <div className="scroll">
        {locked && <div className="lock-note"><PauseIcon /> {period === "HT" ? "Half time — events paused" : "Full time"}</div>}
        {props.home_squad.length > 0
          ? <TeamColumn team={home} squad={props.home_squad} events={events} locked={locked} fixture={fixture} onTapPlayer={(p) => setOverlay({ type: "actions", player: p })} />
          : <TournamentGoalButton team={home} locked={locked} onGoal={() => doTournamentGoal("home")} onCard={() => setOverlay({ type: "tournament-card", side: "home", team: home })} />}
        {props.away_squad.length > 0
          ? <TeamColumn team={away} squad={props.away_squad} events={events} locked={locked} fixture={fixture} onTapPlayer={(p) => setOverlay({ type: "actions", player: p })} />
          : <TournamentGoalButton team={away} locked={locked} onGoal={() => doTournamentGoal("away")} onCard={() => setOverlay({ type: "tournament-card", side: "away", team: away })} />}
        <div style={{ height: 16 }} />
      </div>

      {/* dock: undo toast + period control */}
      <div className="dock">
        {toast && (
          <div className="toast" key={toast.key}>
            <div className="ticon">{toastIcon[toast.icon]}</div>
            <div className="tlabel">{toast.label}<small>Tap undo within 30s</small></div>
            <button className="toast-undo" onClick={undoToast}>Undo</button>
            <div className="toast-prog" />
          </div>
        )}
        <button className={"period-btn " + periodBtn.cls} onClick={periodBtn.onClick}
          style={periodReady ? { boxShadow: "0 0 0 2px var(--yellow), 0 6px 22px rgba(242,194,10,0.25)" } : undefined}>
          {periodBtn.icon} {periodBtn.label}
        </button>
      </div>

      {/* overlays */}
      {overlay?.type === "actions" && (
        <ActionSheet player={overlay.player} events={events}
          onGoal={() => doGoal(overlay.player, false)} onOwnGoal={() => doGoal(overlay.player, true)}
          onYellow={() => onYellow(overlay.player)} onRed={() => doCard(overlay.player, "red")}
          onSub={() => setOverlay({ type: "sub", player: overlay.player })}
          onSinBin={() => doSinBin(overlay.player)}
          onNote={() => setOverlay({ type: "note", player: overlay.player })}
          sinBinActive={sinBinRemaining(playerStatus(events, overlay.player.id).sinBins, fixture) > 0}
          onClose={closeOverlay} />
      )}
      {overlay?.type === "sub" && (
        <SubPicker offPlayer={overlay.player}
          squad={(props.home_squad.some((p) => p.id === overlay.player.id) ? props.home_squad : props.away_squad)}
          onPick={(on) => doSub(overlay.player, on)} onClose={closeOverlay} />
      )}
      {overlay?.type === "confirmRed" && (
        <ConfirmRed player={overlay.player} onYes={() => doSecondYellow(overlay.player)} onNo={closeOverlay} />
      )}
      {overlay?.type === "ft" && (
        <FTModal home={home} away={away} hs={hs} as={as} busy={ftBusy} onConfirm={confirmFT} onCancel={() => setOverlay(null)} />
      )}
      {overlay?.type === "decider" && (
        <DeciderModal home={home} away={away} hs={overlay.hs} as={overlay.as} busy={ftBusy} onSave={saveDecider} onCancel={() => setOverlay(null)} />
      )}
      {overlay?.type === "log" && (
        <MatchLogSheet events={events} homeSquad={props.home_squad} awaySquad={props.away_squad} period={period}
          curAdded={curAdded} onAddMin={addMin} onSubMin={subMin} latestId={latestId} onUndo={undoIds} onAddNote={() => setOverlay({ type: "note" })} onClose={closeOverlay} />
      )}
      {overlay?.type === "note" && (
        <NoteComposer player={overlay.player || null} onSave={(t) => doNote(t, overlay.player || null)} onClose={closeOverlay} />
      )}
      {overlay?.type === "tournament-card" && (
        <TournamentCardModal team={overlay.team} onConfirm={(n, c) => doTournamentCard(overlay.side, n, c)} onClose={closeOverlay} />
      )}
      {periodFx && (
        <div className="period-fx" key={periodFx.key}>
          <div className="pf">{periodFx.label}<small>{periodFx.sub}</small></div>
        </div>
      )}
    </div>
  );
}
