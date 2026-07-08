import { useState, useEffect, useRef, useCallback } from "react";
import { CaretLeft, Trophy, ArrowSquareOut, Check, X, Confetti } from "@phosphor-icons/react";
import {
  getMyTournaments,
  venueGetTournament,
  venueGetSchedule,
  venueGetTournamentStandings,
  venueApproveTeam,
  venueRejectTeam,
  venueGenerateSchedule,
  selfServeSeedSingleElim,
  selfServeSeedGroupStage,
  selfServeRetireGroupTeam,
  venueSeedKnockout,
  selfServeEnterResult,
  venueUpdateTournamentStatus,
  selfServeCancelTournament,
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
//   group_stage        → self_serve_seed_group_stage (mig 498; snake-draw into
//                        2/4/8 groups, top-1|top-2 advance) then play group games,
//                        then venue_seed_knockout (mig 452/500; cross-seeds the
//                        bracket from the top qualifiers) then score to a champion.
//                        A no-show is retired via self_serve_retire_group_team (mig
//                        499) so it can't strand the knockout gate. Reachable only
//                        once the create form offers "Groups, then knockout" (PR#3).

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
  if (/not_enough_teams/.test(m)) return "You don't have enough approved teams for that. Approve more teams, or pick fewer groups.";
  if (/knockout_already_seeded|fixtures_already_exist/.test(m)) return "Fixtures have already been generated.";
  if (/not_single_elimination/.test(m)) return "This tournament isn't a knockout.";
  if (/num_groups_not_supported/.test(m)) return "Pick 2, 4 or 8 groups.";
  if (/qualifiers_per_group_not_supported/.test(m)) return "Choose top 1 or top 2 per group.";
  if (/groups_already_seeded/.test(m)) return "The groups have already been drawn.";
  if (/not_group_stage/.test(m)) return "This tournament isn't a group stage.";
  if (/groups_not_seeded/.test(m)) return "Draw the groups first.";
  if (/group_would_strand/.test(m)) return "That would leave the group too small to produce its qualifiers, so you can't retire this team. If the tournament can't go ahead, cancel it.";
  if (/incomplete_group_fixtures/.test(m)) return "Finish every group game first, then generate the knockout.";
  if (/result_already_entered/.test(m)) return "That result is already in.";
  if (/knockout_cannot_draw/.test(m)) return "A knockout tie can't be a draw — enter a decisive score (settle a shootout off-app).";
  if (/invalid_score/.test(m)) return "Enter a valid score.";
  if (/invalid_venue_token|not_authorised/.test(m)) return "You don't have access to this tournament.";
  if (/cannot_cancel_completed/.test(m)) return "A completed tournament can't be cancelled.";
  if (/tournament_not_found/.test(m)) return "That tournament could no longer be found.";
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
  const [standings, setStandings] = useState(null); // venueGetTournamentStandings (group_stage only)
  const [confirmCancel, setConfirmCancel] = useState(false);
  const busyRef = useRef(false);
  const autoOpened = useRef(false);

  const page = { padding: "calc(28px + env(safe-area-inset-top)) 20px calc(48px + env(safe-area-inset-bottom))", minHeight: "100dvh" };

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

  // ── Load one tournament's detail + schedule (+ standings for group_stage) ──
  // Group-stage standings (mig 452 read, qpg surfaced by mig 501) drive the live
  // group tables + the qualify-tint; skipped for knockout/round-robin.
  const fetchState = useCallback(async (t) => {
    const [d, s] = await Promise.all([
      venueGetTournament(t.venue_id, t.slug),
      venueGetSchedule(t.venue_id, t.tournament_id),
    ]);
    let st = null;
    const comp = (d?.competitions || [])[0];
    if (comp?.format === "group_stage") {
      try { st = await venueGetTournamentStandings(t.venue_id, t.tournament_id, comp.competition_id); }
      catch (e) { console.error("standings fetch failed", e); }
    }
    return { d, s, st };
  }, []);

  const openTournament = useCallback(async (t) => {
    setSelected(t);
    setScoreFx(null);
    setStandings(null);
    setDetailLoading(true);
    setError(null);
    try {
      const { d, s, st } = await fetchState(t);
      setDetail(d);
      setSchedule(s);
      setStandings(st);
    } catch (e) {
      console.error("openTournament failed", e);
      setError(friendly(e));
    } finally {
      setDetailLoading(false);
    }
  }, [fetchState]);

  // Auto-open a tournament when arriving via ?manage=<slug>
  useEffect(() => {
    if (!initialSlug || autoOpened.current || !Array.isArray(list)) return;
    const match = list.find((t) => t.slug === initialSlug);
    if (match) { autoOpened.current = true; openTournament(match); }
  }, [initialSlug, list, openTournament]);

  const refreshDetail = useCallback(async () => {
    if (!selected) return;
    try {
      const { d, s, st } = await fetchState(selected);
      setDetail(d);
      setSchedule(s);
      setStandings(st);
    } catch (e) {
      console.error("refreshDetail failed", e);
    }
  }, [selected, fetchState]);

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
    setSelected(null); setDetail(null); setSchedule(null); setScoreFx(null); setStandings(null); setError(null);
    setConfirmCancel(false);
    loadList();
  };

  // Owner reverse path (mig 495) — cancel this tournament, then back to the list.
  const doCancel = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      await selfServeCancelTournament(selected.tournament_id);
      backToList();
    } catch (e) {
      console.error("cancel tournament failed", e);
      setError(friendly(e));
      setBusy(false); busyRef.current = false;
    }
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

    // ── Group-stage phase derivation (format === 'group_stage') ──────────────
    const comp0 = comps[0];
    const isGroups = format === "group_stage";
    const knockoutSeeded = !!comp0?.knockout_seeded;
    const groupFixtures = allFixtures.filter((f) => f.group_label != null);
    const koFixtures = allFixtures.filter((f) => f.group_label == null);
    const groupsSeeded = isGroups && groupFixtures.length > 0;
    const groupPlayed = groupFixtures.filter((f) => f.status === "completed").length;
    const groupDone = groupsSeeded && groupFixtures.length > 0 && groupPlayed === groupFixtures.length;

    let phaseBanner = null;
    if (isGroups) {
      if (!groupsSeeded) phaseBanner = "Set up your groups";
      else if (!knockoutSeeded) phaseBanner = `Group stage · ${groupPlayed} of ${groupFixtures.length} played`;
      else {
        const nextKo = koFixtures.find((f) => f.status !== "completed");
        phaseBanner = `Knockout · ${nextKo?.round_name || "In progress"}`;
      }
    }

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

        {phaseBanner && (
          <div style={{
            fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700,
            letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--gold)",
            margin: "6px 0 2px",
          }}>
            {phaseBanner}
          </div>
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

        {isGroups ? (
          <GroupStageBody
            activeTeams={activeTeams}
            groupsSeeded={groupsSeeded}
            knockoutSeeded={knockoutSeeded}
            groupFixtures={groupFixtures}
            koFixtures={koFixtures}
            groupDone={groupDone}
            standings={standings}
            busy={busy}
            onSeedGroups={(numGroups, qpg) => runWrite(async () => {
              await selfServeSeedGroupStage(selected.venue_id, selected.tournament_id, comp0.competition_id, numGroups, qpg);
              if (status !== "live") await venueUpdateTournamentStatus(selected.venue_id, selected.slug, "live");
            })}
            onGenerateKnockout={() => runWrite(() => venueSeedKnockout(selected.venue_id, selected.tournament_id, comp0.competition_id))}
            onRetire={(teamId) => runWrite(() => selfServeRetireGroupTeam(selected.venue_id, teamId))}
            onScore={(fx) => setScoreFx({ ...fx, _isKnockout: fx.group_label == null })}
          />
        ) : (
          <>
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
          </>
        )}

        {/* DANGER ZONE — owner cancel (reverse path) */}
        {status !== "completed" && status !== "cancelled" && (
          <div style={{ marginTop: 36, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
            {!confirmCancel ? (
              <button type="button" onClick={() => setConfirmCancel(true)}
                style={{ ...GHOST, color: "var(--danger, #FF6060)" }}>
                Cancel tournament
              </button>
            ) : (
              <div>
                <div style={{ ...muted, marginBottom: 12 }}>
                  Cancel {detail?.name || "this tournament"}? Its public page will disappear and teams can no longer register. This can't be undone from the app.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" disabled={busy} onClick={doCancel}
                    style={{ ...CTA, background: "var(--danger, #FF6060)", flex: 1 }}>
                    {busy ? "Cancelling…" : "Yes, cancel it"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirmCancel(false)}
                    style={{ ...CTA_DISABLED, flex: 1 }}>
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </div>
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

// ── Group stage ────────────────────────────────────────────────────────────────
// Phase-aware body for a format='group_stage' tournament. Three phases:
//   1. not seeded          → SeedPicker (draw groups, choose how many advance)
//   2. group stage live    → per-group tables (qualify-tint) + group fixtures +
//                            retire-a-no-show + "Generate knockout" (gated on all
//                            group games complete)
//   3. knockout seeded      → the cross-seeded bracket (scored like any knockout)

function shapeLabel(bracket) {
  return bracket === 2 ? "straight final"
    : bracket === 4 ? "semi-finals"
    : bracket === 8 ? "quarter-finals"
    : bracket === 16 ? "round of 16"
    : `${bracket}-team knockout`;
}

// gold-tinted qualifier row (the shareable "we're through" cue). color-mix keeps
// it a token-derived tint (no hardcoded hex); degrades to the gold left-border
// alone on the rare engine without color-mix.
const QUAL_ROW = { background: "color-mix(in srgb, var(--gold) 12%, transparent)", boxShadow: "inset 3px 0 0 var(--gold)" };

function GroupStageBody({ activeTeams, groupsSeeded, knockoutSeeded, groupFixtures, koFixtures, groupDone, standings, busy, onSeedGroups, onGenerateKnockout, onRetire, onScore }) {
  // Phase 1 — draw the groups.
  if (!groupsSeeded) {
    return (
      <>
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
        <div style={LABEL}>Draw the groups</div>
        <SeedPicker activeCount={activeTeams.length} busy={busy} onSeed={onSeedGroups} />
      </>
    );
  }

  // Phase 3 — knockout bracket.
  if (knockoutSeeded) {
    return (
      <>
        <div style={LABEL}>Group tables</div>
        <GroupStandings standings={standings} />
        <div style={LABEL}>Knockout</div>
        {koFixtures.length === 0
          ? <div style={muted}>Generating the bracket…</div>
          : <FixtureList fixtures={koFixtures} onScore={onScore} busy={busy} />}
      </>
    );
  }

  // Phase 2 — group stage live.
  return (
    <>
      <div style={LABEL}>Group tables</div>
      <GroupStandings standings={standings} />
      <div style={LABEL}>Group matches</div>
      <FixtureList fixtures={groupFixtures} onScore={onScore} busy={busy} />
      <div style={LABEL}>Knockout</div>
      <button type="button" disabled={busy || !groupDone} onClick={onGenerateKnockout}
        style={(busy || !groupDone) ? CTA_DISABLED : CTA}>
        {busy ? "Working…" : "Generate knockout"}
      </button>
      {!groupDone && <div style={{ ...muted, marginTop: 8 }}>Finish every group game, then the knockout draws itself from the top of each group.</div>}
      <RetireList activeTeams={activeTeams} busy={busy} onRetire={onRetire} />
    </>
  );
}

// Group-count + how-many-advance picker. Only offers combos that are feasible for
// the approved-team count: each of N groups needs at least (Q+1) teams so a single
// no-show can't strand it (mig 498 MIN TEAMS = N×(Q+1)). Bracket size N×Q is always
// a power of 2 for N∈{2,4,8}, Q∈{1,2}, so no bracket-size guard is needed here.
function SeedPicker({ activeCount, busy, onSeed }) {
  const feasible = (n, q) => activeCount >= n * (q + 1);
  const [numGroups, setNumGroups] = useState(() => {
    for (const n of [8, 4, 2]) if (feasible(n, 2)) return n;
    for (const n of [8, 4, 2]) if (feasible(n, 1)) return n;
    return 2;
  });
  const [qpg, setQpg] = useState(() => (feasible(numGroups, 2) ? 2 : 1));

  const canSeed = feasible(numGroups, qpg);
  const bracket = numGroups * qpg;
  const uneven = activeCount % numGroups !== 0;

  const chip = (active, disabled) => ({
    flex: 1, textAlign: "center", padding: "10px 8px", borderRadius: "var(--r)",
    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    background: active ? "var(--gold)" : "var(--s2)",
    color: active ? "var(--bg)" : disabled ? "var(--t2)" : "var(--t1)",
    border: `1px solid ${active ? "var(--gold)" : "var(--border-subtle)"}`,
    opacity: disabled ? 0.5 : 1,
  });

  if (activeCount < 4) {
    return <div style={muted}>Approve at least 4 teams to run a group stage (2 groups of 2, top 1 advancing).</div>;
  }

  return (
    <>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--t2)", margin: "0 0 8px" }}>How many groups?</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[2, 4, 8].map((n) => {
          const disabled = busy || !feasible(n, 1);
          return (
            <button key={n} type="button" disabled={disabled}
              onClick={() => { setNumGroups(n); if (!feasible(n, qpg)) setQpg(1); }}
              style={chip(numGroups === n, disabled)}>{n}</button>
          );
        })}
      </div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--t2)", margin: "0 0 8px" }}>How many advance from each group?</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[1, 2].map((q) => {
          const disabled = busy || !feasible(numGroups, q);
          return (
            <button key={q} type="button" disabled={disabled} onClick={() => setQpg(q)}
              style={chip(qpg === q, disabled)}>Top {q}</button>
          );
        })}
      </div>
      <div style={{ ...CARD, marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--t1)" }}>
          {numGroups} {numGroups === 1 ? "group" : "groups"}, top {qpg} through → <strong>{shapeLabel(bracket)}</strong>
        </div>
        {uneven && (
          <div style={{ ...muted, marginTop: 6 }}>Groups won't be even — some will have one more team than others.</div>
        )}
      </div>
      <button type="button" disabled={busy || !canSeed} onClick={() => onSeed(numGroups, qpg)}
        style={(busy || !canSeed) ? CTA_DISABLED : CTA}>
        {busy ? "Working…" : "Draw groups & generate fixtures → go live"}
      </button>
      {!canSeed && (
        <div style={{ ...muted, marginTop: 8 }}>
          You need at least {numGroups * (qpg + 1)} approved teams for {numGroups} groups with top {qpg} advancing — you have {activeCount}.
        </div>
      )}
    </>
  );
}

// Per-group tables from venue_get_tournament_standings (rows already ordered by the
// full tiebreak). The top `qualifiers_per_group` of each group are gold-tinted — by
// group_rank once the knockout is seeded (h2h-authoritative), else by live position.
function GroupStandings({ standings }) {
  const rows = standings?.standings || [];
  // Self-serve always records qualifiers_per_group (mig 498); fall back to top-2
  // for a seeded group whose config never recorded it (parity with the public
  // page + venue_seed_knockout's default).
  const rawQpg = standings?.qualifiers_per_group ?? null;
  const qpg = rawQpg != null ? rawQpg : (standings?.knockout_seeded ? 2 : null);
  if (rows.length === 0) return <div style={muted}>Group tables will appear once the first results are in.</div>;

  const byGroup = {};
  rows.forEach((r) => { const g = r.group_label || "_"; (byGroup[g] ||= []).push(r); });
  const groups = Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b));

  const th = { fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--t2)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "6px 4px", textAlign: "center" };
  const td = { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--t1)", padding: "8px 4px", textAlign: "center" };

  return (
    <>
      {groups.map(([g, grows]) => (
        <div key={g} style={{ marginBottom: 14 }}>
          {g !== "_" && <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--t2)", margin: "0 0 6px" }}>Group {g}</div>}
          <div style={{ ...CARD, padding: "6px 10px", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", width: 20 }}>#</th>
                  <th style={{ ...th, textAlign: "left" }}>Team</th>
                  <th style={th}>P</th><th style={th}>W</th><th style={th}>D</th><th style={th}>L</th><th style={th}>GD</th><th style={th}>Pts</th>
                </tr>
              </thead>
              <tbody>
                {grows.map((r, i) => {
                  const qual = qpg != null && (r.group_rank != null ? r.group_rank <= qpg : i < qpg);
                  return (
                    <tr key={r.team_id} style={qual ? QUAL_ROW : undefined}>
                      <td style={{ ...td, textAlign: "left", color: qual ? "var(--gold)" : "var(--t2)", fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ ...td, textAlign: "left", fontWeight: qual ? 700 : 400 }}>{r.team_name}</td>
                      <td style={td}>{r.played}</td>
                      <td style={td}>{r.won}</td>
                      <td style={td}>{r.drawn}</td>
                      <td style={td}>{r.lost}</td>
                      <td style={td}>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{r.pts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {qpg != null && (
        <div style={{ ...muted, marginTop: -4, marginBottom: 4 }}>
          Gold = top {qpg} of each group, into the knockout.
        </div>
      )}
    </>
  );
}

// Retire a no-show: walks over its outstanding group games so the knockout gate can
// clear (mig 499). Guarded server-side against stranding a group (group_would_strand).
function RetireList({ activeTeams, busy, onRetire }) {
  const [confirmId, setConfirmId] = useState(null);
  if (activeTeams.length === 0) return null;
  return (
    <>
      <div style={LABEL}>Report a no-show</div>
      <div style={{ ...muted, marginBottom: 8 }}>
        If a team doesn't turn up, retire it — its remaining group games become walkovers so you can still generate the knockout.
      </div>
      {activeTeams.map((t) => (
        <div key={t.competition_team_id} style={{ ...CARD, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: 15, color: "var(--t1)" }}>
            {t.team_name}{t.group_label ? ` · Group ${t.group_label}` : ""}
          </span>
          {confirmId === t.competition_team_id ? (
            <>
              <button type="button" disabled={busy}
                onClick={() => { setConfirmId(null); onRetire(t.competition_team_id); }}
                style={{ ...GHOST, color: "var(--danger, #FF6060)", fontWeight: 700 }}>
                Retire
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmId(null)} style={GHOST}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmId(t.competition_team_id)}
              style={{ ...GHOST, color: "var(--t2)" }}>
              Didn't show
            </button>
          )}
        </div>
      ))}
    </>
  );
}

// ── Score entry ──────────────────────────────────────────────────────────────
function ScoreEntry({ fixture, onCancel, onSubmit, busy, error }) {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const page = { padding: "calc(28px + env(safe-area-inset-top)) 20px calc(48px + env(safe-area-inset-bottom))", minHeight: "100dvh" };
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
