import { useState, useEffect, useRef, useCallback } from "react";
import { CaretLeft, Trophy, ArrowSquareOut, Check, X, Confetti } from "@phosphor-icons/react";
import {
  getMyTournaments,
  venueGetTournament,
  venueGetSchedule,
  venueApproveTeam,
  venueRejectTeam,
  venueGenerateSchedule,
  selfServeSeedSingleElim,
  selfServeEnterResult,
  venueUpdateTournamentStatus,
} from "@platform/core/storage/supabase.js";

// Native "Run tournament" manage UI — PR #4b. Rendered inside the /create route
// (via CreateTournament), NOT a new App.jsx route. Screen-state navigation only
// (list → detail → score via local useState), mirroring MobileShell's overlay
// pattern — no routes, so no PROTECTED App.jsx edit.
//
// Every write reuses a proven Stage-1b venue_id-as-token wrapper (approve/reject,
// status, round-robin schedule, single-elim seed, score+advance). The venue_id
// token comes from get_my_tournaments (mig 492), which resolves the organiser's
// own tournaments from tournament_events.created_by_user = auth.uid() — never
// from the operator role (the hidden host is excluded from get_my_world by mig
// 493). Fixture generation branches per format:
//   round_robin        → venue_generate_schedule (any N≥2; auto-byes odd counts)
//   single_elimination → self_serve_seed_single_elim (mig 491; power-of-2)
//   group_stage        → deferred (needs tournament-mode group assignment; the
//                        create form no longer offers it — see CreateTournament).

const CTA = {
  width: "100%", boxSizing: "border-box", border: "none",
  background: "var(--gold)", color: "var(--bg)",
  borderRadius: "var(--r)", padding: "14px 16px",
  fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600, cursor: "pointer",
};
const CTA_DISABLED = { ...CTA, background: "var(--s2)", color: "var(--t2)", border: "1px solid var(--border-subtle)", cursor: "default" };
const GHOST = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "none",
  border: "none", color: "var(--t2)", fontFamily: "var(--font-body)",
  fontSize: 14, cursor: "pointer", padding: 0,
};
const CARD = {
  background: "var(--s2)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--r)", padding: "14px 16px", marginBottom: 12,
};
const LABEL = {
  fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--t2)",
  margin: "22px 0 10px",
};

const STATUS_COPY = {
  draft:     { label: "Draft",       tint: "var(--t2)" },
  open:      { label: "Open",        tint: "var(--gold)" },
  closed:    { label: "Entries closed", tint: "var(--t2)" },
  live:      { label: "Live",        tint: "var(--gold)" },
  completed: { label: "Completed",   tint: "var(--t2)" },
};

function StatusPill({ status }) {
  const s = STATUS_COPY[status] || { label: status, tint: "var(--t2)" };
  return (
    <span style={{
      fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.06em", textTransform: "uppercase", color: s.tint,
      border: `1px solid ${s.tint}`, borderRadius: 999, padding: "3px 9px",
    }}>
      {s.label}
    </span>
  );
}

function friendly(e) {
  const m = e?.message || "";
  if (/auth_required/.test(m)) return "Please sign in again.";
  if (/bracket_size_not_supported/.test(m)) return "Straight knockout needs 4, 8 or 16 teams. Approve or remove teams to hit a clean number, or switch this tournament to Round robin.";
  if (/not_enough_teams/.test(m)) return "You need at least 2 approved teams first.";
  if (/knockout_already_seeded|fixtures_already_exist/.test(m)) return "Fixtures have already been generated.";
  if (/not_single_elimination/.test(m)) return "This tournament isn't a knockout.";
  if (/result_already_entered/.test(m)) return "That result is already in.";
  if (/knockout_cannot_draw/.test(m)) return "A knockout tie can't be a draw — enter a decisive score (settle a shootout off-app).";
  if (/invalid_score/.test(m)) return "Enter a valid score.";
  if (/invalid_venue_token|not_authorised/.test(m)) return "You don't have access to this tournament.";
  return "Something went wrong. Please try again.";
}

export default function ManageTournament({ onExit, initialSlug = null }) {
  const [list, setList]       = useState(null); // null = loading, [] = none
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(null); // { tournament_id, slug, venue_id, name, status }
  const [detail, setDetail]   = useState(null);   // venueGetTournament result
  const [schedule, setSchedule] = useState(null); // venueGetSchedule result
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy]       = useState(false);  // any write in flight
  const [scoreFx, setScoreFx] = useState(null);   // fixture being scored
  const busyRef = useRef(false);
  const autoOpened = useRef(false);

  const page = { padding: "28px 20px 48px", minHeight: "100dvh" };

  // ── Load "my tournaments" ─────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setError(null);
    try {
      const rows = await getMyTournaments();
      setList(Array.isArray(rows) ? rows : []);
      return rows;
    } catch (e) {
      console.error("getMyTournaments failed", e);
      setError(friendly(e));
      setList([]);
      return [];
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // ── Load one tournament's detail + schedule ───────────────────────────────
  const openTournament = useCallback(async (t) => {
    setSelected(t);
    setScoreFx(null);
    setDetailLoading(true);
    setError(null);
    try {
      const [d, s] = await Promise.all([
        venueGetTournament(t.venue_id, t.slug),
        venueGetSchedule(t.venue_id, t.tournament_id),
      ]);
      setDetail(d);
      setSchedule(s);
    } catch (e) {
      console.error("openTournament failed", e);
      setError(friendly(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Auto-open a tournament when arriving via ?manage=<slug>
  useEffect(() => {
    if (!initialSlug || autoOpened.current || !Array.isArray(list)) return;
    const match = list.find((t) => t.slug === initialSlug);
    if (match) { autoOpened.current = true; openTournament(match); }
  }, [initialSlug, list, openTournament]);

  const refreshDetail = useCallback(async () => {
    if (!selected) return;
    try {
      const [d, s] = await Promise.all([
        venueGetTournament(selected.venue_id, selected.slug),
        venueGetSchedule(selected.venue_id, selected.tournament_id),
      ]);
      setDetail(d);
      setSchedule(s);
    } catch (e) {
      console.error("refreshDetail failed", e);
    }
  }, [selected]);

  const runWrite = useCallback(async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      await fn();
      await refreshDetail();
    } catch (e) {
      console.error("manage write failed", e);
      setError(friendly(e));
    } finally {
      setBusy(false); busyRef.current = false;
    }
  }, [refreshDetail]);

  const backToList = () => {
    setSelected(null); setDetail(null); setSchedule(null); setScoreFx(null); setError(null);
    loadList();
  };

  // ── SCORE view ────────────────────────────────────────────────────────────
  if (selected && scoreFx) {
    return <ScoreEntry
      fixture={scoreFx}
      onCancel={() => setScoreFx(null)}
      onSubmit={async (home, away) => {
        await runWrite(() => selfServeEnterResult(selected.venue_id, { fixtureId: scoreFx.fixture_id, home, away }));
        setScoreFx(null);
      }}
      busy={busy}
      error={error}
    />;
  }

  // ── DETAIL view ───────────────────────────────────────────────────────────
  if (selected) {
    const comps = detail?.competitions || [];
    const schedComps = schedule?.competitions || [];
    const format = comps[0]?.format;
    const activeTeams = comps.flatMap((c) => (c.teams || []).filter((t) => t.status === "active"));
    const pendingTeams = comps.flatMap((c) => (c.teams || []).filter((t) => t.status === "pending"));
    const allFixtures = schedComps.flatMap((c) => c.fixtures || []);
    const hasFixtures = allFixtures.length > 0;
    const status = detail?.status || selected.status;

    return (
      <div style={page}>
        <button type="button" onClick={backToList} style={{ ...GHOST, marginBottom: 20 }}>
          <CaretLeft size={16} weight="thin" /> My tournaments
        </button>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, letterSpacing: 0.5, margin: 0, flex: 1 }}>
            {detail?.name || selected.name}
          </h1>
          <StatusPill status={status} />
        </div>

        {detail?.slug && (
          <a href={`/tournament/${detail.slug}`} style={{ ...GHOST, color: "var(--gold)", marginBottom: 8 }}>
            View public page <ArrowSquareOut size={15} weight="thin" />
          </a>
        )}

        {error && <div style={errStyle}>{error}</div>}
        {detailLoading && <div style={muted}>Loading…</div>}

        {/* PENDING TEAMS — approve / reject */}
        {pendingTeams.length > 0 && (
          <>
            <div style={LABEL}>Awaiting approval ({pendingTeams.length})</div>
            {pendingTeams.map((t) => (
              <div key={t.competition_team_id} style={{ ...CARD, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: 15, color: "var(--t1)" }}>{t.team_name}</span>
                <button type="button" disabled={busy} onClick={() => runWrite(() => venueApproveTeam(selected.venue_id, t.competition_team_id))}
                  style={iconBtn("var(--gold)")} aria-label="Approve">
                  <Check size={18} weight="thin" />
                </button>
                <button type="button" disabled={busy} onClick={() => runWrite(() => venueRejectTeam(selected.venue_id, t.competition_team_id, null))}
                  style={iconBtn("var(--danger, #FF6060)")} aria-label="Reject">
                  <X size={18} weight="thin" />
                </button>
              </div>
            ))}
          </>
        )}

        {/* APPROVED TEAMS */}
        <div style={LABEL}>Teams ({activeTeams.length})</div>
        {activeTeams.length === 0 ? (
          <div style={muted}>No approved teams yet. Share your tournament link so teams can register.</div>
        ) : (
          <div style={CARD}>
            {activeTeams.map((t, i) => (
              <div key={t.competition_team_id} style={{
                fontFamily: "var(--font-body)", fontSize: 15, color: "var(--t1)",
                padding: "7px 0", borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
              }}>
                {t.team_name}
              </div>
            ))}
          </div>
        )}

        {/* FIXTURES / GENERATE */}
        <div style={LABEL}>Matches</div>
        {!hasFixtures ? (
          <>
            <div style={muted}>
              {format === "single_elimination"
                ? "Straight knockout — teams are paired into a bracket. Needs 4, 8 or 16 approved teams."
                : "Round robin — everyone plays everyone once."}
            </div>
            <button
              type="button"
              disabled={busy || activeTeams.length < 2}
              onClick={() => runWrite(async () => {
                if (format === "single_elimination") {
                  await selfServeSeedSingleElim(selected.venue_id, selected.tournament_id, comps[0].competition_id);
                } else {
                  const start = detail?.event_date || null;
                  await venueGenerateSchedule(selected.venue_id, selected.tournament_id, comps[0].competition_id, 30, "10:00", start, []);
                }
                if (status !== "live") {
                  await venueUpdateTournamentStatus(selected.venue_id, selected.slug, "live");
                }
              })}
              style={(busy || activeTeams.length < 2) ? CTA_DISABLED : CTA}
            >
              {busy ? "Working…" : "Generate fixtures & go live"}
            </button>
            {activeTeams.length < 2 && <div style={{ ...muted, marginTop: 8 }}>Approve at least 2 teams to start.</div>}
          </>
        ) : (
          <FixtureList
            fixtures={allFixtures}
            onScore={(fx) => setScoreFx({ ...fx, _isKnockout: format !== "round_robin" && fx.group_label == null })}
            busy={busy}
          />
        )}
      </div>
    );
  }

  // ── LIST view ─────────────────────────────────────────────────────────────
  return (
    <div style={page}>
      <button type="button" onClick={onExit} style={{ ...GHOST, marginBottom: 20 }}>
        <CaretLeft size={16} weight="thin" /> Back
      </button>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, letterSpacing: 0.5, margin: "0 0 6px" }}>
        My tournaments
      </h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--t2)", margin: "0 0 20px" }}>
        Approve teams, generate fixtures and enter scores pitch-side.
      </p>

      {error && <div style={errStyle}>{error}</div>}

      {list === null ? (
        <div style={muted}>Loading…</div>
      ) : list.length === 0 ? (
        <div style={{ ...CARD, textAlign: "center", padding: "32px 16px" }}>
          <Trophy size={40} weight="thin" color="var(--t2)" />
          <div style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--t2)", marginTop: 12 }}>
            You haven't created a tournament yet.
          </div>
        </div>
      ) : (
        list.map((t) => (
          <button key={t.tournament_id} type="button" onClick={() => openTournament(t)}
            style={{ ...CARD, width: "100%", textAlign: "left", cursor: "pointer", display: "block" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 20, letterSpacing: 0.4, color: "var(--t1)" }}>{t.name}</span>
              <StatusPill status={t.status} />
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--t2)", marginTop: 6 }}>
              {t.active_teams} {t.active_teams === 1 ? "team" : "teams"}
              {t.pending_teams > 0 && ` · ${t.pending_teams} awaiting approval`}
            </div>
          </button>
        ))
      )}
    </div>
  );
}

// ── Fixture list ─────────────────────────────────────────────────────────────
function FixtureList({ fixtures, onScore, busy }) {
  // group by round for a readable bracket/table
  const rounds = {};
  for (const fx of fixtures) {
    const key = fx.round_name || `Round ${fx.round}`;
    (rounds[key] = rounds[key] || []).push(fx);
  }
  return (
    <>
      {Object.entries(rounds).map(([roundName, fxs]) => (
        <div key={roundName} style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--t2)", margin: "12px 0 6px" }}>{roundName}</div>
          {fxs.map((fx) => {
            const done = fx.status === "completed";
            const bothSet = fx.home_team_id && fx.away_team_id;
            return (
              <button
                key={fx.fixture_id}
                type="button"
                disabled={busy || !bothSet || done}
                onClick={() => onScore(fx)}
                style={{
                  ...CARD, width: "100%", textAlign: "left", marginBottom: 8,
                  cursor: (bothSet && !done) ? "pointer" : "default",
                  display: "flex", alignItems: "center", gap: 10,
                }}
              >
                <div style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: 15, color: "var(--t1)" }}>
                  <div>{fx.home_team_name || "TBC"}</div>
                  <div style={{ color: "var(--t2)", fontSize: 12, margin: "2px 0" }}>vs</div>
                  <div>{fx.away_team_name || "TBC"}</div>
                </div>
                {done ? (
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 24, letterSpacing: 1, color: "var(--t1)" }}>
                    {fx.home_score}–{fx.away_score}
                  </div>
                ) : bothSet ? (
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600, color: "var(--gold)" }}>Enter score</span>
                ) : (
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--t2)" }}>Awaiting teams</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ── Score entry ──────────────────────────────────────────────────────────────
function ScoreEntry({ fixture, onCancel, onSubmit, busy, error }) {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const page = { padding: "28px 20px 48px", minHeight: "100dvh" };
  const valid = home !== "" && away !== "" && Number(home) >= 0 && Number(away) >= 0;

  const numInput = {
    width: 72, textAlign: "center", boxSizing: "border-box",
    background: "var(--s2)", border: "1px solid var(--border-subtle)",
    borderRadius: "var(--r)", padding: "14px 8px",
    color: "var(--t1)", fontFamily: "var(--font-display)", fontSize: 34, letterSpacing: 1,
  };

  return (
    <div style={page}>
      <button type="button" onClick={onCancel} style={{ ...GHOST, marginBottom: 28 }}>
        <CaretLeft size={16} weight="thin" /> Back
      </button>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <Confetti size={36} weight="thin" color="var(--gold)" />
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, letterSpacing: 0.5, margin: 0, textAlign: "center" }}>
          Final score
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 16, width: "100%", justifyContent: "center" }}>
          <div style={{ textAlign: "center", flex: 1, maxWidth: 130 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--t1)", marginBottom: 10, minHeight: 34 }}>{fixture.home_team_name}</div>
            <input type="number" inputMode="numeric" min={0} value={home} onChange={(e) => setHome(e.target.value)} style={numInput} />
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t2)" }}>–</span>
          <div style={{ textAlign: "center", flex: 1, maxWidth: 130 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--t1)", marginBottom: 10, minHeight: 34 }}>{fixture.away_team_name}</div>
            <input type="number" inputMode="numeric" min={0} value={away} onChange={(e) => setAway(e.target.value)} style={numInput} />
          </div>
        </div>

        {error && <div style={errStyle}>{error}</div>}

        <button type="button" disabled={!valid || busy} onClick={() => onSubmit(Number(home), Number(away))}
          style={{ ...(!valid || busy ? CTA_DISABLED : CTA), marginTop: 8 }}>
          {busy ? "Saving…" : "Save result"}
        </button>
        {fixture._isKnockout && (
          <div style={{ ...muted, textAlign: "center" }}>Knockout tie — a draw isn't allowed. Settle a shootout off-app and enter the decisive score.</div>
        )}
      </div>
    </div>
  );
}

const muted = { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--t2)", lineHeight: 1.5 };
const errStyle = { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--danger, #FF6060)", margin: "10px 0", lineHeight: 1.5 };
function iconBtn(color) {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 40, height: 40, borderRadius: "var(--r)", cursor: "pointer",
    background: "var(--bg)", border: `1px solid ${color}`, color,
  };
}
