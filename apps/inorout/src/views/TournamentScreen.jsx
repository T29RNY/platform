import React, { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { toPng } from "html-to-image";
import { getTournamentPublic, tournamentRegisterTeam, tournamentReport } from "@platform/core/storage/supabase.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tournament Hub — the public face of an Event OS tournament.
// Lifecycle-aware (upcoming / live / completed): a cinematic hero, a rotating
// sponsor banner, tabbed navigation (Home / Fixtures / Tables / Knockout /
// My Team / Info), tap-a-game live match detail, self-serve team registration,
// and a directions/info tab. Reads get_tournament_public; polls live.
// ─────────────────────────────────────────────────────────────────────────────

const HERO_FALLBACK   = "/tournament-hero.jpg";
const ACCENT_FALLBACK = "rgba(39,174,96,1)"; // club green, used only if no branding colour

const STATUS_LABEL = { open: "Taking entries", closed: "Entries closed", live: "Live now", completed: "Finished", draft: "" };

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" }); }
  catch { return iso; }
}
function fmtShortDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}
function mapsUrl(t) {
  if (t?.venue_lat != null && t?.venue_lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${t.venue_lat},${t.venue_lng}`;
  }
  const q = [t?.venue_name, t?.venue_address, t?.venue_city, t?.venue_postcode].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000 * 30);
    return () => clearInterval(id);
  }, []);
  if (!targetIso) return null;
  const target = new Date(targetIso).getTime();
  if (Number.isNaN(target)) return null;
  let diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000); diff -= d * 86400000;
  const h = Math.floor(diff / 3600000);  diff -= h * 3600000;
  const m = Math.floor(diff / 60000);
  return { d, h, m, done: target <= now };
}

export default function TournamentScreen({ slug, signedIn = false }) {
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [notFound, setNotFound]     = useState(false);
  const [tab, setTab]               = useState(null);
  const [teamFilter, setTeamFilter] = useState("");
  const [openFixtureId, setOpenFixtureId] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const pollRef = useRef(null);
  const didInitTab = useRef(false);

  const load = (s) => getTournamentPublic(s)
    .then((data) => { if (!data?.ok) setNotFound(true); else { setTournament(data); setNotFound(false); } })
    .catch((e) => { console.error("[tournament] public fetch failed", e); setNotFound(true); })
    .finally(() => setLoading(false));

  useEffect(() => {
    let alive = true;
    setLoading(true); setNotFound(false); setTournament(null);
    getTournamentPublic(slug)
      .then((data) => { if (!alive) return; if (!data?.ok) setNotFound(true); else setTournament(data); })
      .catch((e) => { console.error("[tournament] public fetch failed", e); if (alive) setNotFound(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  // live poll (30s) while the tournament is live
  useEffect(() => {
    if (tournament?.status !== "live") return;
    pollRef.current = setInterval(() => load(slug), 30000);
    return () => clearInterval(pollRef.current);
  }, [tournament?.status, slug]);

  // pick the initial tab once (from ?tab= deep-link, else Home); never fight later clicks
  useEffect(() => {
    if (!tournament || didInitTab.current) return;
    didInitTab.current = true;
    const wanted = new URL(window.location.href).searchParams.get("tab");
    setTab(wanted || "home");
  }, [tournament]);

  const setTabDeep = (t) => {
    setTab(t);
    try { const u = new URL(window.location.href); u.searchParams.set("tab", t); window.history.replaceState({}, "", u); } catch { /* noop */ }
  };

  if (loading)  return <Shell><Centered>Loading…</Centered></Shell>;
  if (notFound) return <Shell><NotFound /></Shell>;

  const t          = tournament;
  const status     = t.status;
  const upcoming   = status === "open" || status === "closed";
  const completed  = status === "completed";
  const live       = status === "live";
  const branding   = t.branding ?? {};
  const accent     = branding.primary_colour || ACCENT_FALLBACK;
  const heroUrl    = branding.hero_url || HERO_FALLBACK;

  const fixtures         = t.fixtures ?? [];
  const knockoutFixtures = t.knockout_fixtures ?? [];
  const standings        = t.standings ?? [];
  const sponsors         = t.sponsors ?? [];
  const info             = t.info ?? {};

  const knockoutIds = new Set(knockoutFixtures.map((f) => f.fixture_id));
  const scheduleFixtures = fixtures.filter((f) => !knockoutIds.has(f.fixture_id));
  const liveFixtures = fixtures.filter((f) => f.status === "in_progress");
  const champion = deriveChampion(knockoutFixtures);

  const allTeams = Array.from(new Set((t.competitions ?? []).flatMap((c) => (c.teams ?? []).map((x) => x.team_name)))).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const hasTables   = standings.some((s) => s.rows?.some((r) => r.played > 0));
  const hasKnockout = knockoutFixtures.length > 0;

  const TABS = [
    { key: "home",     label: live ? "Live" : completed ? "Results" : "Home", show: true },
    { key: "fixtures", label: "Fixtures", show: scheduleFixtures.length > 0 },
    { key: "tables",   label: "Tables",   show: hasTables },
    { key: "knockout", label: "Knockout", show: hasKnockout },
    { key: "myteam",   label: "My Team",  show: allTeams.length > 0 && !upcoming },
    { key: "info",     label: "Info",     show: true },
  ].filter((x) => x.show);

  const activeTab = TABS.some((x) => x.key === tab) ? tab : TABS[0]?.key;
  const openFixture = [...fixtures, ...knockoutFixtures].find((f) => f.fixture_id === openFixtureId) || null;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/tournament/${slug}` : "";

  return (
    <Shell accent={accent}>
      <HubStyles />
      {sponsors.length > 0 && <SponsorBanner sponsors={sponsors} accent={accent} />}
      <Hero t={t} accent={accent} heroUrl={heroUrl} upcoming={upcoming} live={live} completed={completed} champion={champion} info={info} onShare={() => setShowShare(true)} />

      <nav className="th-tabs" aria-label="Tournament sections">
        {TABS.map((x) => (
          <button key={x.key}
            className={`th-tab${x.key === activeTab ? " active" : ""}`}
            style={x.key === activeTab ? { color: accent, borderColor: accent } : undefined}
            onClick={() => setTabDeep(x.key)} aria-current={x.key === activeTab ? "page" : undefined}>
            {x.label}
          </button>
        ))}
      </nav>

      <div className="th-body">
        {activeTab === "home" && (
          <HomeTab t={t} accent={accent} upcoming={upcoming} live={live} completed={completed}
                   liveFixtures={liveFixtures} scheduleFixtures={scheduleFixtures} knockoutFixtures={knockoutFixtures}
                   standings={standings} champion={champion} info={info} onOpenFixture={setOpenFixtureId} onGoto={setTabDeep} slug={slug} signedIn={signedIn} />
        )}
        {activeTab === "fixtures" && (
          <section>
            <FilterBar allTeams={allTeams} teamFilter={teamFilter} setTeamFilter={setTeamFilter} />
            <FixtureList fixtures={scheduleFixtures.filter((f) => matchesTeam(f, teamFilter))}
                         groupBy="stage" accent={accent} onOpenFixture={setOpenFixtureId} emptyTeam={teamFilter} />
          </section>
        )}
        {activeTab === "tables" && <TablesTab standings={standings} accent={accent} />}
        {activeTab === "knockout" && (
          <section>
            <SectionHeading>Knockout</SectionHeading>
            <Card><FixtureList fixtures={knockoutFixtures} groupBy="round" accent={accent} onOpenFixture={setOpenFixtureId} bare /></Card>
          </section>
        )}
        {activeTab === "myteam" && (
          <MyTeamTab allTeams={allTeams} teamFilter={teamFilter} setTeamFilter={setTeamFilter}
                     scheduleFixtures={scheduleFixtures} knockoutFixtures={knockoutFixtures}
                     standings={standings} accent={accent} onOpenFixture={setOpenFixtureId} />
        )}
        {activeTab === "info" && <InfoTab t={t} info={info} accent={accent} />}
      </div>

      <ReportTournament slug={slug} accent={accent} />

      {signedIn
        ? <a href="/" className="th-back print-hide">← Back to In or Out</a>
        : <a href="https://in-or-out.com" className="th-back print-hide">Powered by In or Out · Get the app →</a>}

      {openFixture && <MatchSheet fixture={openFixture} accent={accent} onClose={() => setOpenFixtureId(null)} />}
      {showShare && <SharePosterSheet t={t} accent={accent} heroUrl={heroUrl} info={info} shareUrl={shareUrl} onClose={() => setShowShare(false)} />}
    </Shell>
  );
}

function matchesTeam(fx, team) { return !team || fx.home_team_name === team || fx.away_team_name === team; }

function deriveChampion(knockoutFixtures) {
  const finals = knockoutFixtures.filter((f) => (f.round_name || "").toLowerCase().includes("final") && !(f.round_name || "").toLowerCase().includes("semi"));
  const decided = finals.find((f) => f.status === "completed" && f.home_score != null && f.away_score != null && f.home_score !== f.away_score);
  if (!decided) return null;
  return decided.home_score > decided.away_score ? decided.home_team_name : decided.away_team_name;
}

// ── Sponsor banner ad ────────────────────────────────────────────────────────
// A full-width banner-ad slot the tournament host fills with a sponsor creative,
// rotating (crossfade) when more than one. Image-led; falls back to a styled name
// card when a sponsor has no creative.
function SponsorBanner({ sponsors, accent }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (sponsors.length < 2) return;
    const id = setInterval(() => setI((p) => (p + 1) % sponsors.length), 6000);
    return () => clearInterval(id);
  }, [sponsors.length]);
  const sp = sponsors[i % sponsors.length];
  if (!sp) return null;
  const body = (
    <div className="th-ad-frame">
      {sp.logo_url
        ? <img key={sp.sponsor_id} src={sp.logo_url} alt={sp.name} className="th-ad-img" />
        : <div className="th-ad-fallback"><span className="th-ad-fallback-eyebrow" style={{ color: accent }}>Sponsor</span><span className="th-ad-fallback-name">{sp.name}</span></div>}
      <span className="th-ad-chip">Tournament sponsor</span>
      {sponsors.length > 1 && (
        <div className="th-ad-dots">
          {sponsors.map((s, idx) => <span key={s.sponsor_id} className={`th-ad-dot${idx === (i % sponsors.length) ? " on" : ""}`} style={idx === (i % sponsors.length) ? { background: accent } : undefined} />)}
        </div>
      )}
    </div>
  );
  return (
    <div className="th-ad print-hide" aria-label={`Sponsor: ${sp.name}`}>
      {sp.website_url
        ? <a href={sp.website_url} target="_blank" rel="noopener noreferrer" className="th-ad-link">{body}</a>
        : body}
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ t, accent, heroUrl, upcoming, live, completed, champion, info, onShare }) {
  const cd = useCountdown(upcoming ? t.event_date : null);
  return (
    <header className="th-hero">
      <div className="th-hero-img" style={{ backgroundImage: `url(${heroUrl})` }} aria-hidden="true" />
      <div className="th-hero-tint" style={{ background: `linear-gradient(180deg, rgba(10,10,8,0.45) 0%, rgba(10,10,8,0.82) 70%, var(--bg, #0A0A08) 100%)` }} aria-hidden="true" />
      <div className="th-hero-glow" style={{ background: `radial-gradient(60% 40% at 50% 8%, ${accent}33, transparent 70%)` }} aria-hidden="true" />
      <div className="th-hero-content">
        <span className="th-status" style={{ color: accent, borderColor: accent }}>
          {live && <span className="th-livedot" style={{ background: accent }} />}
          {STATUS_LABEL[t.status] || t.status}
        </span>
        {branding_logo(t) && <img src={branding_logo(t)} alt="" className="th-hero-logo" />}
        <h1 className="th-title">{t.name}</h1>
        {(t.branding?.tagline || info.tagline) && <p className="th-tagline">{t.branding?.tagline || info.tagline}</p>}
        <div className="th-hero-meta">
          <span>{fmtDate(t.event_date)}{t.event_end_date && t.event_end_date !== t.event_date ? ` – ${fmtDate(t.event_end_date)}` : ""}</span>
          <span className="th-dot">·</span>
          <span>{t.venue_name}</span>
        </div>
        <button className="th-share-btn print-hide" style={{ borderColor: accent, color: accent }} onClick={onShare}>
          Share &amp; poster
        </button>
        {completed && champion && (
          <div className="th-champion" style={{ borderColor: accent }}>
            <span className="th-champion-crown">🏆</span>
            <div><div className="th-champion-label" style={{ color: accent }}>Champions</div><div className="th-champion-name">{champion}</div></div>
          </div>
        )}
        {upcoming && cd && !cd.done && (
          <div className="th-countdown">
            <Cd n={cd.d} l="days" accent={accent} /><Cd n={cd.h} l="hrs" accent={accent} /><Cd n={cd.m} l="min" accent={accent} />
          </div>
        )}
      </div>
    </header>
  );
}
function branding_logo(t) { return (t.branding ?? {}).custom_logo_url || null; }
function Cd({ n, l, accent }) {
  return <div className="th-cd"><div className="th-cd-n" style={{ color: accent }}>{String(n).padStart(2, "0")}</div><div className="th-cd-l">{l}</div></div>;
}

// ── Home tab ─────────────────────────────────────────────────────────────────
function HomeTab({ t, accent, upcoming, live, completed, liveFixtures, scheduleFixtures, knockoutFixtures = [], standings, champion, info, onOpenFixture, onGoto, slug, signedIn = false }) {
  if (upcoming) {
    return (
      <div className="th-stack">
        {t.registration_open && <RegisterCard t={t} accent={accent} slug={slug} />}
        {!t.registration_open && (
          <Card><div className="th-note">Entries are closed for this tournament. See you on the day — check the Info tab for directions and timings.</div></Card>
        )}
        {!signedIn && <InstallCta accent={accent} live={live} />}
        <QuickInfo t={t} info={info} accent={accent} onGoto={onGoto} />
        <TeamsIn t={t} accent={accent} />
      </div>
    );
  }
  // group + knockout together so the headline knockout results surface, most-recent first
  const allFx      = [...scheduleFixtures, ...knockoutFixtures];
  const byKickoffAsc  = (a, b) => String(a.kickoff_time || "").localeCompare(String(b.kickoff_time || ""));
  const byKickoffDesc = (a, b) => String(b.kickoff_time || "").localeCompare(String(a.kickoff_time || ""));
  const upcomingFx = allFx.filter((f) => f.status === "scheduled").sort(byKickoffAsc).slice(0, 4);
  const recentFx   = allFx.filter((f) => f.status === "completed").sort(byKickoffDesc).slice(0, 6);
  return (
    <div className="th-stack">
      {completed && champion && (
        <Card><div className="th-home-champ"><span className="th-champion-crown">🏆</span><div><div className="th-champion-label" style={{ color: accent }}>Champions</div><div className="th-champion-name">{champion}</div></div></div></Card>
      )}
      {!signedIn && <InstallCta accent={accent} live={live} />}
      {liveFixtures.length > 0 && (
        <section>
          <SectionHeading>On now</SectionHeading>
          <Card><FixtureList fixtures={liveFixtures} groupBy="none" accent={accent} onOpenFixture={onOpenFixture} bare /></Card>
        </section>
      )}
      {upcomingFx.length > 0 && (
        <section>
          <SectionHeading>Next up</SectionHeading>
          <Card><FixtureList fixtures={upcomingFx} groupBy="none" accent={accent} onOpenFixture={onOpenFixture} bare /></Card>
        </section>
      )}
      {recentFx.length > 0 && (
        <section>
          <SectionHeading>Latest results</SectionHeading>
          <Card><FixtureList fixtures={recentFx} groupBy="none" accent={accent} onOpenFixture={onOpenFixture} bare /></Card>
        </section>
      )}
    </div>
  );
}

function QuickInfo({ t, info, accent, onGoto }) {
  const fee = t.entry_fee_pence ? `£${(t.entry_fee_pence / 100).toFixed(0)} / team` : "Free entry";
  return (
    <Card>
      <div className="th-qi">
        <Stat label="Entry" value={fee} accent={accent} />
        <Stat label="Where" value={t.venue_name} accent={accent} />
        {info.whats_on && <Stat label="Schedule" value={info.whats_on} accent={accent} wide />}
      </div>
      <button className="th-link" style={{ color: accent }} onClick={() => onGoto("info")}>Full info & directions →</button>
    </Card>
  );
}
function Stat({ label, value, accent, wide }) {
  return <div className={`th-stat${wide ? " wide" : ""}`}><div className="th-stat-l" style={{ color: accent }}>{label}</div><div className="th-stat-v">{value}</div></div>;
}

// Signed-out acquisition CTA — the public tournament link is the platform's strongest
// install wedge (every spectator/player taps a live bracket at peak emotional investment).
// Shown to signed-out visitors only; the native app is where "follow your team live" lives.
// Points at the marketing site (same target as the footer), which routes to the App Store.
function InstallCta({ accent, live = false }) {
  return (
    <Card>
      <div className="th-install">
        <div className="th-install-copy">
          <div className="th-install-h">{live ? "Follow the action live" : "Follow your team live"}</div>
          <div className="th-note">Live scores, fixtures &amp; results — free in the In or Out app.</div>
        </div>
        <a className="th-cta th-install-btn" href="https://in-or-out.com" style={{ background: accent }}>
          Get the app →
        </a>
      </div>
    </Card>
  );
}

function TeamsIn({ t, accent }) {
  const teams = (t.competitions ?? []).flatMap((c) => (c.teams ?? []).map((x) => x.team_name)).filter(Boolean);
  if (teams.length === 0) return null;
  return (
    <section>
      <SectionHeading>Teams in ({teams.length})</SectionHeading>
      <Card><div className="th-teams">{teams.map((n, i) => <span key={i} className="th-chip" style={{ borderColor: accent }}>{n}</span>)}</div></Card>
    </section>
  );
}

// ── Register card ────────────────────────────────────────────────────────────
function RegisterCard({ t, accent, slug }) {
  const comps = t.competitions ?? [];
  const [compId, setCompId] = useState(comps[0]?.competition_id || "");
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | saving | done | error
  const [msg, setMsg]     = useState("");
  const submit = async () => {
    if (!name.trim()) { setMsg("Enter a team name."); setState("error"); return; }
    setState("saving"); setMsg("");
    try {
      await tournamentRegisterTeam(slug, compId || comps[0]?.competition_id, name.trim(), email.trim() || null);
      setState("done");
    } catch (e) {
      const code = e?.message || "";
      setMsg(code.includes("team_name_taken") ? "That team name is already entered." : code.includes("registration_closed") ? "Entries have just closed." : "Couldn't register — try again.");
      setState("error");
    }
  };
  if (state === "done") {
    return <Card><div className="th-reg-done" style={{ borderColor: accent }}><div className="th-reg-tick" style={{ color: accent }}>✓</div><div><div className="th-reg-done-h">You're in — pending approval</div><div className="th-note">{name.trim()} is registered. The organiser will confirm your spot{email ? ` and email ${email.trim()}` : ""}.</div></div></div></Card>;
  }
  return (
    <Card>
      <div className="th-reg-h">Register your team</div>
      <div className="th-note" style={{ marginBottom: 12 }}>
        {t.entry_fee_pence ? `£${(t.entry_fee_pence / 100).toFixed(0)} per team. ` : ""}Spots are limited — secure yours now.
      </div>
      <div className="th-form">
        {comps.length > 1 && (
          <label className="th-field"><span className="th-field-l">Competition</span>
            <select value={compId} onChange={(e) => setCompId(e.target.value)} className="th-input">
              {comps.map((c) => <option key={c.competition_id} value={c.competition_id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="th-field"><span className="th-field-l">Team name</span>
          <input className="th-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunday Legends" maxLength={60} /></label>
        <label className="th-field"><span className="th-field-l">Contact email (optional)</span>
          <input className="th-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" /></label>
        {state === "error" && <div className="th-err" role="alert">{msg}</div>}
        <button className="th-cta" style={{ background: accent }} disabled={state === "saving"} onClick={submit}>
          {state === "saving" ? "Registering…" : "Register team"}
        </button>
      </div>
    </Card>
  );
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function FilterBar({ allTeams, teamFilter, setTeamFilter }) {
  if (allTeams.length === 0) return null;
  return (
    <div className="th-filter print-hide">
      <span className="th-filter-l">Team</span>
      <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="th-input th-input--inline">
        <option value="">All teams</option>
        {allTeams.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {teamFilter && <button className="th-clear" onClick={() => setTeamFilter("")}>Show all</button>}
    </div>
  );
}

function FixtureList({ fixtures, groupBy, accent, onOpenFixture, bare, emptyTeam }) {
  if (fixtures.length === 0) {
    return <div className="th-empty">{emptyTeam ? `No fixtures for ${emptyTeam} yet.` : "No fixtures yet."}</div>;
  }
  const groups = groupBy === "none" ? [{ label: null, items: fixtures }] : groupFixtures(fixtures, groupBy);
  const body = groups.map((g, gi) => (
    <div key={g.label ?? gi}>
      {g.label && <div className="th-group-h">{g.label}</div>}
      {g.items.map((fx) => <FixtureRow key={fx.fixture_id} fx={fx} accent={accent} onOpen={() => onOpenFixture(fx.fixture_id)} />)}
    </div>
  ));
  return bare ? <>{body}</> : <Card>{body}</Card>;
}

function groupFixtures(fixtures, by) {
  const groups = []; let cur = null;
  for (const fx of fixtures) {
    const label = by === "round" ? (fx.round_name ?? `Round ${fx.round}`) : (fx.round_name ?? (fx.scheduled_date ? fmtShortDate(fx.scheduled_date) : null));
    if (!cur || cur.label !== label) { cur = { label, items: [] }; groups.push(cur); }
    cur.items.push(fx);
  }
  return groups;
}

function FixtureRow({ fx, accent, onOpen }) {
  const live = fx.status === "in_progress";
  const hasScore = fx.home_score != null && fx.away_score != null;
  const statusText = live ? "LIVE" : fx.status === "completed" ? "FT" : fx.status === "postponed" ? "P" : fx.status === "voided" ? "—" : (fx.kickoff_time || "");
  return (
    <button className="th-fx" onClick={onOpen} aria-label={`${fx.home_team_name || "TBD"} versus ${fx.away_team_name || "TBD"}, view details`}>
      <div className="th-fx-main">
        <span className="th-fx-team home">{fx.home_team_name ?? "TBD"}</span>
        <span className="th-fx-score" style={live ? { color: accent } : undefined}>{hasScore ? `${fx.home_score}–${fx.away_score}` : "v"}</span>
        <span className="th-fx-team away">{fx.away_team_name ?? "TBD"}</span>
        <span className="th-fx-status" style={live ? { color: accent } : undefined}>
          {live && <span className="th-livedot sm" style={{ background: accent }} />}{statusText}
        </span>
      </div>
      <div className="th-fx-sub">
        {fx.kickoff_time && <span>KO {fx.kickoff_time}</span>}
        {fx.kickoff_time && (fx.pitch_name || fx.referee_name) && <span className="th-dot">·</span>}
        {fx.pitch_name && <span>{fx.pitch_name}</span>}
        {fx.pitch_name && fx.referee_name && <span className="th-dot">·</span>}
        {fx.referee_name && <span>Ref {fx.referee_name}</span>}
        {live && fx.current_period && <span className="th-dot">·</span>}
        {live && fx.current_period && <span style={{ color: accent }}>{fx.current_period}</span>}
      </div>
    </button>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────
function TablesTab({ standings, accent }) {
  const blocks = standings.filter((c) => (c.rows ?? []).some((r) => r.played > 0));
  if (blocks.length === 0) return <div className="th-empty">No tables yet.</div>;
  return (
    <>
      {blocks.map((comp) => {
        const byGroup = {};
        (comp.rows ?? []).forEach((r) => { const g = r.group_label ?? "_"; (byGroup[g] ||= []).push(r); });
        const groups = Object.entries(byGroup);
        return (
          <section key={comp.competition_id}>
            <SectionHeading>{comp.competition_name}</SectionHeading>
            {groups.map(([g, rows]) => (
              <div key={g} style={{ marginBottom: groups.length > 1 ? 12 : 0 }}>
                {groups.length > 1 && <div className="th-group-h">Group {g}</div>}
                <Card noPad><StandingsTable rows={rows} accent={accent} seeded={comp.knockout_seeded} qpg={comp.qualifiers_per_group} /></Card>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

function StandingsTable({ rows, accent, seeded, qpg }) {
  // Qualify-tint: gold the top-`qpg` of each group. Once the knockout is seeded
  // group_rank is authoritative (h2h-correct); before that, the rows are already
  // in finishing order so position stands in for the live "who's through" cue.
  return (
    <div className="th-table-wrap">
      <table className="th-table">
        <thead><tr><th className="l">#</th><th className="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const adv = qpg != null && (r.group_rank != null ? r.group_rank <= qpg : i < qpg);
            return (
              <tr key={r.team_id} style={adv ? { background: `${accent}14` } : undefined}>
                <td className="l th-rank" style={adv ? { color: accent } : undefined}>{i + 1}</td>
                <td className="l th-tn">{r.team_name}{adv && <span className="th-adv" style={{ color: accent }}>ADV</span>}</td>
                <td>{r.played}</td><td>{r.won}</td><td>{r.drawn}</td><td>{r.lost}</td>
                <td style={{ color: r.gd > 0 ? accent : undefined }}>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                <td className="th-pts">{r.pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── My Team ──────────────────────────────────────────────────────────────────
function MyTeamTab({ allTeams, teamFilter, setTeamFilter, scheduleFixtures, knockoutFixtures, standings, accent, onOpenFixture }) {
  const team = teamFilter;
  const teamFx = [...scheduleFixtures, ...knockoutFixtures].filter((f) => matchesTeam(f, team));
  const pos = findTeamPosition(standings, team);
  return (
    <div className="th-stack">
      <div className="th-filter">
        <span className="th-filter-l">Pick your team</span>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="th-input th-input--inline">
          <option value="">Choose…</option>
          {allTeams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {!team && <div className="th-empty">Pick a team to see their fixtures and results.</div>}
      {team && (
        <>
          {pos && (
            <Card><div className="th-qi">
              <Stat label="Group" value={pos.group ? `Group ${pos.group}` : "—"} accent={accent} />
              <Stat label="Position" value={`${pos.rank}${ord(pos.rank)} of ${pos.total}`} accent={accent} />
              <Stat label="Points" value={`${pos.pts} pts`} accent={accent} />
            </div></Card>
          )}
          <section>
            <SectionHeading>{team} — Fixtures</SectionHeading>
            <Card><FixtureList fixtures={teamFx} groupBy="none" accent={accent} onOpenFixture={onOpenFixture} bare emptyTeam={team} /></Card>
          </section>
        </>
      )}
    </div>
  );
}
function ord(n) { return ["th","st","nd","rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)] || "th"; }
function findTeamPosition(standings, team) {
  for (const comp of standings) {
    const rows = comp.rows ?? [];
    const byGroup = {};
    rows.forEach((r) => { const g = r.group_label ?? "_"; (byGroup[g] ||= []).push(r); });
    for (const [g, grp] of Object.entries(byGroup)) {
      const idx = grp.findIndex((r) => r.team_name === team);
      if (idx >= 0) return { group: g === "_" ? null : g, rank: idx + 1, total: grp.length, pts: grp[idx].pts };
    }
  }
  return null;
}

// ── Info / directions ────────────────────────────────────────────────────────
function InfoTab({ t, info, accent }) {
  const url = mapsUrl(t);
  const addr = [t.venue_address, t.venue_city, t.venue_postcode].filter(Boolean).join(", ");
  const fee = t.entry_fee_pence ? `£${(t.entry_fee_pence / 100).toFixed(0)} per team` : "Free entry";
  const rows = [
    ["Where", addr || t.venue_name],
    ["Entry", fee],
    ["What's on", info.whats_on],
    ["Parking", info.parking],
    ["Prices", info.prices],
    ["Rules", info.rules],
    ["Contact", info.contact],
  ].filter(([, v]) => v);
  return (
    <div className="th-stack">
      <Card>
        <div className="th-info-venue">
          <div className="th-info-venue-name">{t.venue_name}</div>
          {addr && <div className="th-note">{addr}</div>}
          <div className="th-info-actions">
            {url && <a className="th-action" style={{ borderColor: accent, color: accent }} href={url} target="_blank" rel="noopener noreferrer">Directions</a>}
            {t.venue_contact_phone && <a className="th-action" style={{ borderColor: accent, color: accent }} href={`tel:${t.venue_contact_phone}`}>Call</a>}
            {t.venue_contact_email && <a className="th-action" style={{ borderColor: accent, color: accent }} href={`mailto:${t.venue_contact_email}`}>Email</a>}
          </div>
        </div>
      </Card>
      <Card>
        {rows.map(([k, v], i) => (
          <div className={`th-info-row${i === rows.length - 1 ? " last" : ""}`} key={k}>
            <div className="th-info-k" style={{ color: accent }}>{k}</div>
            <div className="th-info-v">{v}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── Match detail sheet ───────────────────────────────────────────────────────
function MatchSheet({ fixture: fx, accent, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const live = fx.status === "in_progress";
  const hasScore = fx.home_score != null && fx.away_score != null;
  const stateText = live ? `LIVE${fx.current_period ? ` · ${fx.current_period}` : ""}` : fx.status === "completed" ? "Full time" : fx.kickoff_time ? `Kick-off ${fx.kickoff_time}` : "Scheduled";
  return (
    <div className="th-scrim" onClick={onClose}>
      <div className="th-sheet" role="dialog" aria-modal="true" aria-label="Match detail" onClick={(e) => e.stopPropagation()}>
        <div className="th-sheet-grab" />
        <div className="th-sheet-stage">{fx.round_name || fx.competition_name}</div>
        <div className="th-sheet-score">
          <div className="th-sheet-team">{fx.home_team_name ?? "TBD"}</div>
          <div className="th-sheet-nums" style={live ? { color: accent } : undefined}>{hasScore ? `${fx.home_score} – ${fx.away_score}` : "v"}</div>
          <div className="th-sheet-team">{fx.away_team_name ?? "TBD"}</div>
        </div>
        <div className="th-sheet-state" style={live ? { color: accent } : undefined}>
          {live && <span className="th-livedot" style={{ background: accent }} />}{stateText}
        </div>
        <div className="th-sheet-meta">
          {fx.pitch_name && <MetaPill k="Pitch" v={fx.pitch_name} />}
          {fx.referee_name && <MetaPill k="Referee" v={fx.referee_name} />}
          {fx.kickoff_time && <MetaPill k="Kick-off" v={fx.kickoff_time} />}
          {fx.scheduled_date && <MetaPill k="Date" v={fmtShortDate(fx.scheduled_date)} />}
        </div>
        {live && <div className="th-note th-sheet-note">Updating live as the referee scores.</div>}
        <button className="th-sheet-close" style={{ borderColor: accent, color: accent }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
function MetaPill({ k, v }) { return <div className="th-metapill"><div className="th-metapill-k">{k}</div><div className="th-metapill-v">{v}</div></div>; }

// ── Share + poster ───────────────────────────────────────────────────────────
// The hub IS the live landing page; the poster is the promo artifact that points
// to it. Clubs save/share it as an image (socials/WhatsApp) or print it (A4) —
// every poster carries a QR straight to this live page.
function SharePosterSheet({ t, accent, heroUrl, info, shareUrl, onClose }) {
  const posterRef = useRef(null);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const renderPng = async () => {
    if (!posterRef.current) return null;
    return toPng(posterRef.current, { pixelRatio: 2, cacheBust: true });
  };

  const savePoster = async () => {
    setBusy("image");
    try {
      const dataUrl = await renderPng();
      if (!dataUrl) return;
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `${t.slug}-poster.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: t.name, text: `${t.name} — ${fmtDate(t.event_date)}` });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl; a.download = `${t.slug}-poster.png`; a.click();
      }
    } catch (e) { console.error("[tournament] poster export failed", e); }
    finally { setBusy(""); }
  };

  const printPoster = async () => {
    setBusy("print");
    try {
      const dataUrl = await renderPng();
      if (!dataUrl) return;
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(`<!doctype html><html><head><title>${t.name} — poster</title><style>@page{margin:8mm}body{margin:0}img{width:100%;display:block}</style></head><body><img src="${dataUrl}" onload="window.focus();window.print()"/></body></html>`);
      w.document.close();
    } catch (e) { console.error("[tournament] poster print failed", e); }
    finally { setBusy(""); }
  };

  const shareLink = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: t.name, url: shareUrl }); return; }
      await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* user cancelled */ }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch (e) { console.error("[tournament] copy failed", e); }
  };

  return (
    <div className="th-scrim" onClick={onClose}>
      <div className="th-sheet th-share-sheet" role="dialog" aria-modal="true" aria-label="Share and poster" onClick={(e) => e.stopPropagation()}>
        <div className="th-sheet-grab" />
        <div className="th-share-title">Share &amp; poster</div>
        <div className="th-poster-wrap">
          <TournamentPoster ref={posterRef} t={t} accent={accent} heroUrl={heroUrl} info={info} shareUrl={shareUrl} />
        </div>
        <div className="th-share-actions">
          <button className="th-share-action primary" style={{ background: accent }} disabled={!!busy} onClick={savePoster}>{busy === "image" ? "Preparing…" : "Save / share poster"}</button>
          <button className="th-share-action" disabled={!!busy} onClick={printPoster}>{busy === "print" ? "Preparing…" : "Print / PDF"}</button>
          <button className="th-share-action" onClick={shareLink}>Share link</button>
          <button className="th-share-action" onClick={copyLink}>{copied ? "Copied ✓" : "Copy link"}</button>
        </div>
        <button className="th-sheet-close" style={{ borderColor: accent, color: accent }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

const TournamentPoster = React.forwardRef(function TournamentPoster({ t, accent, heroUrl, info, shareUrl }, ref) {
  const fee = t.entry_fee_pence ? `£${(t.entry_fee_pence / 100).toFixed(0)} / team` : "Free to enter";
  const sponsors = t.sponsors ?? [];
  return (
    <div ref={ref} className="th-poster">
      <div className="th-poster-hero" style={{ backgroundImage: `url(${heroUrl})` }}>
        <div className="th-poster-layer" style={{ background: "linear-gradient(180deg, rgba(10,10,8,0.35), rgba(10,10,8,0.94))" }} />
        <div className="th-poster-layer" style={{ background: `radial-gradient(70% 55% at 50% 0%, ${accent}55, transparent 70%)` }} />
        <div className="th-poster-hero-text">
          <div className="th-poster-club" style={{ color: accent }}>{t.club_name}</div>
          <div className="th-poster-title">{t.name}</div>
          {(t.branding?.tagline || info.tagline) && <div className="th-poster-tagline">{t.branding?.tagline || info.tagline}</div>}
        </div>
      </div>
      <div className="th-poster-body">
        <div className="th-poster-meta">
          <div><div className="th-poster-k" style={{ color: accent }}>When</div><div className="th-poster-v">{fmtDate(t.event_date)}</div></div>
          <div><div className="th-poster-k" style={{ color: accent }}>Where</div><div className="th-poster-v">{t.venue_name}</div></div>
          <div><div className="th-poster-k" style={{ color: accent }}>Entry</div><div className="th-poster-v">{fee}</div></div>
        </div>
        <div className="th-poster-qr-row">
          <div className="th-poster-qr"><QRCode value={shareUrl || "https://app.in-or-out.com"} size={120} /></div>
          <div className="th-poster-scan">
            <div className="th-poster-scan-big" style={{ color: accent }}>SCAN TO FOLLOW LIVE</div>
            <div className="th-poster-scan-sub">Fixtures · tables · live scores · register your team</div>
          </div>
        </div>
        {sponsors.length > 0 && (
          <div className="th-poster-sponsors">
            <div className="th-poster-sponsors-l">With thanks to our sponsors</div>
            <div className="th-poster-sponsors-n">{sponsors.map((s) => s.name).join("   ·   ")}</div>
          </div>
        )}
        <div className="th-poster-foot">Powered by <b>In or Out</b> · app.in-or-out.com</div>
      </div>
    </div>
  );
});

// ── Shell + primitives ───────────────────────────────────────────────────────
function Shell({ children, accent }) {
  return <div className="th-root" style={accent ? { "--th-accent": accent } : undefined}>{children}</div>;
}
function Centered({ children }) { return <div className="th-centered">{children}</div>; }
function NotFound() {
  return (
    <div className="th-notfound">
      <div className="th-nf-h">Tournament not found</div>
      <div className="th-note">This tournament doesn't exist or isn't open yet.</div>
      <a href="https://in-or-out.com" className="th-link">Go to In or Out →</a>
    </div>
  );
}
function Card({ children, noPad }) { return <div data-card className={`th-card${noPad ? " nopad" : ""}`}>{children}</div>; }
function SectionHeading({ children }) { return <div className="th-section-h">{children}</div>; }

// Public moderation report (migs 495/496, Apple 1.2) — parity with the in-app
// tournament view so signed-out spectators on the shared web link can flag
// offensive content too. Works signed-out (anon RPC); dedup + burst-guard live
// server-side in tournament_report.
function ReportTournament({ slug, accent }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const busyRef = useRef(false);
  const send = async (reason) => {
    if (busyRef.current || sent) return;
    busyRef.current = true;
    try {
      await tournamentReport(slug, reason);
      setSent(true); setOpen(false);
    } catch (e) {
      console.error("[tournament] report failed", e);
    } finally {
      busyRef.current = false;
    }
  };
  if (sent) {
    return <div className="th-report-done print-hide">Thanks — you’ve reported this tournament. Our team will review it.</div>;
  }
  return (
    <div className="th-report print-hide">
      {!open ? (
        <button type="button" className="th-report-link" onClick={() => setOpen(true)}>Report this tournament</button>
      ) : (
        <div className="th-report-panel" data-card>
          <div className="th-report-h">Why are you reporting this?</div>
          <div className="th-report-chips">
            {[["offensive","Offensive"],["inappropriate","Inappropriate"],["spam","Spam"],["impersonation","Impersonation"],["other","Other"]].map(([code, label]) => (
              <button key={code} type="button" className="th-report-chip" style={{ borderColor: accent }} onClick={() => send(code)}>{label}</button>
            ))}
          </div>
          <button type="button" className="th-report-cancel" onClick={() => setOpen(false)}>Never mind</button>
        </div>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
function HubStyles() {
  return (
    <style>{`
      .th-root { min-height: 100dvh; background: var(--bg, #0A0A08); color: var(--t1, #fff);
        font-family: var(--font-body, 'DM Sans', sans-serif); --th-accent: ${ACCENT_FALLBACK}; }
      .th-centered, .th-notfound { max-width: 600px; margin: 0 auto; padding: 80px 20px; text-align: center; color: var(--t2, rgba(255,255,255,0.6)); }
      .th-nf-h { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 30px; color: var(--t1, #fff); margin-bottom: 8px; }
      .th-note { font-size: 14px; color: var(--t2, rgba(255,255,255,0.55)); line-height: 1.55; }

      /* sponsor banner ad */
      .th-ad { max-width: 600px; margin: 0 auto; }
      .th-ad-link { text-decoration: none; display: block; }
      .th-ad-frame { position: relative; width: 100%; overflow: hidden; background: rgba(255,255,255,0.03);
        border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); }
      .th-ad-img { display: block; width: 100%; aspect-ratio: 21 / 9; object-fit: cover; }
      .th-ad-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
        aspect-ratio: 21 / 9; width: 100%; }
      .th-ad-fallback-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
      .th-ad-fallback-name { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 28px; color: var(--t1, #fff); }
      .th-ad-chip { position: absolute; top: 8px; right: 8px; font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
        text-transform: uppercase; color: var(--t1, #fff); background: rgba(0,0,0,0.55); border-radius: 4px; padding: 2px 6px; }
      .th-ad-dots { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 5px; }
      .th-ad-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.35); }
      .th-ad-dot.on { width: 16px; border-radius: 3px; }

      /* hero */
      .th-hero { position: relative; overflow: hidden; }
      .th-hero-img { position: absolute; inset: 0; background-size: cover; background-position: center; }
      .th-hero-tint, .th-hero-glow { position: absolute; inset: 0; }
      .th-hero-content { position: relative; max-width: 600px; margin: 0 auto; padding: 64px 20px 28px; display: flex; flex-direction: column; gap: 12px; }
      .th-status { align-self: flex-start; display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700;
        letter-spacing: 0.5px; text-transform: uppercase; padding: 5px 11px; border: 1px solid; border-radius: 20px; }
      .th-livedot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; animation: th-pulse 1.4s ease-in-out infinite; }
      .th-livedot.sm { width: 6px; height: 6px; }
      .th-hero-logo { max-height: 46px; max-width: 150px; object-fit: contain; align-self: flex-start; }
      .th-title { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: clamp(40px, 12vw, 64px); line-height: 0.92; margin: 0; letter-spacing: 0.5px; }
      .th-tagline { font-size: 15px; color: var(--t2, rgba(255,255,255,0.7)); margin: 0; }
      .th-hero-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: var(--t2, rgba(255,255,255,0.6)); }
      .th-dot { opacity: 0.5; }
      .th-countdown { display: flex; gap: 10px; margin-top: 6px; }
      .th-cd { background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); border-radius: 12px; padding: 8px 14px; text-align: center; min-width: 58px; }
      .th-cd-n { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 30px; line-height: 1; font-variant-numeric: tabular-nums; }
      .th-cd-l { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.45)); margin-top: 2px; }
      .th-champion, .th-home-champ { display: flex; align-items: center; gap: 12px; margin-top: 6px; padding: 12px 14px; border: 1px solid; border-radius: 14px; background: rgba(255,255,255,0.03); }
      .th-champion-crown { font-size: 28px; }
      .th-champion-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
      .th-champion-name { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 26px; line-height: 1; }

      /* tabs */
      .th-tabs { position: sticky; top: 0; z-index: 20; display: flex; gap: 4px; overflow-x: auto; padding: 6px 12px;
        background: rgba(10,10,8,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
        max-width: 600px; margin: 0 auto; scrollbar-width: none; }
      .th-tabs::-webkit-scrollbar { display: none; }
      .th-tab { flex: 0 0 auto; background: none; border: none; border-bottom: 2px solid transparent; color: var(--t2, rgba(255,255,255,0.55));
        font-family: var(--font-body, sans-serif); font-size: 13px; font-weight: 600; padding: 9px 12px; cursor: pointer; min-height: 44px; }
      .th-tab.active { font-weight: 700; }

      /* body */
      .th-body { max-width: 600px; margin: 0 auto; padding: 20px 16px 48px; }
      .th-stack { display: flex; flex-direction: column; gap: 24px; }
      .th-section-h { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.45)); margin-bottom: 8px; }
      .th-group-h { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.45));
        padding: 10px 0 6px; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06)); margin-bottom: 4px; }
      .th-card { background: var(--b2, rgba(255,255,255,0.04)); border: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); border-radius: 14px; padding: 4px 16px; overflow: hidden; }
      .th-card.nopad { padding: 0; }
      .th-empty { font-size: 14px; color: var(--t2, rgba(255,255,255,0.5)); text-align: center; padding: 20px 0; }

      /* fixtures */
      .th-fx { display: block; width: 100%; text-align: left; background: none; border: none; cursor: pointer;
        padding: 11px 4px; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06)); }
      .th-fx:last-child { border-bottom: none; }
      .th-fx-main { display: grid; grid-template-columns: 1fr auto 1fr 44px; align-items: center; gap: 8px; }
      .th-fx-team { font-size: 14px; color: var(--t1, #fff); }
      .th-fx-team.home { text-align: right; }
      .th-fx-team.away { text-align: left; }
      .th-fx-score { font-size: 15px; font-weight: 700; text-align: center; min-width: 40px; font-variant-numeric: tabular-nums; }
      .th-fx-status { font-size: 11px; text-align: right; color: var(--t3, rgba(255,255,255,0.5)); display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; font-variant-numeric: tabular-nums; }
      .th-fx-sub { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--t3, rgba(255,255,255,0.42)); margin-top: 4px; }

      /* tables */
      .th-table-wrap { overflow-x: auto; }
      .th-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .th-table th { padding: 8px 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.45)); background: rgba(255,255,255,0.02); text-align: right; }
      .th-table th.l { text-align: left; }
      .th-table th:first-child { padding-left: 14px; } .th-table th:last-child { padding-right: 14px; }
      .th-table td { padding: 9px 6px; text-align: right; border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06)); font-variant-numeric: tabular-nums; }
      .th-table td.l { text-align: left; }
      .th-rank { padding-left: 14px; color: var(--t3, rgba(255,255,255,0.45)); }
      .th-tn { font-weight: 600; }
      .th-adv { font-size: 9px; font-weight: 700; margin-left: 6px; letter-spacing: 0.4px; text-transform: uppercase; }
      .th-pts { font-weight: 700; padding-right: 14px; }

      /* stats / chips / info */
      .th-qi { display: flex; flex-wrap: wrap; gap: 16px; padding: 8px 0 4px; }
      .th-stat { min-width: 80px; } .th-stat.wide { flex-basis: 100%; }
      .th-stat-l { font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 2px; }
      .th-stat-v { font-size: 14px; color: var(--t1, #fff); line-height: 1.4; }
      .th-link { background: none; border: none; padding: 8px 0 4px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .th-teams { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0; }
      .th-chip { font-size: 12px; padding: 5px 10px; border: 1px solid; border-radius: 16px; color: var(--t1, #fff); opacity: 0.9; }
      .th-info-venue-name { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 24px; line-height: 1; margin-bottom: 4px; padding-top: 6px; }
      .th-info-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 0 6px; }
      .th-action { font-size: 12px; font-weight: 700; text-decoration: none; padding: 8px 14px; border: 1px solid; border-radius: 10px; min-height: 40px; display: inline-flex; align-items: center; }
      .th-info-row { display: grid; grid-template-columns: 84px 1fr; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06)); }
      .th-info-row.last { border-bottom: none; }
      .th-info-k { font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; padding-top: 1px; }
      .th-info-v { font-size: 14px; color: var(--t1, #fff); line-height: 1.5; }

      /* register form */
      .th-reg-h { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 26px; line-height: 1; padding-top: 8px; }
      .th-form { display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; }
      .th-field { display: flex; flex-direction: column; gap: 5px; }
      .th-field-l { font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.5)); }
      .th-input { background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle, rgba(255,255,255,0.14)); border-radius: 10px;
        padding: 11px 12px; font-size: 16px; color: var(--t1, #fff); font-family: var(--font-body, sans-serif); min-height: 44px; }
      .th-input--inline { min-height: 40px; padding: 8px 10px; font-size: 14px; }
      .th-cta { border: none; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 700; color: var(--bg, #0A0A08); cursor: pointer; min-height: 48px; }
      .th-cta:disabled { opacity: 0.6; cursor: default; }
      .th-install { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .th-install-copy { flex: 1; min-width: 160px; }
      .th-install-h { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 22px; line-height: 1; margin-bottom: 5px; }
      .th-install-btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; white-space: nowrap; padding: 12px 18px; }
      .th-err { font-size: 13px; color: #FF6060; }
      .th-reg-done { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border: 1px solid; border-radius: 12px; background: rgba(255,255,255,0.03); }
      .th-reg-tick { font-size: 22px; font-weight: 700; } .th-reg-done-h { font-weight: 700; margin-bottom: 4px; }

      /* filter */
      .th-filter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
      .th-filter-l { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.45)); }
      .th-clear { background: none; border: none; color: var(--t2, rgba(255,255,255,0.55)); font-size: 12px; cursor: pointer; text-decoration: underline; }

      /* match sheet */
      .th-scrim { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; justify-content: center; animation: th-fade 0.18s ease-out; }
      .th-sheet { width: 100%; max-width: 600px; background: var(--bg-raised, #15150f); border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
        border-radius: 20px 20px 0 0; padding: 10px 20px 28px; display: flex; flex-direction: column; gap: 12px; align-items: center; animation: th-slideup 0.24s cubic-bezier(0.16,1,0.3,1); }
      .th-sheet-grab { width: 38px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.2); margin: 4px 0 8px; }
      .th-sheet-stage { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.5)); }
      .th-sheet-score { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; width: 100%; }
      .th-sheet-team { font-size: 16px; font-weight: 600; text-align: center; }
      .th-sheet-nums { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 44px; line-height: 1; text-align: center; font-variant-numeric: tabular-nums; }
      .th-sheet-state { font-size: 12px; font-weight: 700; display: inline-flex; gap: 6px; align-items: center; color: var(--t2, rgba(255,255,255,0.6)); }
      .th-sheet-meta { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
      .th-metapill { background: rgba(255,255,255,0.05); border-radius: 10px; padding: 7px 12px; text-align: center; min-width: 70px; }
      .th-metapill-k { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--t3, rgba(255,255,255,0.45)); }
      .th-metapill-v { font-size: 13px; color: var(--t1, #fff); margin-top: 1px; }
      .th-sheet-note { text-align: center; }
      .th-sheet-close { background: none; border: 1px solid; border-radius: 10px; padding: 11px 18px; font-size: 13px; font-weight: 700; cursor: pointer; min-height: 44px; margin-top: 4px; }

      /* share + poster */
      .th-share-btn { align-self: flex-start; margin-top: 4px; background: rgba(255,255,255,0.06); border: 1px solid; border-radius: 20px; padding: 7px 14px; font-size: 12px; font-weight: 700; letter-spacing: 0.3px; cursor: pointer; min-height: 40px; }
      .th-share-sheet { max-height: 92dvh; overflow-y: auto; }
      .th-share-title { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 24px; line-height: 1; }
      .th-poster-wrap { display: flex; justify-content: center; padding: 4px 0 8px; width: 100%; }
      .th-share-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; max-width: 360px; }
      .th-share-action { padding: 12px 10px; border-radius: 10px; border: 1px solid var(--border-subtle, rgba(255,255,255,0.14)); background: rgba(255,255,255,0.05); color: var(--t1, #fff); font-size: 13px; font-weight: 700; font-family: var(--font-body, sans-serif); cursor: pointer; min-height: 46px; }
      .th-share-action.primary { border: none; color: var(--bg, #0A0A08); }
      .th-share-action:disabled { opacity: 0.6; cursor: default; }

      .th-poster { width: 360px; background: var(--bg, #0A0A08); border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); font-family: var(--font-body, 'DM Sans', sans-serif); }
      .th-poster-hero { position: relative; height: 280px; background-size: cover; background-position: center; }
      .th-poster-layer { position: absolute; inset: 0; }
      .th-poster-hero-text { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px; }
      .th-poster-club { font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
      .th-poster-title { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 38px; line-height: 0.92; color: var(--t1, #fff); }
      .th-poster-tagline { font-size: 13px; color: rgba(255,255,255,0.75); margin-top: 6px; }
      .th-poster-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 16px; }
      .th-poster-meta { display: flex; justify-content: space-between; gap: 8px; }
      .th-poster-k { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 3px; }
      .th-poster-v { font-size: 13px; color: var(--t1, #fff); line-height: 1.2; }
      .th-poster-qr-row { display: flex; align-items: center; gap: 14px; }
      .th-poster-qr { background: white; padding: 8px; border-radius: 10px; line-height: 0; flex-shrink: 0; }
      .th-poster-scan-big { font-family: var(--font-display, 'Bebas Neue', sans-serif); font-size: 24px; line-height: 1; }
      .th-poster-scan-sub { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 4px; }
      .th-poster-sponsors { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; }
      .th-poster-sponsors-l { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: rgba(255,255,255,0.4); }
      .th-poster-sponsors-n { display: block; font-size: 12px; color: rgba(255,255,255,0.85); margin-top: 4px; font-weight: 600; }
      .th-poster-foot { font-size: 10px; color: rgba(255,255,255,0.45); text-align: center; }

      .th-back { display: block; text-align: center; max-width: 600px; margin: 0 auto; padding: 8px 16px 32px; font-size: 13px; color: var(--t2, rgba(255,255,255,0.5)); text-decoration: none; }

      /* report / moderation affordance (Apple 1.2) */
      .th-report { max-width: 600px; margin: 0 auto; padding: 0 16px; text-align: center; }
      .th-report-link { background: none; border: none; padding: 6px 2px; cursor: pointer; font-size: 12px; color: var(--t3, rgba(255,255,255,0.45)); text-decoration: underline; font-family: var(--font-body, sans-serif); }
      .th-report-panel { text-align: left; padding: 12px 16px; margin: 4px auto 0; max-width: 460px; }
      .th-report-h { font-size: 13px; font-weight: 600; color: var(--t1, #fff); margin-bottom: 8px; }
      .th-report-chips { display: flex; flex-wrap: wrap; gap: 7px; }
      .th-report-chip { background: rgba(255,255,255,0.05); border: 1px solid; border-radius: 999px; padding: 7px 12px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--t1, #fff); font-family: var(--font-body, sans-serif); min-height: 38px; }
      .th-report-cancel { background: none; border: none; padding: 8px 2px 0; cursor: pointer; font-size: 12px; color: var(--t3, rgba(255,255,255,0.45)); font-family: var(--font-body, sans-serif); }
      .th-report-done { max-width: 600px; margin: 0 auto; padding: 6px 16px; text-align: center; font-size: 12px; color: var(--t3, rgba(255,255,255,0.45)); line-height: 1.5; }

      @keyframes th-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      @keyframes th-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes th-slideup { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) {
        .th-livedot { animation: none; } .th-scrim { animation: none; } .th-sheet { animation: none; }
      }
      @media print { .print-hide { display: none !important; } [data-card] { background: white !important; border: 1px solid gainsboro !important; } }
    `}</style>
  );
}
