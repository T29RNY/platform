import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  listVenueTournaments, venueCreateTournament, venueGetTournament, venueGetSchedule,
  venueAddCompetition, venueRegisterTeam, venueSendTeamInvite, venueApproveTeam,
  venueRejectTeam, venueGenerateSchedule, venueSeedKnockout, venueSeedDoubleElimination,
  venueAssignFixtureSlot, venueUpdateTournamentStatus,
} from "@platform/core";
import Modal from "./Modal.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

// Epic D / D2 — venue-operator Event OS surface. Wires the mig-452 venue-token
// tournament wrappers: create a venue-owned tournament (club_id optional), build
// the competition→teams→schedule chain, publish/advance status, and link out to
// the public run/spectate page (/tournament/<slug>, already live). This is a NEW
// Event OS surface — distinct from BracketView (LEAGUE-mode cups).
const PUBLIC_BASE = "https://app.in-or-out.com";

const STATUS_META = {
  draft:     { cls: "pill-muted", label: "Draft" },
  open:      { cls: "pill-ok",    label: "Open" },
  closed:    { cls: "pill-warn",  label: "Closed" },
  live:      { cls: "pill-live",  label: "Live" },
  completed: { cls: "pill-muted", label: "Completed" },
};
// Forward status path the operator can push a tournament along.
const NEXT_STATUS = { draft: "open", open: "live", live: "completed" };
const NEXT_LABEL  = { draft: "Publish (open registration)", open: "Go live", live: "Mark completed" };

const COMP_TYPES = [
  { v: "league",      label: "League (round-robin)" },
  { v: "group_stage", label: "Group stage" },
  { v: "cup",         label: "Cup (knockout)" },
];

const fmtDate = (d) => {
  if (!d) return "";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return d; }
};

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return <span className={"pill " + m.cls}><span className="pill-dot" /> {m.label}</span>;
}

export default function TournamentsView({ venueToken }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [openSlug, setOpenSlug] = useState(null);

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const res = await listVenueTournaments(venueToken);
      setList(res?.tournaments ?? []);
    } catch (e) { setError(e?.message || String(e)); }
  }, [venueToken]);

  useEffect(() => { loadList(); }, [loadList]);

  if (openSlug) {
    return (
      <TournamentDetail
        venueToken={venueToken}
        slug={openSlug}
        onBack={async () => { setOpenSlug(null); await loadList(); }}
      />
    );
  }

  const tournaments = list ?? [];

  return (
    <div>
      <SectionHead label="Tournaments" count={list ? tournaments.length : null}>
        <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>+ New tournament</button>
      </SectionHead>

      {error && <EmptyState title="Couldn’t load tournaments" body={error} />}

      {list && tournaments.length === 0 && !error && (
        <EmptyState
          title="No tournaments yet"
          body="Run a standalone tournament — a weekend cup, a 5-a-side league, a group stage. Create one, register teams, generate the schedule and publish it to a public page."
          action={<button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New tournament</button>}
        />
      )}

      {tournaments.length > 0 && (
        <div className="card-grid">
          {tournaments.map((t) => (
            <button key={t.tournament_id} className="t-card" onClick={() => setOpenSlug(t.slug)}>
              <div className="t-card-head">
                <span className="t-card-name">{t.name}</span>
                <StatusPill status={t.status} />
              </div>
              <div className="t-card-meta">
                <span>{fmtDate(t.event_date)}{t.event_end_date && t.event_end_date !== t.event_date ? ` – ${fmtDate(t.event_end_date)}` : ""}</span>
              </div>
              <div className="t-card-stats">
                <span><strong>{t.competitions}</strong> competition{t.competitions === 1 ? "" : "s"}</span>
                <span><strong>{t.teams}</strong> team{t.teams === 1 ? "" : "s"}</span>
                {t.live_count > 0 && <span className="t-live">{t.live_count} live</span>}
                {t.completed_count > 0 && <span>{t.completed_count} played</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {createOpen && (
        <CreateTournamentModal
          venueToken={venueToken}
          onClose={() => setCreateOpen(false)}
          onDone={async (slug) => { setCreateOpen(false); await loadList(); setOpenSlug(slug); }}
        />
      )}
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────────────────────
function CreateTournamentModal({ venueToken, onClose, onDone }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [entryFee, setEntryFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Auto-suggest a slug from the name until the operator edits it themselves.
  const autoSlug = useMemo(
    () => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60),
    [name]
  );
  const effectiveSlug = slugTouched ? slug : autoSlug;

  async function save() {
    if (busy) return;
    if (!name.trim()) { setError("Give the tournament a name."); return; }
    if (!effectiveSlug || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(effectiveSlug)) {
      setError("The link must be lowercase letters, numbers and hyphens (at least 2 characters)."); return;
    }
    if (!eventDate) { setError("Pick a start date."); return; }
    if (eventEndDate && eventEndDate < eventDate) { setError("The end date can’t be before the start date."); return; }
    const feePence = entryFee.trim() ? Math.round(parseFloat(entryFee) * 100) : 0;
    if (entryFee.trim() && (!Number.isFinite(feePence) || feePence < 0)) { setError("Entry fee must be a positive amount."); return; }
    setBusy(true); setError(null);
    try {
      const res = await venueCreateTournament(venueToken, name.trim(), effectiveSlug, eventDate, {
        eventEndDate: eventEndDate || null,
        entryFeePence: feePence,
      });
      await onDone(res?.slug || effectiveSlug);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="New tournament"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Creating…" : "Create tournament"}</button>
      </>}>
      <label className="field-label">Name</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer 5-a-side Cup" autoFocus />

      <label className="field-label" style={{ marginTop: 12 }}>Public link</label>
      <div className="t-slug-row">
        <span className="t-slug-base">/tournament/</span>
        <input className="input" value={effectiveSlug}
          onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
          placeholder="summer-5-a-side" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
        <div>
          <label className="field-label">Start date</label>
          <input className="input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">End date <span className="text-mute">(optional)</span></label>
          <input className="input" type="date" value={eventEndDate} onChange={(e) => setEventEndDate(e.target.value)} />
        </div>
      </div>

      <label className="field-label" style={{ marginTop: 12 }}>Entry fee per team <span className="text-mute">(optional, £)</span></label>
      <input className="input" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="0.00" />

      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Detail / manage ─────────────────────────────────────────────────────────────
function TournamentDetail({ venueToken, slug, onBack }) {
  const [detail, setDetail] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [addCompOpen, setAddCompOpen] = useState(false);
  const [genComp, setGenComp] = useState(null);     // competition obj for the generate-schedule modal
  const [slotFixture, setSlotFixture] = useState(null);
  const [teamCtx, setTeamCtx] = useState(null);     // { comp, mode: 'register' | 'invite' }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await venueGetTournament(venueToken, slug);
      setDetail(d);
      const sched = await venueGetSchedule(venueToken, d.tournament_id);
      setSchedule(sched);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [venueToken, slug]);

  useEffect(() => { load(); }, [load]);

  // Map competition_id → its scheduled fixtures (from the schedule read).
  const fixturesByComp = useMemo(() => {
    const m = {};
    for (const c of schedule?.competitions ?? []) m[c.competition_id] = c.fixtures ?? [];
    return m;
  }, [schedule]);

  const pitches = schedule?.venue_playing_areas ?? [];

  async function advance() {
    if (busy || !detail) return;
    const next = NEXT_STATUS[detail.status];
    if (!next) return;
    setBusy(true);
    try { await venueUpdateTournamentStatus(venueToken, slug, next); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function approve(ct) {
    setBusy(true);
    try { await venueApproveTeam(venueToken, ct.competition_team_id); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function reject(ct) {
    setBusy(true);
    try { await venueRejectTeam(venueToken, ct.competition_team_id, null); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function seedKnockout(comp) {
    setBusy(true);
    try { await venueSeedKnockout(venueToken, detail.tournament_id, comp.competition_id); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function seedDoubleElim(comp) {
    setBusy(true);
    try { await venueSeedDoubleElimination(venueToken, detail.tournament_id, comp.competition_id); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  if (loading && !detail) return <EmptyState title="Loading tournament…" />;
  if (error && !detail) return <EmptyState title="Couldn’t load tournament" body={error} action={<button className="btn btn-ghost" onClick={onBack}>Back</button>} />;
  if (!detail) return null;

  const publicUrl = `${PUBLIC_BASE}/tournament/${detail.slug}`;
  const competitions = detail.competitions ?? [];

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 12 }}>← All tournaments</button>

      <div className="t-detail-head">
        <div>
          <h2 className="t-detail-name">{detail.name}</h2>
          <div className="t-detail-sub">
            <StatusPill status={detail.status} />
            <span className="text-mute">{fmtDate(detail.event_date)}{detail.event_end_date && detail.event_end_date !== detail.event_date ? ` – ${fmtDate(detail.event_end_date)}` : ""}</span>
            {detail.club_id == null && <span className="pill pill-muted">Venue-owned</span>}
          </div>
        </div>
        <div className="t-detail-actions">
          {detail.status !== "draft" && (
            <a className="btn btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noreferrer">View public page</a>
          )}
          {NEXT_STATUS[detail.status] && (
            <button className="btn btn-primary btn-sm" onClick={advance} disabled={busy}>{NEXT_LABEL[detail.status]}</button>
          )}
        </div>
      </div>

      {detail.status === "draft" && (
        <p className="text-mute" style={{ fontSize: 13, margin: "0 0 16px" }}>
          This tournament is a draft — it isn’t on the public page yet. Add competitions and teams, then “Publish” to open it up.
        </p>
      )}

      {error && <p style={{ color: "var(--live)", fontSize: 12, marginBottom: 12 }}>{error}</p>}

      <SectionHead label="Competitions" count={competitions.length}>
        <button className="btn btn-sm" onClick={() => setAddCompOpen(true)}>+ Add competition</button>
      </SectionHead>

      {competitions.length === 0 && (
        <EmptyState title="No competitions yet" body="A competition is a league, group stage or knockout cup within this tournament. Add one to start registering teams." />
      )}

      {competitions.map((comp) => {
        const teams = comp.teams ?? [];
        const active = teams.filter((t) => t.status === "active");
        const pending = teams.filter((t) => t.status === "pending");
        const rejected = teams.filter((t) => t.status === "rejected");
        const fixtures = fixturesByComp[comp.competition_id] ?? [];
        const isDoubleElim = comp.format === "double_elimination";
        const isKnockout = comp.type === "cup" || comp.format === "single_elimination";
        const canGenerate = fixtures.length === 0 && active.length >= 2 && !isDoubleElim && !isKnockout;
        const canSeedKnockout = fixtures.length === 0 && active.length >= 2 && isKnockout && !comp.knockout_seeded;
        const canSeedDouble = fixtures.length === 0 && active.length >= 4 && isDoubleElim && !comp.knockout_seeded;

        return (
          <div key={comp.competition_id} className="t-comp">
            <div className="t-comp-head">
              <div>
                <span className="t-comp-name">{comp.name}</span>
                <span className="t-comp-type text-mute">{comp.type}{comp.format ? ` · ${comp.format}` : ""}</span>
              </div>
              <div className="t-comp-actions">
                <button className="btn btn-xs" onClick={() => setTeamCtx({ comp, mode: "register" })}>+ Team</button>
                <button className="btn btn-xs btn-ghost" onClick={() => setTeamCtx({ comp, mode: "invite" })}>Invite</button>
              </div>
            </div>

            {/* Teams */}
            {pending.length > 0 && (
              <div className="t-team-block">
                <div className="t-team-label">Pending approval</div>
                {pending.map((t) => (
                  <div key={t.competition_team_id} className="t-team-row">
                    <span>{t.team_name}</span>
                    <span className="t-team-row-actions">
                      <button className="btn btn-xs btn-primary" onClick={() => approve(t)} disabled={busy}>Approve</button>
                      <button className="btn btn-xs btn-ghost" onClick={() => reject(t)} disabled={busy}>Reject</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {active.length > 0 && (
              <div className="t-team-block">
                <div className="t-team-label">Teams ({active.length})</div>
                <div className="t-team-chips">
                  {active.map((t) => <span key={t.competition_team_id} className="t-team-chip">{t.team_name}</span>)}
                </div>
              </div>
            )}
            {rejected.length > 0 && (
              <div className="t-team-block">
                <div className="t-team-label text-mute">Rejected: {rejected.map((t) => t.team_name).join(", ")}</div>
              </div>
            )}
            {teams.length === 0 && <p className="text-mute" style={{ fontSize: 12, margin: "4px 0 0" }}>No teams yet.</p>}

            {/* Schedule build */}
            <div className="t-comp-build">
              {canGenerate && (
                <button className="btn btn-sm btn-primary" onClick={() => setGenComp(comp)} disabled={busy}>Generate schedule</button>
              )}
              {canSeedKnockout && (
                <button className="btn btn-sm btn-primary" onClick={() => seedKnockout(comp)} disabled={busy}>Seed knockout</button>
              )}
              {canSeedDouble && (
                <button className="btn btn-sm btn-primary" onClick={() => seedDoubleElim(comp)} disabled={busy}>Seed double elimination</button>
              )}
              {fixtures.length === 0 && active.length < 2 && (
                <span className="text-mute" style={{ fontSize: 12 }}>Register at least 2 teams to build the schedule.</span>
              )}
            </div>

            {/* Fixtures */}
            {fixtures.length > 0 && (
              <div className="t-fixtures">
                {fixtures.map((fx) => (
                  <div key={fx.fixture_id} className="t-fx-row">
                    <span className="t-fx-teams">{fx.home_team_name || "TBD"} <span className="vs-sep">v</span> {fx.away_team_name || "TBD"}</span>
                    <span className="t-fx-when">
                      {fx.scheduled_date
                        ? <>{fmtDate(fx.scheduled_date)}{fx.kickoff_time ? ` · ${String(fx.kickoff_time).slice(0, 5)}` : ""}{fx.pitch_name ? ` · ${fx.pitch_name}` : ""}</>
                        : <button className="btn btn-xs btn-ghost" onClick={() => setSlotFixture(fx)}>Assign slot</button>}
                    </span>
                    <span className="t-fx-score">{fx.home_score != null && fx.away_score != null ? `${fx.home_score}–${fx.away_score}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {addCompOpen && (
        <AddCompetitionModal venueToken={venueToken} tournamentId={detail.tournament_id}
          onClose={() => setAddCompOpen(false)}
          onDone={async () => { setAddCompOpen(false); await load(); }} />
      )}
      {teamCtx && (
        <TeamModal venueToken={venueToken} tournamentId={detail.tournament_id} ctx={teamCtx}
          onClose={() => setTeamCtx(null)}
          onDone={async () => { setTeamCtx(null); await load(); }} />
      )}
      {genComp && (
        <GenerateScheduleModal venueToken={venueToken} tournamentId={detail.tournament_id} comp={genComp} pitches={pitches}
          onClose={() => setGenComp(null)}
          onDone={async () => { setGenComp(null); await load(); }} />
      )}
      {slotFixture && (
        <AssignSlotModal venueToken={venueToken} fixture={slotFixture} pitches={pitches}
          onClose={() => setSlotFixture(null)}
          onDone={async () => { setSlotFixture(null); await load(); }} />
      )}
    </div>
  );
}

// ── Sub-modals ──────────────────────────────────────────────────────────────────
function AddCompetitionModal({ venueToken, tournamentId, onClose, onDone }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("league");
  const [format, setFormat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    if (!name.trim()) { setError("Give the competition a name."); return; }
    setBusy(true); setError(null);
    try { await venueAddCompetition(venueToken, tournamentId, name.trim(), type, format.trim() || null); await onDone(); }
    catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Add competition"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Adding…" : "Add competition"}</button>
      </>}>
      <label className="field-label">Name</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Open Division" autoFocus />

      <label className="field-label" style={{ marginTop: 12 }}>Type</label>
      <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
        {COMP_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
      </select>

      <label className="field-label" style={{ marginTop: 12 }}>Format <span className="text-mute">(optional, e.g. 5-a-side, single_elimination)</span></label>
      <input className="input" value={format} onChange={(e) => setFormat(e.target.value)} placeholder="e.g. 5-a-side" />

      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function TeamModal({ venueToken, tournamentId, ctx, onClose, onDone }) {
  const { comp, mode } = ctx;
  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (mode === "register") {
        if (!teamName.trim()) { setError("Enter a team name."); setBusy(false); return; }
        await venueRegisterTeam(venueToken, tournamentId, comp.competition_id, teamName.trim());
        await onDone();
      } else {
        const res = await venueSendTeamInvite(venueToken, tournamentId, comp.competition_id, email.trim() || null);
        setInviteCode(res?.code || null);
        setBusy(false);
      }
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  const isInvite = mode === "invite";
  const inviteUrl = inviteCode ? `${PUBLIC_BASE}/tournament/join/${inviteCode}` : null;

  return (
    <Modal onClose={() => !busy && onClose()} title={isInvite ? `Invite a team — ${comp.name}` : `Register a team — ${comp.name}`}
      foot={inviteCode ? (
        <button className="btn btn-primary" onClick={onDone}>Done</button>
      ) : (<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : (isInvite ? "Create invite" : "Register team")}</button>
      </>)}>
      {isInvite ? (
        inviteCode ? (
          <>
            <p className="text-mute" style={{ fontSize: 13, marginBottom: 8 }}>Share this link — the team registers themselves (pending your approval):</p>
            <input className="input" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
          </>
        ) : (
          <>
            <label className="field-label">Email <span className="text-mute">(optional — leave blank for a shareable link)</span></label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="captain@example.com" autoFocus />
          </>
        )
      ) : (
        <>
          <label className="field-label">Team name</label>
          <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Riverside FC" autoFocus />
        </>
      )}
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function GenerateScheduleModal({ venueToken, tournamentId, comp, pitches, onClose, onDone }) {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [slotMinutes, setSlotMinutes] = useState(45);
  const [pitchIds, setPitchIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function togglePitch(id) {
    setPitchIds((cur) => cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]);
  }

  async function save() {
    if (busy) return;
    if (!startDate || !startTime) { setError("Date and kickoff time are required."); return; }
    setBusy(true); setError(null);
    try {
      await venueGenerateSchedule(venueToken, tournamentId, comp.competition_id, Number(slotMinutes), startTime, startDate, pitchIds);
      await onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title={`Generate schedule — ${comp.name}`}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Generating…" : "Generate"}</button>
      </>}>
      <p className="text-mute" style={{ fontSize: 13, marginBottom: 14 }}>Builds a round-robin — every team plays every other once — back-to-back from the start time across the pitches you pick.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label className="field-label">Date</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">First kickoff</label>
          <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Slot (mins)</label>
          <input className="input" type="number" min="5" step="5" value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)} />
        </div>
      </div>
      <label className="field-label">Pitches <span className="text-mute">(optional — pick one or more to spread games)</span></label>
      {pitches.length === 0 ? (
        <p className="text-mute" style={{ fontSize: 12 }}>No pitches set up — games will be scheduled unallocated; assign pitches per game afterwards.</p>
      ) : (
        <div className="t-pitch-pick">
          {pitches.map((p) => (
            <button key={p.id} type="button" className={"t-pitch-opt" + (pitchIds.includes(p.id) ? " on" : "")} onClick={() => togglePitch(p.id)}>{p.name}</button>
          ))}
        </div>
      )}
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function AssignSlotModal({ venueToken, fixture, pitches, onClose, onDone }) {
  const [date, setDate] = useState(fixture.scheduled_date || "");
  const [time, setTime] = useState(fixture.kickoff_time ? String(fixture.kickoff_time).slice(0, 5) : "09:00");
  const [pitchId, setPitchId] = useState(fixture.playing_area_id || "");
  const [slotMinutes, setSlotMinutes] = useState(fixture.slot_minutes || 45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    if (!date || !time) { setError("Date and kickoff time are required."); return; }
    setBusy(true); setError(null);
    try {
      await venueAssignFixtureSlot(venueToken, fixture.fixture_id, date, time, pitchId || null, Number(slotMinutes));
      await onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title={`${fixture.home_team_name || "TBD"} v ${fixture.away_team_name || "TBD"}`}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save slot"}</button>
      </>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label className="field-label">Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Kickoff</label>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Slot (mins)</label>
          <input className="input" type="number" min="5" step="5" value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)} />
        </div>
      </div>
      <label className="field-label">Pitch</label>
      <select className="input" value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
        <option value="">Unallocated</option>
        {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// Translate the RPC's snake_case error codes into operator-readable copy.
function friendlyError(e) {
  const msg = e?.message || String(e);
  const map = {
    slug_taken: "That public link is already in use — pick another.",
    slug_invalid: "The link must be lowercase letters, numbers and hyphens.",
    name_required: "A name is required.",
    not_authorised: "You don’t have permission to manage tournaments here.",
    invalid_venue_token: "Your session has expired — sign in again.",
    end_date_before_start: "The end date can’t be before the start date.",
    invalid_status: "That status change isn’t allowed.",
  };
  for (const k of Object.keys(map)) if (msg.includes(k)) return map[k];
  return msg;
}
