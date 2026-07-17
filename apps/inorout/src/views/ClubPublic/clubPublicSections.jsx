// clubPublicSections — presentational blocks for the public club page (Epic B P4).
// Pure components built to the get_club_public payload. Every block has a designed
// empty/degrade state; the thin/empty club is the primary target. Theming comes
// from CSS vars on the .club-public container (clubPublic.css); type stays Bebas/
// DM Sans, icons are Phosphor thin. Conditional P5 slices (stats/contacts/documents/
// events/getInvolved/sponsor tier) read optional payload keys and render empty/absent
// until the P5 read-extension (mig 448) populates them — zero rework needed then.

import {
  ArrowRight, CaretRight, Clock, MapPin, SoccerBall, Star, Trophy, Lightning,
  Newspaper, ShieldCheck, Heart, Globe, FileText, QrCode, Medal, BellSimple,
  EnvelopeSimple, UsersThree, Handshake, FacebookLogo, InstagramLogo, XLogo,
  YoutubeLogo, TiktokLogo,
} from "@phosphor-icons/react";
import {
  allFixtures, formGuide, resultOf, fmtDate, relativeAgo,
  initials, teaser, crestText,
} from "./clubPublicHelpers.js";

const IC = { size: 18, weight: "thin" };

// ── crest (image or initials placeholder) ───────────────────────────────────
function Crest({ club, branding, className }) {
  if (branding?.crest_url) {
    return <span className={className}><img className="cp-crest-img" src={branding.crest_url} alt="" /></span>;
  }
  return <span className={className}>{crestText(club)}</span>;
}

// ── top bar ──────────────────────────────────────────────────────────────────
export function TopBar({ club, branding, joinHref, joinLabel }) {
  return (
    <header className="cp-topbar">
      <div className="cp-brand">
        <Crest club={club} branding={branding} className="cp-crest" />
        <span className="cp-clubname">{club?.name}</span>
      </div>
      {joinHref && <a className="cp-join-pill" href={joinHref}>{joinLabel}</a>}
    </header>
  );
}

// ── hero (pre / post / idle / empty) ─────────────────────────────────────────
function HeroFixtureLine({ f }) {
  const { dow, dm } = fmtDate(f.scheduled_date);
  const oppName = f.opponent || "TBC";
  return (
    <div className="cp-fx-teams">
      <div className="cp-fx-side">
        <div className="cp-fx-badge">{initials(f.our_team || "US")}</div>
        <div className="cp-fx-name">{f.our_team || "Us"}</div>
      </div>
      <div className="cp-fx-when">
        <div className="d">{dow}</div>
        <div className="t">{f.kickoff_time || dm}</div>
      </div>
      <div className="cp-fx-side">
        <div className="cp-fx-badge cp-fx-badge--opp">{initials(oppName)}</div>
        <div className="cp-fx-name">{oppName}</div>
      </div>
    </div>
  );
}

export function Hero({ club, branding, hero, vocab, joinHref, joinLabel, hasNews }) {
  const tagline = branding?.tagline;
  const founded = club?.founded_year ? `Community since ${club.founded_year}` : tagline;

  if (hero.kind === "empty") {
    return (
      <section className="cp-hero cp-hero--center">
        <div className="cp-hero-stripes" />
        <div className="cp-hero-scrim" />
        <div className="cp-hero-body">
          <Crest club={club} branding={branding} className="cp-hero-crest" />
          <div className="cp-hero-name">{club?.name}</div>
          {tagline && <div className="cp-hero-tagline">{tagline}</div>}
          <div className="cp-empty" style={{ margin: "16px auto 0", maxWidth: 320 }}>
            <div className="cp-empty-title">Be first to join</div>
            <div className="cp-empty-sub">Fixtures &amp; squads appear here automatically as the club gets going.</div>
          </div>
        </div>
      </section>
    );
  }

  if (hero.kind === "idle") {
    return (
      <section className="cp-hero cp-hero--center">
        <div className="cp-hero-stripes" />
        <div className="cp-hero-scrim" />
        <div className="cp-hero-body">
          <Crest club={club} branding={branding} className="cp-hero-crest" />
          <div className="cp-hero-name">{club?.name}</div>
          {founded && <div className="cp-hero-tagline">{founded}</div>}
          {joinHref && <a className="cp-cta-act" href={joinHref} style={{ marginTop: 14 }}>{joinLabel} →</a>}
        </div>
      </section>
    );
  }

  if (hero.kind === "post") {
    const f = hero.result;
    const r = resultOf(f);
    const ours = f.is_home ? f.home_score : f.away_score;
    const theirs = f.is_home ? f.away_score : f.home_score;
    const word = r === "W" ? "WON" : r === "L" ? "LOST" : "DREW";
    return (
      <section className={"cp-hero cp-hero--won"}>
        {branding?.hero_url && <img className="cp-hero-photo" src={branding.hero_url} alt="" />}
        <div className="cp-hero-stripes" />
        <div className="cp-hero-badge cp-hero-badge--won">FULL TIME · {word}</div>
        <div className="cp-hero-scrim" />
        <div className="cp-hero-body">
          <div className="cp-hero-resultline">
            {(f.our_team || "Us").toUpperCase()} {ours}–{theirs} {(f.opponent || "").toUpperCase()}
          </div>
          <div className="cp-hero-name">{club?.name}</div>
        </div>
        <div className="cp-hero-card cp-hero-card--result">
          <div className="cp-fx-top">
            <span className="cp-fx-kicker">RESULT · {f.league_name || "MATCH"}</span>
            <span className="cp-fx-meta">{fmtDate(f.scheduled_date).dm}</span>
          </div>
          <div className="cp-fx-teams">
            <div className="cp-fx-side"><div className="cp-fx-name">{f.our_team || "Us"}</div></div>
            <div className="cp-fx-score">{ours}–{theirs}</div>
            <div className="cp-fx-side"><div className="cp-fx-name">{f.opponent || "TBC"}</div></div>
          </div>
          {hasNews && (
            <a className="cp-section-link" href="#news" style={{ marginTop: 11, display: "inline-flex" }}>
              Read report <ArrowRight {...IC} size={14} />
            </a>
          )}
        </div>
      </section>
    );
  }

  // pre-match (default for grassroots)
  const f = hero.fixture;
  const { dm } = fmtDate(f.scheduled_date);
  const days = (() => {
    const d = new Date(f.scheduled_date + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    // Count calendar days, so measure midnight-to-midnight — measuring from the
    // current time shifts every label a day once it's past noon. Math.round keeps
    // a clock-change day (23h/25h) counting as one day.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const n = Math.round((d.getTime() - today.getTime()) / 86400000);
    return n <= 0 ? "TODAY" : n === 1 ? "TOMORROW" : `IN ${n} DAYS`;
  })();
  return (
    <section className="cp-hero">
      {branding?.hero_url && <img className="cp-hero-photo" src={branding.hero_url} alt="" />}
      <div className="cp-hero-stripes" />
      <div className="cp-hero-scrim" />
      <div className="cp-hero-body">
        <Crest club={club} branding={branding} className="cp-hero-crest" />
        <div className="cp-hero-name">{club?.name}</div>
        {founded && <div className="cp-hero-tagline">{founded}</div>}
      </div>
      <div className="cp-hero-card">
        <div className="cp-fx-top">
          <span className="cp-fx-kicker">{vocab.nextLabel.toUpperCase()}{days ? ` · ${days}` : ""}</span>
          <span className="cp-fx-meta">{f.league_name || (f.is_home ? "Home" : "Away")}</span>
        </div>
        <HeroFixtureLine f={f} />
        <div className="cp-fx-meta" style={{ textAlign: "center", marginTop: 9 }}>
          {f.is_home ? "Home" : "Away"} · {dm}
        </div>
      </div>
    </section>
  );
}

// ── generic section shell ────────────────────────────────────────────────────
function Section({ id, title, link, children }) {
  return (
    <section className="cp-section" id={id}>
      <div className="cp-section-head">
        <span className="cp-section-title">{title}</span>
        {link}
      </div>
      {children}
    </section>
  );
}

function Empty({ title, sub }) {
  return (
    <div className="cp-empty">
      <div className="cp-empty-title">{title}</div>
      {sub && <div className="cp-empty-sub">{sub}</div>}
    </div>
  );
}

// ── fixtures + form ──────────────────────────────────────────────────────────
// Club-wide form guide (P4, guaranteed from own club_fixtures) then the FULL
// per-league fixtures + results list (C2 — was a 3-row teaser in P4). Each league
// renders its OWN-styled block: UPCOMING (scheduled, soonest first) + RESULTS
// (completed, newest first, score + W/D/L). League header is suppressed when the
// club runs a single league (redundant). Source-agnostic — fa_import and manual
// club_fixtures arrive in the same get_club_public leagues[].fixtures[] shape.
export function FixturesSection({ leagues, vocab }) {
  const form = formGuide(allFixtures(leagues));

  const blocks = (leagues || [])
    .map((lg) => {
      const fx = lg.fixtures || [];
      const results = fx
        .filter((f) => resultOf(f))
        .sort((a, b) => (b.scheduled_date || "").localeCompare(a.scheduled_date || ""));
      const upcoming = fx
        .filter((f) => f.status === "scheduled" && f.scheduled_date)
        .sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || ""));
      return { lg, results, upcoming };
    })
    .filter((b) => b.results.length > 0 || b.upcoming.length > 0);

  if (form.length === 0 && blocks.length === 0) {
    return (
      <Section id="fixtures" title={vocab.scheduleTab + " & results"}>
        <Empty title="First fixture coming soon" sub="Fixtures and results will appear here automatically." />
      </Section>
    );
  }

  const showLeague = blocks.length > 1;

  return (
    <Section id="fixtures" title={vocab.scheduleTab + " & results"}>
      {form.length > 0 && (
        <div className="cp-form">
          {form.map((x, i) => (
            <span key={i} className={`cp-pill cp-pill--${x.result.toLowerCase()}`}>{x.result}</span>
          ))}
        </div>
      )}
      {blocks.map((b, bi) => (
        <div key={b.lg.league_id || bi} className="cp-league">
          {showLeague && (
            <div className="cp-league-head">
              <span className="cp-league-name">{(b.lg.name || "").toUpperCase()}</span>
              {b.lg.season_label && <span className="cp-league-season">{b.lg.season_label}</span>}
            </div>
          )}
          <div className="cp-fxlist">
            {b.upcoming.length > 0 && <div className="cp-fxlabel">UPCOMING</div>}
            {b.upcoming.map((f, i) => {
              const { dow, dm } = fmtDate(f.scheduled_date);
              return (
                <div key={"u" + i} className="cp-fxrow">
                  <div className="date"><div className="d">{dow || "—"}</div><div className="m">{dm}</div></div>
                  <div className="mid">
                    <div className="opp">{f.is_home ? "vs" : "at"} {f.opponent || "TBC"}</div>
                    <div className="sub">{f.is_home ? "Home" : "Away"}</div>
                  </div>
                  <span className="time">{f.kickoff_time || ""}</span>
                </div>
              );
            })}
            {b.results.length > 0 && <div className="cp-fxlabel">RESULTS</div>}
            {b.results.map((f, i) => {
              const r = resultOf(f);
              const ours = f.is_home ? f.home_score : f.away_score;
              const theirs = f.is_home ? f.away_score : f.home_score;
              const { dm } = fmtDate(f.scheduled_date);
              return (
                <div key={"r" + i} className="cp-fxrow">
                  <span className={`cp-pill cp-pill--${r.toLowerCase()}`}>{r}</span>
                  <div className="mid">
                    <div className="opp">{f.is_home ? "vs" : "at"} {f.opponent || "TBC"}</div>
                    <div className="sub">{dm}</div>
                  </div>
                  <span className="res">{ours}–{theirs}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Section>
  );
}

// ── teams (cohorts → teams → safeguarded rosters) ────────────────────────────
export function TeamsSection({ teams, vocab }) {
  const cohorts = (teams || []).filter((c) => (c.teams || []).length > 0);
  if (cohorts.length === 0) {
    return (
      <Section id="teams" title="Teams">
        <Empty title="Squads forming" sub="Teams will be listed here as the club registers them." />
      </Section>
    );
  }
  return (
    <Section id="teams" title="Teams">
      {cohorts.map((cohort) => (
        <div key={cohort.cohort_id}>
          <div className="cp-cohort-label">{(cohort.name || "").toUpperCase()}</div>
          {(cohort.teams || []).map((t) => {
            const members = t.members || [];
            return (
              <div key={t.team_id} className="cp-team-card">
                <div className="cp-team-name">{(t.name || "").toUpperCase()}</div>
                <div className="cp-team-sub">
                  {[cohort.category, t.gender, members.length ? `${members.length} ${vocab.participant.toLowerCase()}` : "forming"]
                    .filter(Boolean).join(" · ")}
                </div>
                {members.length > 0 ? (
                  <div className="cp-roster">
                    {members.slice(0, 12).map((m) => (
                      <div key={m.member_id} className="cp-member">
                        <span className="cp-avatar">{initials(m.name)}</span>
                        <span className="cp-member-name">{m.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="cp-roster-hidden"><ShieldCheck {...IC} size={14} /> Roster kept private</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </Section>
  );
}

// ── news ─────────────────────────────────────────────────────────────────────
export function NewsSection({ news }) {
  const list = news || [];
  const link = list.length > 1
    ? <span className="cp-section-link">All news <CaretRight {...IC} size={13} /></span> : null;
  return (
    <Section id="news" title="Latest" link={link}>
      {list.length === 0 ? (
        <Empty title="No posts yet" sub="Match reports & club news will appear here." />
      ) : (
        <>
          <article className="cp-news-lead">
            {list[0].hero_url
              ? <img className="cp-news-hero" src={list[0].hero_url} alt="" />
              : <div className="cp-news-hero cp-news-hero--ph" />}
            <div className="cp-news-body">
              <div className="cp-news-meta">{relativeAgo(list[0].published_at)}{list[0].author_name ? ` · ${list[0].author_name}` : ""}</div>
              <div className="cp-news-title">{(list[0].title || "").toUpperCase()}</div>
              <div className="cp-news-teaser">{teaser(list[0].body)}</div>
            </div>
          </article>
          {list.length > 1 && (
            <div className="cp-news-grid">
              {list.slice(1, 3).map((p) => (
                <div key={p.post_id} className="cp-news-mini">
                  <div className="k">{relativeAgo(p.published_at)}</div>
                  <div className="t">{p.title}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ── sponsors (tiered: headline hero + supporters grid; degrades to flat row) ──
export function SponsorsSection({ sponsors }) {
  const list = sponsors || [];
  if (list.length === 0) return null; // hide if none
  const tiered = list.some((s) => s.tier); // tier 🔧 arrives with P5 read-extension
  const headline = tiered ? list.filter((s) => s.tier === "headline") : [];
  const rest = tiered ? list.filter((s) => s.tier !== "headline") : list;

  const Logo = (s) => s.logo_url
    ? <img className="cp-sponsor-logo" src={s.logo_url} alt={s.name} />
    : <span className="cp-sponsor-logo">logo</span>;
  const Row = (s, hero) => {
    const inner = (
      <>
        {Logo(s)}
        <span className="cp-sponsor-name">{s.name}</span>
        <CaretRight {...IC} size={16} style={{ color: "var(--t2)" }} />
      </>
    );
    return s.website_url
      ? <a key={s.sponsor_id} className={hero ? "cp-sponsor-hero" : "cp-sponsor-row"} href={s.website_url} target="_blank" rel="noopener noreferrer">{inner}</a>
      : <div key={s.sponsor_id} className={hero ? "cp-sponsor-hero" : "cp-sponsor-row"}>{inner}</div>;
  };

  return (
    <Section id="sponsors" title="Backed by">
      {headline.length > 0 && (<>
        <div className="cp-sponsor-tier">HEADLINE</div>
        {headline.map((s) => Row(s, true))}
      </>)}
      {tiered && rest.length > 0 && <div className="cp-sponsor-tier">SUPPORTERS</div>}
      {tiered
        ? <div className="cp-sponsor-grid">{rest.map((s) => Row(s, false))}</div>
        : rest.map((s) => Row(s, false))}
    </Section>
  );
}

// ── tournaments (links into the existing /a/<slug> hub) ──────────────────────
export function TournamentsSection({ tournaments }) {
  const list = tournaments || [];
  if (list.length === 0) return null;
  return (
    <Section id="tournaments" title="Tournaments">
      {list.map((t) => (
        <a key={t.slug} className="cp-row" href={`/a/${t.slug}`}>
          <span className="ic"><Trophy {...IC} /></span>
          <div className="mid">
            <div className="ttl">{t.name}</div>
            <div className="sub">{[t.status, t.event_date ? fmtDate(t.event_date).dm : null].filter(Boolean).join(" · ")}</div>
          </div>
          <CaretRight {...IC} size={16} className="chev" />
        </a>
      ))}
    </Section>
  );
}

// ── stats (opt-in per team; positive-only; no minors named) — P5 data slice ──
export function StatsSection({ stats, vocab }) {
  if (!stats) return null; // arrives with P5 read-extension
  const teamSlices = Object.values(stats).filter(Boolean);
  const hasAny = teamSlices.some(
    (s) => (s.topScorer || s.potm || (s.reliability && s.reliability.length))
  );
  if (!hasAny) return null;
  const s = teamSlices.find((x) => x.topScorer || x.potm || (x.reliability && x.reliability.length)) || {};
  const reliable = s.reliability && s.reliability[0];
  return (
    <Section id="stats" title={vocab.participant}>
      {s.topScorer && (
        <div className="cp-stat-lead">
          <span className="cp-stat-photo">photo</span>
          <div style={{ flex: 1 }}>
            <div className="cp-stat-kicker"><SoccerBall {...IC} size={13} /> {vocab.metric.toUpperCase()}</div>
            <div className="cp-stat-name">{s.topScorer.name}</div>
          </div>
          <div className="cp-stat-big"><div className="n">{s.topScorer.goals}</div><div className="u">GOALS</div></div>
        </div>
      )}
      <div className="cp-stat-pair">
        {s.potm && (
          <div className="cp-stat-card gold">
            <div className="k"><Star {...IC} size={13} /> PLAYER OF MONTH</div>
            <div className="v">{s.potm.name}</div>
            {s.potm.month && <div className="m">{s.potm.month}</div>}
          </div>
        )}
        {reliable && (
          <div className="cp-stat-card green">
            <div className="k"><Lightning {...IC} size={13} /> MOST RELIABLE</div>
            <div className="v">{reliable.name}</div>
            <div className="m">{reliable.pct}% available</div>
          </div>
        )}
      </div>
      <div className="cp-safeguard" style={{ margin: "12px 0 0" }}>
        <ShieldCheck {...IC} size={15} className="ic" />
        <div className="txt">Senior squads only — under-18 players are never named on public boards.</div>
      </div>
    </Section>
  );
}

// ── contacts (committee + foregrounded Welfare/Safeguarding Officer) ─────────
export function ContactsSection({ contacts }) {
  if (!contacts) return null;
  const { contact_name, contact_email, welfareOfficer, committee } = contacts;
  if (!contact_name && !welfareOfficer && !(committee && committee.length)) return null;
  return (
    <Section id="contacts" title="Club contacts">
      {welfareOfficer && (
        <div className="cp-row cp-row--welfare">
          <span className="ic"><ShieldCheck {...IC} /></span>
          <div className="mid">
            <div className="ttl">{welfareOfficer.name}</div>
            <div className="sub">Welfare / Safeguarding Officer</div>
          </div>
          {welfareOfficer.email && <a className="chev" href={`mailto:${welfareOfficer.email}`}><EnvelopeSimple {...IC} size={16} /></a>}
        </div>
      )}
      {contact_name && (
        <div className="cp-row">
          <span className="ic"><EnvelopeSimple {...IC} /></span>
          <div className="mid"><div className="ttl">{contact_name}</div><div className="sub">Club secretary</div></div>
          {contact_email && <a className="chev" href={`mailto:${contact_email}`}><CaretRight {...IC} size={16} /></a>}
        </div>
      )}
      {(committee || []).map((c, i) => (
        <div key={i} className="cp-row">
          <span className="ic"><UsersThree {...IC} /></span>
          <div className="mid"><div className="ttl">{c.name}</div><div className="sub">{c.role}</div></div>
          {c.email && <a className="chev" href={`mailto:${c.email}`}><EnvelopeSimple {...IC} size={16} /></a>}
        </div>
      ))}
    </Section>
  );
}

// ── documents (policies / forms / PDFs) ──────────────────────────────────────
export function DocumentsSection({ documents }) {
  if (!documents || documents.length === 0) return null;
  return (
    <Section id="documents" title="Documents">
      {documents.map((d, i) => (
        <a key={i} className="cp-row" href={d.url} target="_blank" rel="noopener noreferrer">
          <span className="ic"><FileText {...IC} /></span>
          <div className="mid"><div className="ttl">{d.title}</div><div className="sub">{[d.type, d.size].filter(Boolean).join(" · ")}</div></div>
          <CaretRight {...IC} size={16} className="chev" />
        </a>
      ))}
    </Section>
  );
}

// ── events (social "what's on" — not a calendar) ─────────────────────────────
export function EventsSection({ events }) {
  if (!events || events.length === 0) return null;
  return (
    <Section id="events" title="What's on">
      {events.map((e, i) => (
        <div key={i} className="cp-row">
          <span className="ic"><Medal {...IC} /></span>
          <div className="mid"><div className="ttl">{e.title}</div><div className="sub">{[e.date ? fmtDate(e.date).dm : null, e.blurb].filter(Boolean).join(" · ")}</div></div>
        </div>
      ))}
    </Section>
  );
}

// ── about ────────────────────────────────────────────────────────────────────
const SOCIAL_ICONS = {
  facebook: FacebookLogo, instagram: InstagramLogo, x: XLogo,
  youtube: YoutubeLogo, tiktok: TiktokLogo, website: Globe,
};
export function AboutSection({ club, branding }) {
  const about = branding?.about;
  const socials = branding?.socials || {};
  const socialKeys = Object.keys(SOCIAL_ICONS).filter((k) => socials[k]);
  if (!about && socialKeys.length === 0) return null;
  const meta = [
    club?.founded_year ? `Founded ${club.founded_year}` : null,
    club?.discipline ? club.discipline.replace(/_/g, " ") : null,
  ].filter(Boolean).join(" · ");
  return (
    <Section id="about" title="About">
      {meta && <div className="cp-about-meta">{meta}</div>}
      {about && <div className="cp-about-body">{about}</div>}
      {socialKeys.length > 0 && (
        <div className="cp-socials">
          {socialKeys.map((k) => {
            const Ico = SOCIAL_ICONS[k];
            return <a key={k} className="cp-social" href={socials[k]} target="_blank" rel="noopener noreferrer" aria-label={k}><Ico {...IC} size={20} /></a>;
          })}
        </div>
      )}
    </Section>
  );
}

// ── get-involved / Join CTA (always shown — the spine of a thin club) ────────
export function GetInvolvedSection({ getInvolved, joinHref, joinLabel, joinSub }) {
  const links = getInvolved || [];
  return (
    <>
      <section className="cp-section" id="get-involved">
        <a className="cp-cta" href={joinHref || "#"}>
          <div>
            <div className="cp-cta-title">{joinLabel.toUpperCase()}</div>
            <div className="cp-cta-sub">{joinSub}</div>
            <span className="cp-cta-act">Get started →</span>
          </div>
          <span className="cp-cta-qr"><QrCode size={40} weight="thin" /></span>
        </a>
      </section>
      {links.length > 0 && (
        <section className="cp-section">
          {links.map((l, i) => (
            <a key={i} className="cp-row" href={l.url} target="_blank" rel="noopener noreferrer">
              <span className="ic"><Heart {...IC} /></span>
              <div className="mid"><div className="ttl">{l.label}</div></div>
              <ArrowRight {...IC} size={16} className="chev" />
            </a>
          ))}
        </section>
      )}
    </>
  );
}

// ── safeguarding footer note + footer ────────────────────────────────────────
export function SafeguardNote({ hidden }) {
  return (
    <div className="cp-safeguard">
      <ShieldCheck {...IC} size={16} className="ic" />
      <div className="txt">
        {hidden
          ? "Youth squads are safeguarded — rosters and photos are hidden across this page."
          : "Under-18s are shown by first name and initial only — never full names or photos."}
      </div>
    </div>
  );
}

export function Footer({ club }) {
  return (
    <footer className="cp-footer">
      <div className="cp-footer-name">{(club?.name || "").toUpperCase()}</div>
      <div className="cp-footer-by">Powered by In or Out</div>
    </footer>
  );
}

// ── full-page states ─────────────────────────────────────────────────────────
export function ClubLoading() {
  return <div className="club-public"><div className="cp-state"><div className="cp-state-sub">Loading…</div></div></div>;
}
export function ClubNotFound() {
  return (
    <div className="club-public">
      <div className="cp-state">
        <div className="cp-state-title">Club page unavailable</div>
        <div className="cp-state-sub">This club hasn’t published a page yet, or the link is wrong.</div>
      </div>
    </div>
  );
}
