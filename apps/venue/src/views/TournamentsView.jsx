import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  listVenueTournaments, venueCreateTournament, venueGetTournament, venueGetSchedule,
  venueAddCompetition, venueRegisterTeam, venueSendTeamInvite, venueApproveTeam,
  venueRejectTeam, venueGenerateSchedule, venueSeedKnockout, venueSeedDoubleElimination,
  venueAssignFixtureSlot, venueUpdateTournamentStatus,
  // D3 (mig 453) — commercial + sports-day
  venueAddSponsor, venueListSponsors, venueRemoveSponsor, venueSetBranding,
  venueSetPlayerOfTournament, venueGetEquipmentForTournament, venueBookEquipmentForTournament,
  venueListTournamentEquipmentBookings, venueCancelEquipmentBooking,
  venueSetPerformanceConfig, venueAddPerformanceEvent, venueListPerformanceEvents,
  venueRecordResult, venueGetSportsDayStandings,
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

// Sports-day disciplines: how a result is measured + ranked.
const MEASUREMENT_TYPES = [
  { v: "time_asc",  label: "Time — fastest wins (e.g. sprint)", unit: "s" },
  { v: "distance",  label: "Distance — furthest wins (e.g. long jump)", unit: "m" },
  { v: "height",    label: "Height — highest wins (e.g. high jump)", unit: "m" },
  { v: "weight",    label: "Weight — heaviest wins (e.g. shot put)", unit: "kg" },
  { v: "time_desc", label: "Score — highest wins", unit: "pts" },
];

const fmtDate = (d) => {
  if (!d) return "";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return d; }
};

const fmtDateTime = (ts) => {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return ts; }
};

const measurementLabel = (t) => (MEASUREMENT_TYPES.find((m) => m.v === t)?.label.split(" — ")[0]) || t;

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

  // D3 — commercial + sports-day
  const [sponsors, setSponsors] = useState([]);
  const [equipCatalogue, setEquipCatalogue] = useState([]);
  const [equipBookings, setEquipBookings] = useState([]);
  const [perfEvents, setPerfEvents] = useState([]);
  const [standings, setStandings] = useState([]);
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [potOpen, setPotOpen] = useState(false);
  const [bookEquipOpen, setBookEquipOpen] = useState(false);
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [resultCtx, setResultCtx] = useState(null);   // performance event for record-result modal

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await venueGetTournament(venueToken, slug);
      setDetail(d);
      const [sched, spon, evs, stand, cat, books] = await Promise.all([
        venueGetSchedule(venueToken, d.tournament_id),
        venueListSponsors(venueToken, d.tournament_id),
        venueListPerformanceEvents(venueToken, d.tournament_id),
        venueGetSportsDayStandings(venueToken, d.tournament_id),
        venueGetEquipmentForTournament(venueToken, d.tournament_id),
        venueListTournamentEquipmentBookings(venueToken, d.tournament_id),
      ]);
      setSchedule(sched);
      setSponsors(spon ?? []);
      setPerfEvents(evs ?? []);
      setStandings(stand ?? []);
      setEquipCatalogue(cat ?? []);
      setEquipBookings(books ?? []);
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
  async function removeSponsor(s) {
    setBusy(true);
    try { await venueRemoveSponsor(venueToken, s.sponsor_id); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function cancelBooking(b) {
    setBusy(true);
    try { await venueCancelEquipmentBooking(venueToken, b.booking_id); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  // Every active team across competitions — the entry pool for sports-day results.
  const activeTeams = useMemo(() => {
    const out = [];
    for (const comp of detail?.competitions ?? [])
      for (const t of comp.teams ?? [])
        if (t.status === "active") out.push({ id: t.competition_team_id, name: t.team_name });
    return out;
  }, [detail]);
  const hasResults = useMemo(() => perfEvents.some((e) => (e.result_count ?? 0) > 0), [perfEvents]);

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
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={busy || loading} title="Reload teams, fixtures and registrations">↻ Refresh</button>
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

      {/* ── Commercial ──────────────────────────────────────────────────────── */}
      <div className="t-panel">
        <SectionHead label="Commercial" />
        <div className="t-panel-grid">
          {/* Branding */}
          <div className="t-tile">
            <div className="t-tile-head"><span>Branding</span>
              <button className="btn btn-xs" onClick={() => setBrandingOpen(true)}>Edit</button></div>
            {detail.branding && (detail.branding.primary_colour || detail.branding.custom_logo_url) ? (
              <div className="t-brand-row">
                {detail.branding.primary_colour && <span className="t-swatch" style={{ background: detail.branding.primary_colour }} title={detail.branding.primary_colour} />}
                {detail.branding.secondary_colour && <span className="t-swatch" style={{ background: detail.branding.secondary_colour }} title={detail.branding.secondary_colour} />}
                {detail.branding.custom_logo_url && <span className="text-mute" style={{ fontSize: 12 }}>Custom logo set</span>}
              </div>
            ) : <p className="text-mute" style={{ fontSize: 12, margin: 0 }}>No custom colours or logo yet.</p>}
          </div>

          {/* Player of the Tournament */}
          <div className="t-tile">
            <div className="t-tile-head"><span>Player of the Tournament</span>
              <button className="btn btn-xs" onClick={() => setPotOpen(true)}>{detail.player_of_tournament_name ? "Edit" : "Set"}</button></div>
            {detail.player_of_tournament_name ? (
              <p style={{ margin: 0 }}><strong>{detail.player_of_tournament_name}</strong>{detail.player_of_tournament_team ? <span className="text-mute"> · {detail.player_of_tournament_team}</span> : null}</p>
            ) : <p className="text-mute" style={{ fontSize: 12, margin: 0 }}>Not awarded yet.</p>}
          </div>
        </div>

        {/* Sponsors */}
        <div className="t-subhead"><span>Sponsors ({sponsors.length})</span>
          <button className="btn btn-xs" onClick={() => setSponsorOpen(true)}>+ Add sponsor</button></div>
        {sponsors.length === 0 ? (
          <p className="text-mute" style={{ fontSize: 12, margin: "2px 0 0" }}>No sponsors yet — add logos to show on the public page.</p>
        ) : (
          <div className="t-sponsor-list">
            {sponsors.map((s) => (
              <div key={s.sponsor_id} className="t-sponsor-row">
                <span className="t-sponsor-name">{s.name}{s.website_url ? <a className="text-mute" href={s.website_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, fontSize: 12 }}>↗</a> : null}</span>
                <button className="btn btn-xs btn-ghost" onClick={() => removeSponsor(s)} disabled={busy}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {/* Equipment */}
        <div className="t-subhead"><span>Equipment ({equipBookings.length})</span>
          <button className="btn btn-xs" onClick={() => setBookEquipOpen(true)} disabled={equipCatalogue.length === 0}>+ Book equipment</button></div>
        {equipCatalogue.length === 0 ? (
          <p className="text-mute" style={{ fontSize: 12, margin: "2px 0 0" }}>No equipment catalogue at this venue yet.</p>
        ) : equipBookings.length === 0 ? (
          <p className="text-mute" style={{ fontSize: 12, margin: "2px 0 0" }}>Nothing booked for this tournament.</p>
        ) : (
          <div className="t-sponsor-list">
            {equipBookings.map((b) => (
              <div key={b.booking_id} className="t-sponsor-row">
                <span className="t-sponsor-name">{b.qty}× {b.equipment_name}
                  <span className="text-mute" style={{ marginLeft: 8, fontSize: 12 }}>{fmtDateTime(b.start_at)}{b.status !== "confirmed" ? ` · ${b.status}` : ""}</span></span>
                <button className="btn btn-xs btn-ghost" onClick={() => cancelBooking(b)} disabled={busy}>Cancel</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Sports day ──────────────────────────────────────────────────────── */}
      <div className="t-panel">
        <SectionHead label="Sports day" count={perfEvents.length}>
          <button className="btn btn-xs btn-ghost" onClick={() => setPointsOpen(true)}>Points table</button>
          <button className="btn btn-xs" onClick={() => setAddEventOpen(true)}>+ Add event</button>
        </SectionHead>
        {perfEvents.length === 0 ? (
          <EmptyState title="No events" body="Add a discipline — a sprint, long jump, relay — then record each athlete’s result. Team points come from the points table." />
        ) : (
          <>
            <div className="t-event-list">
              {perfEvents.map((ev) => (
                <div key={ev.event_id} className="t-event-row">
                  <span className="t-event-name">{ev.name}<span className="text-mute" style={{ fontSize: 12, marginLeft: 8 }}>{measurementLabel(ev.measurement_type)} · {ev.unit}</span></span>
                  <span className="t-event-meta">
                    <span className="text-mute" style={{ fontSize: 12 }}>{ev.result_count ?? 0} result{(ev.result_count ?? 0) === 1 ? "" : "s"}</span>
                    <button className="btn btn-xs" onClick={() => setResultCtx(ev)} disabled={activeTeams.length === 0}>Record</button>
                  </span>
                </div>
              ))}
            </div>
            {standings.length > 0 && (
              <>
                <div className="t-subhead"><span>Team standings</span></div>
                <div className="t-standings">
                  {standings.map((row, i) => (
                    <div key={row.competition_team_id} className="t-standings-row">
                      <span className="t-standings-rank">{i + 1}</span>
                      <span className="t-standings-team">{row.team_name}</span>
                      <span className="t-standings-medals text-mute">🥇{row.gold} 🥈{row.silver} 🥉{row.bronze}</span>
                      <span className="t-standings-pts"><strong>{row.points}</strong> pts</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {addCompOpen && (
        <AddCompetitionModal venueToken={venueToken} tournamentId={detail.tournament_id}
          onClose={() => setAddCompOpen(false)}
          onDone={async () => { setAddCompOpen(false); await load(); }} />
      )}
      {sponsorOpen && (
        <AddSponsorModal venueToken={venueToken} tournamentId={detail.tournament_id}
          onClose={() => setSponsorOpen(false)}
          onDone={async () => { setSponsorOpen(false); await load(); }} />
      )}
      {brandingOpen && (
        <BrandingModal venueToken={venueToken} tournamentId={detail.tournament_id} branding={detail.branding}
          onClose={() => setBrandingOpen(false)}
          onDone={async () => { setBrandingOpen(false); await load(); }} />
      )}
      {potOpen && (
        <PotModal venueToken={venueToken} tournamentId={detail.tournament_id} detail={detail}
          onClose={() => setPotOpen(false)}
          onDone={async () => { setPotOpen(false); await load(); }} />
      )}
      {bookEquipOpen && (
        <BookEquipmentModal venueToken={venueToken} tournamentId={detail.tournament_id} catalogue={equipCatalogue}
          onClose={() => setBookEquipOpen(false)}
          onDone={async () => { setBookEquipOpen(false); await load(); }} />
      )}
      {addEventOpen && (
        <AddEventModal venueToken={venueToken} tournamentId={detail.tournament_id}
          onClose={() => setAddEventOpen(false)}
          onDone={async () => { setAddEventOpen(false); await load(); }} />
      )}
      {pointsOpen && (
        <PointsModal venueToken={venueToken} tournamentId={detail.tournament_id} pointsConfig={detail.points_config} locked={hasResults}
          onClose={() => setPointsOpen(false)}
          onDone={async () => { setPointsOpen(false); await load(); }} />
      )}
      {resultCtx && (
        <RecordResultModal venueToken={venueToken} event={resultCtx} teams={activeTeams}
          onClose={() => setResultCtx(null)}
          onDone={async () => { setResultCtx(null); await load(); }} />
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

// ── D3 commercial sub-modals ──────────────────────────────────────────────────
function AddSponsorModal({ venueToken, tournamentId, onClose, onDone }) {
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    if (!name.trim()) { setError("Enter a sponsor name."); return; }
    setBusy(true); setError(null);
    try {
      await venueAddSponsor(venueToken, tournamentId, name.trim(), { logoUrl: logoUrl.trim() || null, websiteUrl: websiteUrl.trim() || null });
      await onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Add sponsor"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Adding…" : "Add sponsor"}</button>
      </>}>
      <label className="field-label">Name</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Sports" autoFocus />
      <label className="field-label" style={{ marginTop: 12 }}>Logo URL <span className="text-mute">(optional)</span></label>
      <input className="input" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
      <label className="field-label" style={{ marginTop: 12 }}>Website <span className="text-mute">(optional)</span></label>
      <input className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function BrandingModal({ venueToken, tournamentId, branding, onClose, onDone }) {
  const [primary, setPrimary] = useState(branding?.primary_colour || "#1f6feb");
  const [secondary, setSecondary] = useState(branding?.secondary_colour || "#0b1929");
  const [logoUrl, setLogoUrl] = useState(branding?.custom_logo_url || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await venueSetBranding(venueToken, tournamentId, primary || null, secondary || null, logoUrl.trim() || null);
      await onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Tournament branding"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save branding"}</button>
      </>}>
      <p className="text-mute" style={{ fontSize: 13, marginTop: 0 }}>Colours and a logo for the public tournament page.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label className="field-label">Primary colour</label>
          <input className="input" type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} style={{ height: 40, padding: 4 }} />
        </div>
        <div>
          <label className="field-label">Secondary colour</label>
          <input className="input" type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} style={{ height: 40, padding: 4 }} />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Logo URL <span className="text-mute">(optional)</span></label>
      <input className="input" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function PotModal({ venueToken, tournamentId, detail, onClose, onDone }) {
  const [name, setName] = useState(detail?.player_of_tournament_name || "");
  const [team, setTeam] = useState(detail?.player_of_tournament_team || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    if (!name.trim()) { setError("Enter the player’s name."); return; }
    setBusy(true); setError(null);
    try { await venueSetPlayerOfTournament(venueToken, tournamentId, name.trim(), team.trim() || null); await onDone(); }
    catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Player of the Tournament"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </>}>
      <label className="field-label">Player name</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Smith" autoFocus />
      <label className="field-label" style={{ marginTop: 12 }}>Team <span className="text-mute">(optional)</span></label>
      <input className="input" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. Riverside FC" />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function BookEquipmentModal({ venueToken, tournamentId, catalogue, onClose, onDone }) {
  const [equipmentId, setEquipmentId] = useState(catalogue[0]?.equipment_id || "");
  const [qty, setQty] = useState(1);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    if (!equipmentId) { setError("Pick an item."); return; }
    if (!date) { setError("Pick a date."); return; }
    if (endTime <= startTime) { setError("End time must be after the start time."); return; }
    setBusy(true); setError(null);
    try {
      const startAt = new Date(`${date}T${startTime}:00`).toISOString();
      const endAt = new Date(`${date}T${endTime}:00`).toISOString();
      await venueBookEquipmentForTournament(venueToken, tournamentId, equipmentId, Number(qty), startAt, endAt, null);
      await onDone();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Book equipment"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Booking…" : "Book"}</button>
      </>}>
      <label className="field-label">Item</label>
      <select className="input" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
        {catalogue.map((e) => <option key={e.equipment_id} value={e.equipment_id}>{e.name} ({e.quantity} available)</option>)}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="field-label">Qty</label>
          <input className="input" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="field-label">From</label>
          <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div>
          <label className="field-label">To</label>
          <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Date</label>
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── D3 sports-day sub-modals ──────────────────────────────────────────────────
function AddEventModal({ venueToken, tournamentId, onClose, onDone }) {
  const [name, setName] = useState("");
  const [mType, setMType] = useState("time_asc");
  const [unit, setUnit] = useState("s");
  const [unitTouched, setUnitTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function pickType(v) {
    setMType(v);
    if (!unitTouched) setUnit(MEASUREMENT_TYPES.find((m) => m.v === v)?.unit || "");
  }

  async function save() {
    if (busy) return;
    if (!name.trim()) { setError("Give the event a name."); return; }
    if (!unit.trim()) { setError("Set the unit (e.g. s, m, kg)."); return; }
    setBusy(true); setError(null);
    try { await venueAddPerformanceEvent(venueToken, tournamentId, name.trim(), mType, unit.trim()); await onDone(); }
    catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Add event"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Adding…" : "Add event"}</button>
      </>}>
      <label className="field-label">Event name</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 100m Sprint" autoFocus />
      <label className="field-label" style={{ marginTop: 12 }}>How is it measured?</label>
      <select className="input" value={mType} onChange={(e) => pickType(e.target.value)}>
        {MEASUREMENT_TYPES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
      </select>
      <label className="field-label" style={{ marginTop: 12 }}>Unit</label>
      <input className="input" value={unit} onChange={(e) => { setUnitTouched(true); setUnit(e.target.value); }} placeholder="s / m / kg" />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function RecordResultModal({ venueToken, event, teams, onClose, onDone }) {
  const [athlete, setAthlete] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    if (!athlete.trim()) { setError("Enter the athlete’s name."); return; }
    if (!teamId) { setError("Pick a team."); return; }
    const num = parseFloat(value);
    if (!Number.isFinite(num)) { setError("Enter a numeric result."); return; }
    setBusy(true); setError(null);
    try { await venueRecordResult(venueToken, event.event_id, athlete.trim(), teamId, num); await onDone(); }
    catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title={`Record — ${event.name}`}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Record result"}</button>
      </>}>
      <label className="field-label">Athlete</label>
      <input className="input" value={athlete} onChange={(e) => setAthlete(e.target.value)} placeholder="Athlete name" autoFocus />
      <label className="field-label" style={{ marginTop: 12 }}>Team</label>
      <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label className="field-label" style={{ marginTop: 12 }}>Result <span className="text-mute">({event.unit})</span></label>
      <input className="input" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`e.g. 12.5`} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function PointsModal({ venueToken, tournamentId, pointsConfig, locked, onClose, onDone }) {
  // Simple rank→points editor for places 1–6 (the common sports-day spread).
  const init = useMemo(() => {
    const c = pointsConfig || {};
    return [1, 2, 3, 4, 5, 6].map((r) => String(c[String(r)] ?? (r <= 3 ? [10, 8, 6][r - 1] : Math.max(0, 6 - (r - 3)))));
  }, [pointsConfig]);
  const [vals, setVals] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function setRank(i, v) { setVals((cur) => cur.map((x, j) => (j === i ? v : x))); }

  async function save() {
    if (busy || locked) return;
    const cfg = {};
    vals.forEach((v, i) => { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) cfg[String(i + 1)] = n; });
    if (Object.keys(cfg).length === 0) { setError("Set points for at least 1st place."); return; }
    setBusy(true); setError(null);
    try { await venueSetPerformanceConfig(venueToken, tournamentId, cfg); await onDone(); }
    catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Points table"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        <span className="spacer" />
        {!locked && <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save points"}</button>}
      </>}>
      <p className="text-mute" style={{ fontSize: 13, marginTop: 0 }}>Points each finishing place earns its team, totalled across every event.</p>
      {locked && <p style={{ color: "var(--warn, #b80)", fontSize: 12 }}>Results are already recorded — the points table is locked.</p>}
      <div className="t-points-grid">
        {vals.map((v, i) => (
          <div key={i} className="t-points-cell">
            <label className="field-label">{["1st","2nd","3rd","4th","5th","6th"][i]}</label>
            <input className="input" type="number" min="0" step="1" value={v} disabled={locked} onChange={(e) => setRank(i, e.target.value)} />
          </div>
        ))}
      </div>
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
    results_already_recorded: "Results are already in — the points table is locked.",
    invalid_points_config: "The points table is invalid.",
    invalid_measurement_type: "Pick how the event is measured.",
    unit_required: "Set the unit (e.g. s, m, kg).",
    insufficient_availability: "Not enough of that item is free for this window.",
    equipment_not_at_venue: "That item isn’t at this venue.",
    invalid_quantity: "Quantity must be at least 1.",
    invalid_window: "The booking end must be after its start.",
    cannot_cancel: "This booking can’t be cancelled — it’s already out or returned.",
    team_not_in_tournament: "That team isn’t registered in this tournament.",
    athlete_name_required: "Enter the athlete’s name.",
    sponsor_not_found: "That sponsor no longer exists — refresh.",
    booking_not_found: "That booking no longer exists — refresh.",
  };
  for (const k of Object.keys(map)) if (msg.includes(k)) return map[k];
  return msg;
}
