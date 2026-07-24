// clubPublicSections — presentational blocks for the public club page (Epic B P4).
// Pure components built to the get_club_public payload. Every block has a designed
// empty/degrade state; the thin/empty club is the primary target. Theming comes
// from CSS vars on the .club-public container (clubPublic.css); type stays Bebas/
// DM Sans, icons are Phosphor thin. Conditional P5 slices (stats/contacts/documents/
// events/getInvolved/sponsor tier) read optional payload keys and render empty/absent
// until the P5 read-extension (mig 448) populates them — zero rework needed then.
//
// Redesign (kit-system, session 2026-07-24): the page is a primary scroll SPINE
// (TopBar → Hero → Fixtures → Teams → Stats → Sponsors → Join → Safeguard → Footer)
// plus a full-screen "Clubhouse" menu overlay that houses the six info sections
// (Latest/News · Tournaments · What's On/Events · Documents · Contacts · About).
// The exported component names + props are unchanged (drops into the live app); only
// their markup + composition were rebuilt to the design. The six menu components now
// render BODY-ONLY (no section shell — the menu owns the detail title) and show an
// invitation "note" instead of null when empty, because the Clubhouse always lists them.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, ArrowLeft, CaretRight, CaretDown, MapPin, ArrowSquareOut,
  SquaresFour, X, SoccerBall, Star, Lightning, ShieldCheck, Heart, Globe,
  FileText, QrCode, DownloadSimple, AddressBook, IdentificationBadge,
  EnvelopeSimple, UsersThree, Trophy, Confetti, Newspaper,
  FacebookLogo, InstagramLogo, XLogo, YoutubeLogo, TiktokLogo,
} from "@phosphor-icons/react";
import {
  allFixtures, formGuide, resultOf, fmtDate, relativeAgo,
  initials, teaser, crestText,
} from "./clubPublicHelpers.js";

const IC = { size: 18, weight: "thin" };

// ── scroll-reveal wrapper ────────────────────────────────────────────────────
// CSS scroll-driven timelines aren't supported in the iOS WKWebView the native app
// ships in, so reveal is driven by an IntersectionObserver: the resting state is the
// VISIBLE state (reduced-motion / no-observer envs show immediately), and sections
// fade/rise in on entry. Base hidden state only ever applies for a frame before the
// observer fires. Reduced motion is honoured here AND in CSS (see clubPublic.css).
function Reveal({ className = "", children, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const reduce = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") { setShown(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const cls = `cp-reveal${shown ? " cp-in" : ""}${className ? " " + className : ""}`;
  return <section ref={ref} className={cls} {...rest}>{children}</section>;
}

// ── crest (image or initials placeholder) ───────────────────────────────────
function Crest({ club, branding, className }) {
  if (branding?.crest_url) {
    return <span className={className}><img className="cp-crest-img" src={branding.crest_url} alt="" /></span>;
  }
  return <span className={className}>{crestText(club)}</span>;
}

// ── top bar ──────────────────────────────────────────────────────────────────
// onMenu (optional) opens the Clubhouse overlay; when present the SquaresFour menu
// button renders alongside the Join pill. Absent ⇒ button hidden (back-compatible).
export function TopBar({ club, branding, joinHref, joinLabel, onMenu }) {
  return (
    <header className="cp-topbar">
      <div className="cp-brand">
        <Crest club={club} branding={branding} className="cp-crest" />
        <span className="cp-clubname">{club?.name}</span>
      </div>
      <div className="cp-topbar-actions">
        {onMenu && (
          <button type="button" className="cp-menu-btn" onClick={onMenu} aria-label="Open club menu">
            <SquaresFour {...IC} size={20} />
          </button>
        )}
        {joinHref && <a className="cp-join-pill" href={joinHref}>{joinLabel}</a>}
      </div>
    </header>
  );
}

// ── hero (pre / post / idle / empty) ─────────────────────────────────────────
// Shared kit-system panel layers: vertical kit stripes + animated radial glow +
// bottom scrim. onReadReport (optional) opens the Latest menu view from the post state.
function HeroPanelLayers({ won }) {
  return (
    <>
      <div className="cp-hero-stripes" />
      <div className={`cp-hero-glow${won ? " cp-hero-glow--won" : ""}`} />
      <div className="cp-hero-scrim" />
    </>
  );
}

function mapHrefFor(f, club) {
  const q = f?.venue || (f?.is_home ? club?.name : f?.opponent) || club?.name;
  return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : null;
}

export function Hero({ club, branding, hero, vocab, joinHref, joinLabel, hasNews, onReadReport }) {
  const tagline = branding?.tagline;
  const founded = club?.founded_year ? `Community since ${club.founded_year}` : tagline;

  // d) empty (zero-config — the primary first impression)
  if (hero.kind === "empty") {
    return (
      <section className="cp-hero">
        <div className="cp-hero-panel cp-hero-panel--center cp-hero-panel--empty">
          <HeroPanelLayers />
          <div className="cp-hero-body">
            <Crest club={club} branding={branding} className="cp-hero-crest cp-hero-crest--lg" />
            <div className="cp-hero-name">{club?.name}</div>
            <div className="cp-invite cp-invite--hero">
              <div className="cp-invite-title">Be first to join</div>
              <div className="cp-invite-sub">Fixtures &amp; squads appear here automatically as the club gets going.</div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // c) idle (history, nothing upcoming)
  if (hero.kind === "idle") {
    return (
      <section className="cp-hero">
        <div className="cp-hero-panel cp-hero-panel--center cp-hero-panel--idle">
          <HeroPanelLayers />
          <div className="cp-hero-body">
            <Crest club={club} branding={branding} className="cp-hero-crest cp-hero-crest--lg" />
            <div className="cp-hero-name">{club?.name}</div>
            {founded && <div className="cp-hero-tagline">{founded}</div>}
            {joinHref && <a className="cp-hero-cta" href={joinHref}>{joinLabel} →</a>}
          </div>
        </div>
      </section>
    );
  }

  // b) post (result in last 3 days)
  if (hero.kind === "post") {
    const f = hero.result;
    const r = resultOf(f);
    const ours = f.is_home ? f.home_score : f.away_score;
    const theirs = f.is_home ? f.away_score : f.home_score;
    const word = r === "W" ? "WON" : r === "L" ? "LOST" : "DREW";
    const wclass = r === "W" ? "w" : r === "L" ? "l" : "d";
    return (
      <section className="cp-hero">
        <div className="cp-hero-panel cp-hero-panel--result">
          {branding?.hero_url && <img className="cp-hero-photo" src={branding.hero_url} alt="" />}
          <HeroPanelLayers won />
          <div className="cp-hero-body">
            <span className={`cp-ft-pill cp-ft-pill--${wclass}`}>FULL TIME · {word}</span>
            <div className="cp-hero-score">{ours}–{theirs}</div>
            <div className="cp-hero-resultline">
              {(f.our_team || club?.short_name || "Us").toUpperCase()} {ours}–{theirs} {(f.opponent || "").toUpperCase()}
            </div>
          </div>
        </div>
        <div className="cp-ticket cp-ticket--result">
          <div className="cp-ticket-resmeta">
            <div className="cp-ticket-kicker">RESULT · {(f.league_name || "MATCH").toUpperCase()}</div>
            <div className="cp-ticket-matchup">
              {f.is_home ? "vs" : "at"} {f.opponent || "TBC"} · {fmtDate(f.scheduled_date).dm}
            </div>
          </div>
          {hasNews && onReadReport && (
            <button type="button" className="cp-read-report" onClick={onReadReport}>
              Read report <ArrowRight {...IC} size={14} />
            </button>
          )}
        </div>
      </section>
    );
  }

  // a) pre (next fixture — default for grassroots)
  const f = hero.fixture;
  const { dm } = fmtDate(f.scheduled_date);
  const days = (() => {
    const d = new Date(f.scheduled_date + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const n = Math.round((d.getTime() - today.getTime()) / 86400000);
    return n <= 0 ? "TODAY" : n === 1 ? "TOMORROW" : `IN ${n} DAYS`;
  })();
  const ourName = f.our_team || club?.short_name || club?.name || "Us";
  const oppName = f.opponent || "TBC";
  const mapHref = mapHrefFor(f, club);
  const venueLabel = f.venue || (f.is_home ? "Home" : `Away · ${oppName}`);
  const venueInner = (
    <>
      <MapPin {...IC} size={14} className="cp-venue-pin" />
      <span className="cp-venue-name">{venueLabel}</span>
      {f.kickoff_time && <span className="cp-venue-time">· {f.kickoff_time}</span>}
      {mapHref && <ArrowSquareOut {...IC} size={12} className="cp-venue-out" />}
    </>
  );
  return (
    <section className="cp-hero">
      <div className="cp-hero-panel">
        {branding?.hero_url && <img className="cp-hero-photo" src={branding.hero_url} alt="" />}
        <HeroPanelLayers />
        <div className="cp-hero-body">
          <Crest club={club} branding={branding} className="cp-hero-crest" />
          <div className="cp-hero-name">{club?.name}</div>
          {tagline && <div className="cp-hero-tagline">{tagline}</div>}
        </div>
      </div>
      <div className="cp-ticket">
        <div className="cp-ticket-head">
          <span className="cp-ticket-label">{vocab.nextLabel.toUpperCase()}</span>
          {days && <span className="cp-ticket-count">{days}</span>}
        </div>
        <div className="cp-matchup">
          <div className="cp-matchup-side">
            <div className="cp-matchup-badge cp-matchup-badge--us">{crestText(club)}</div>
            <div className="cp-matchup-name">{ourName}</div>
          </div>
          <div className="cp-matchup-vs">VS</div>
          <div className="cp-matchup-side">
            <div className="cp-matchup-badge cp-matchup-badge--opp">{initials(oppName)}</div>
            <div className="cp-matchup-name">{oppName}</div>
          </div>
        </div>
        {mapHref
          ? <a className="cp-venue" href={mapHref} target="_blank" rel="noopener noreferrer">{venueInner}</a>
          : <div className="cp-venue cp-venue--static">{venueInner}{!f.kickoff_time && dm ? <span className="cp-venue-time">· {dm}</span> : null}</div>}
      </div>
    </section>
  );
}

// ── generic spine section shell (accent tab + Bebas title, scroll-reveal) ─────
function Section({ id, title, link, children }) {
  return (
    <Reveal className="cp-section" id={id}>
      <div className="cp-section-head">
        <div className="cp-section-titlewrap">
          <span className="cp-tab" />
          <span className="cp-section-title">{title}</span>
        </div>
        {link}
      </div>
      {children}
    </Reveal>
  );
}

// spine "invitation" (solid) empty card — fixtures/teams never leave a hole
function Empty({ title, sub }) {
  return (
    <div className="cp-invite">
      <div className="cp-invite-title">{title}</div>
      {sub && <div className="cp-invite-sub">{sub}</div>}
    </div>
  );
}

// menu "note" card — the six info sections show this instead of null when empty
function MenuNote({ children }) {
  return <div className="cp-note">{children}</div>;
}

// ── fixtures + form ──────────────────────────────────────────────────────────
// Club-wide form guide (letter + score + date) then the FULL per-league fixtures +
// results list. UPCOMING (soonest first) + RESULTS (newest first, W/D/L). League
// header suppressed for a single-league club. The globally-soonest upcoming fixture
// gets the accent "next" treatment (wash bg + accent strip). Source-agnostic.
function FormGuide({ form }) {
  return (
    <div className="cp-form">
      {form.map((x, i) => {
        const f = x.fixture;
        const ours = f.is_home ? f.home_score : f.away_score;
        const theirs = f.is_home ? f.away_score : f.home_score;
        const lc = x.result.toLowerCase();
        const delay = `${(0.12 + i * 0.08).toFixed(2)}s`;
        return (
          <div key={i} className="cp-fcol">
            <div className={`cp-fcol-cell cp-fcol--${lc}`} style={{ animationDelay: delay }}>{x.result}</div>
            <div className="cp-fcol-score">{ours}–{theirs}</div>
            <div className="cp-fcol-date">{fmtDate(f.scheduled_date).dm}</div>
          </div>
        );
      })}
    </div>
  );
}

export function FixturesSection({ leagues, vocab }) {
  const form = formGuide(allFixtures(leagues));

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const blocks = (leagues || [])
    .map((lg) => {
      const fx = lg.fixtures || [];
      const results = fx
        .filter((f) => resultOf(f))
        .sort((a, b) => (b.scheduled_date || "").localeCompare(a.scheduled_date || ""));
      const upcoming = fx
        .filter((f) => f.status === "scheduled" && f.scheduled_date && f.scheduled_date >= todayStr)
        .sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || ""));
      return { lg, results, upcoming };
    })
    .filter((b) => b.results.length > 0 || b.upcoming.length > 0);

  const title = `${vocab.scheduleTab} & Results`;

  if (form.length === 0 && blocks.length === 0) {
    return (
      <Section id="fixtures" title={title}>
        <Empty title="First fixture coming soon" sub="Fixtures and results appear here automatically." />
      </Section>
    );
  }

  const showLeague = blocks.length > 1;
  const allUp = blocks.flatMap((b) => b.upcoming);
  const soonest = allUp.length
    ? allUp.reduce((a, b) =>
      ((a.scheduled_date || "") + (a.kickoff_time || "")) <= ((b.scheduled_date || "") + (b.kickoff_time || "")) ? a : b)
    : null;

  return (
    <Section id="fixtures" title={title}>
      {form.length > 0 && <FormGuide form={form} />}
      {blocks.map((b, bi) => (
        <div key={b.lg.league_id || bi} className="cp-league">
          {showLeague && (
            <div className="cp-league-head">
              <span className="cp-league-name">{(b.lg.name || "").toUpperCase()}</span>
              {b.lg.season_label && <span className="cp-league-season">{b.lg.season_label}</span>}
            </div>
          )}
          {b.upcoming.length > 0 && <div className="cp-fxlabel">UPCOMING</div>}
          {b.upcoming.length > 0 && (
            <div className="cp-fxlist">
              {b.upcoming.map((f, i) => {
                const { dow, dm } = fmtDate(f.scheduled_date);
                const hot = f === soonest;
                return (
                  <div key={"u" + i} className={`cp-fxrow${hot ? " cp-fxrow--hot" : ""}`}>
                    <span className="cp-fxstrip" />
                    <div className="cp-fxrow-date">
                      <div className="d">{dow || "—"}</div>
                      <div className="m">{dm}</div>
                    </div>
                    <div className="cp-fxrow-mid">
                      <div className="opp">{f.is_home ? "vs" : "at"} {f.opponent || "TBC"}</div>
                      <div className="sub">{[f.is_home ? "Home" : "Away", b.lg.name].filter(Boolean).join(" · ")}</div>
                    </div>
                    {f.kickoff_time && <span className="cp-fxrow-time">{f.kickoff_time}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {b.results.length > 0 && <div className="cp-fxlabel cp-fxlabel--gap">RESULTS</div>}
          {b.results.length > 0 && (
            <div className="cp-fxlist">
              {b.results.map((f, i) => {
                const r = resultOf(f);
                const lc = r.toLowerCase();
                const ours = f.is_home ? f.home_score : f.away_score;
                const theirs = f.is_home ? f.away_score : f.home_score;
                const { dm } = fmtDate(f.scheduled_date);
                return (
                  <div key={"r" + i} className="cp-fxrow cp-fxrow--result">
                    <span className={`cp-fxstrip cp-strip--${lc}`} />
                    <div className="cp-fxrow-mid">
                      <div className="opp">{f.is_home ? "vs" : "at"} {f.opponent || "TBC"}</div>
                      <div className="sub">{dm}</div>
                    </div>
                    <span className={`cp-fxrow-res cp-res--${lc}`}>{ours}–{theirs}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

// ── teams (cohorts → teams → safeguarded rosters) — collapsible cards ────────
function TeamCard({ cohort, team, vocab, open, onToggle }) {
  const members = team.members || [];
  const rightLabel = (cohort.name || cohort.category || "").toUpperCase();
  const sub = [cohort.category, team.gender, members.length ? `${members.length} ${vocab.participant.toLowerCase()}` : "forming"]
    .filter(Boolean).join(" · ");
  return (
    <div className="cp-team-card">
      <button type="button" className="cp-team-head" onClick={onToggle} aria-expanded={open}>
        <span className="cp-team-name">{(team.name || "").toUpperCase()}</span>
        {rightLabel && <span className="cp-team-cohort">{rightLabel}</span>}
        <CaretDown {...IC} size={16} className={`cp-team-chev${open ? " cp-team-chev--open" : ""}`} />
      </button>
      {open && (
        <div className="cp-team-body">
          <div className="cp-team-sub">{sub}</div>
          {members.length > 0 ? (
            <div className="cp-roster">
              {members.slice(0, 12).map((m) => (
                <span key={m.member_id} className="cp-member">
                  <span className="cp-avatar">{initials(m.name)}</span>
                  <span className="cp-member-name">{m.name}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="cp-roster-hidden"><ShieldCheck {...IC} size={14} /> Roster kept private</div>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamsSection({ teams, vocab }) {
  const cohorts = (teams || []).filter((c) => (c.teams || []).length > 0);
  // Flatten (cohort, team) pairs; first team open by default.
  const cards = [];
  cohorts.forEach((cohort) => (cohort.teams || []).forEach((team) => cards.push({ cohort, team })));
  const firstKey = cards[0]?.team?.team_id ?? null;
  const [openMap, setOpenMap] = useState(() => (firstKey != null ? { [firstKey]: true } : {}));
  const toggle = (key) => setOpenMap((m) => ({ ...m, [key]: !m[key] }));

  if (cards.length === 0) {
    return (
      <Section id="teams" title="Teams">
        <Empty title="Squads forming" sub="Teams are listed here as the club registers them." />
      </Section>
    );
  }
  return (
    <Section id="teams" title="Teams">
      {cards.map(({ cohort, team }) => {
        const key = team.team_id;
        return (
          <TeamCard key={key} cohort={cohort} team={team} vocab={vocab}
            open={!!openMap[key]} onToggle={() => toggle(key)} />
        );
      })}
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
        <div className="cp-trophy">
          <div className="cp-trophy-dots" />
          <div className="cp-trophy-body">
            <SoccerBall size={34} weight="thin" className="cp-trophy-ico" />
            <div className="cp-trophy-kicker">{vocab.metric.toUpperCase()}</div>
            <div className="cp-trophy-name">{s.topScorer.name}</div>
            <div className="cp-trophy-num">
              <span className="n">{s.topScorer.goals}</span>
              <span className="u">GOALS</span>
            </div>
          </div>
        </div>
      )}
      <div className="cp-stat-pair">
        {s.potm && (
          <div className="cp-stat-card cp-stat-card--gold">
            <Star size={20} weight="thin" className="cp-stat-ico" />
            <div className="k">PLAYER OF MONTH</div>
            <div className="v">{s.potm.name}</div>
            {s.potm.month && <div className="m">{s.potm.month}</div>}
          </div>
        )}
        {reliable && (
          <div className="cp-stat-card cp-stat-card--green">
            <Lightning size={20} weight="thin" className="cp-stat-ico" />
            <div className="k">MOST RELIABLE</div>
            <div className="v">{reliable.name}</div>
            <div className="m">{reliable.pct}% available</div>
          </div>
        )}
      </div>
      <div className="cp-safeguard">
        <ShieldCheck {...IC} size={15} className="ic" />
        <div className="txt">Senior squads only — under-18 players are never named on public boards.</div>
      </div>
    </Section>
  );
}

// ── sponsors (tiered: headline hero + supporters grid; degrades to flat grid) ─
export function SponsorsSection({ sponsors }) {
  const list = sponsors || [];
  if (list.length === 0) return null; // hide if none
  const tiered = list.some((s) => s.tier); // tier 🔧 arrives with P5 read-extension
  const headline = tiered ? list.filter((s) => s.tier === "headline") : [];
  const rest = tiered ? list.filter((s) => s.tier !== "headline") : list;

  const Logo = (s, cls) => (s.logo_url
    ? <img className={cls} src={s.logo_url} alt={s.name} />
    : <span className={cls}>LOGO</span>);

  return (
    <Section id="sponsors" title="Backed by">
      {headline.length > 0 && <>
        <div className="cp-sponsor-tier">HEADLINE</div>
        {headline.map((s) => {
          const inner = (<>{Logo(s, "cp-sponsor-logo")}<span className="cp-sponsor-name">{s.name}</span><CaretRight {...IC} size={16} className="chev" /></>);
          return s.website_url
            ? <a key={s.sponsor_id} className="cp-sponsor-hero" href={s.website_url} target="_blank" rel="noopener noreferrer">{inner}</a>
            : <div key={s.sponsor_id} className="cp-sponsor-hero">{inner}</div>;
        })}
      </>}
      {headline.length > 0 && rest.length > 0 && <div className="cp-sponsor-tier cp-sponsor-tier--sub">SUPPORTERS</div>}
      {rest.length > 0 && (
        <div className="cp-sponsor-grid">
          {rest.map((s) => {
            const inner = (<>{Logo(s, "cp-sponsor-tile-logo")}<span className="cp-sponsor-tile-name">{s.name}</span></>);
            return s.website_url
              ? <a key={s.sponsor_id} className="cp-sponsor-tile" href={s.website_url} target="_blank" rel="noopener noreferrer">{inner}</a>
              : <div key={s.sponsor_id} className="cp-sponsor-tile">{inner}</div>;
          })}
        </div>
      )}
    </Section>
  );
}

// ── get-involved / Join CTA (always shown — the spine of a thin club) ────────
export function GetInvolvedSection({ getInvolved, joinHref, joinLabel, joinSub }) {
  const links = getInvolved || [];
  // No dead self-anchor: render the CTA only when there's a real destination; keep the
  // #get-involved anchor on the links block when the CTA is hidden. Nothing at all → null.
  if (!joinHref && links.length === 0) return null;
  return (
    <Reveal className="cp-section" id="get-involved">
      {joinHref && (
        <a className="cp-cta" href={joinHref}>
          <div className="cp-cta-dots" />
          <div className="cp-cta-copy">
            <div className="cp-cta-title">{joinLabel.toUpperCase()}</div>
            <div className="cp-cta-sub">{joinSub}</div>
            <span className="cp-cta-act">Get started →</span>
          </div>
          <span className="cp-cta-qr"><QrCode size={42} weight="thin" /></span>
        </a>
      )}
      {links.length > 0 && (
        <div className="cp-links">
          {links.map((l, i) => (
            <a key={i} className="cp-row" href={l.url} target="_blank" rel="noopener noreferrer">
              <span className="cp-row-ic"><Heart {...IC} /></span>
              <div className="cp-row-mid"><div className="ttl">{l.label}</div></div>
              <ArrowRight {...IC} size={16} className="cp-row-chev" />
            </a>
          ))}
        </div>
      )}
    </Reveal>
  );
}

// ── safeguarding note (spine, accent-washed) + footer ────────────────────────
export function SafeguardNote({ hidden }) {
  return (
    <div className="cp-safeguard cp-safeguard--accent">
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

// ═══════════ CLUBHOUSE MENU CONTENT (body-only; note instead of null) ═════════

// ── news / Latest ─────────────────────────────────────────────────────────────
export function NewsSection({ news }) {
  const list = news || [];
  if (list.length === 0) return <MenuNote>No posts yet — match reports &amp; club news will appear here.</MenuNote>;
  const lead = list[0];
  return (
    <>
      <article className="cp-news-lead">
        <div className="cp-news-hero">
          {lead.hero_url
            ? <img className="cp-news-hero-img" src={lead.hero_url} alt="" />
            : <><div className="cp-news-hero-ph" /><span className="cp-news-photo-label">MATCH PHOTO</span></>}
          <span className="cp-news-tag">MATCH REPORT</span>
        </div>
        <div className="cp-news-body">
          <div className="cp-news-meta">{relativeAgo(lead.published_at)}{lead.author_name ? ` · ${lead.author_name}` : ""}</div>
          <div className="cp-news-title">{(lead.title || "").toUpperCase()}</div>
          <div className="cp-news-teaser">{teaser(lead.body)}</div>
        </div>
      </article>
      {list.slice(1, 3).map((p) => (
        <div key={p.post_id} className="cp-news-mini">
          <div className="k">{relativeAgo(p.published_at)}</div>
          <div className="t">{p.title}</div>
        </div>
      ))}
    </>
  );
}

// ── tournaments (links into the existing /a/<slug> hub) ──────────────────────
export function TournamentsSection({ tournaments }) {
  const list = tournaments || [];
  if (list.length === 0) return <MenuNote>No tournaments right now — cup runs and sevens show up here.</MenuNote>;
  return (
    <>
      {list.map((t) => (
        <a key={t.slug} className="cp-menu-row cp-menu-row--accent" href={`/a/${t.slug}`}>
          <span className="cp-menu-tile"><Trophy {...IC} size={20} /></span>
          <div className="cp-menu-rowmid">
            <div className="ttl">{t.name}</div>
            <div className="sub">{[t.status, t.event_date ? fmtDate(t.event_date).dm : null].filter(Boolean).join(" · ")}</div>
          </div>
          <CaretRight {...IC} size={16} className="chev" />
        </a>
      ))}
    </>
  );
}

// ── events (social "what's on" — not a calendar) ─────────────────────────────
export function EventsSection({ events }) {
  const list = events || [];
  if (list.length === 0) return <MenuNote>Nothing on the calendar yet — socials and events land here.</MenuNote>;
  return (
    <>
      {list.map((e, i) => (
        <div key={i} className="cp-menu-row">
          <span className="cp-menu-tile"><Confetti {...IC} size={20} /></span>
          <div className="cp-menu-rowmid">
            <div className="ttl">{e.title}</div>
            <div className="sub">{[e.date ? fmtDate(e.date).dm : null, e.blurb].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      ))}
    </>
  );
}

// ── documents (policies / forms / PDFs) ──────────────────────────────────────
export function DocumentsSection({ documents }) {
  const list = documents || [];
  if (list.length === 0) return <MenuNote>No documents shared yet — policies and forms appear here.</MenuNote>;
  return (
    <>
      {list.map((d, i) => (
        <a key={i} className="cp-menu-row" href={d.url} target="_blank" rel="noopener noreferrer">
          <span className="cp-menu-tile"><FileText {...IC} size={20} /></span>
          <div className="cp-menu-rowmid">
            <div className="ttl">{d.title}</div>
            <div className="sub">{[d.type, d.size].filter(Boolean).join(" · ")}</div>
          </div>
          <DownloadSimple {...IC} size={17} className="chev" />
        </a>
      ))}
    </>
  );
}

// ── contacts (committee + foregrounded Welfare/Safeguarding Officer) ─────────
function ContactMail({ email, children }) {
  return email
    ? <a className="cp-menu-mail" href={`mailto:${email}`}>{children}</a>
    : <span className="cp-menu-mail">{children}</span>;
}
export function ContactsSection({ contacts }) {
  if (!contacts) return <MenuNote>Club contacts will be listed here soon.</MenuNote>;
  const { contact_name, contact_email, welfareOfficer, committee } = contacts;
  if (!contact_name && !welfareOfficer && !(committee && committee.length)) {
    return <MenuNote>Club contacts will be listed here soon.</MenuNote>;
  }
  return (
    <>
      {welfareOfficer && (
        <div className="cp-menu-row cp-menu-row--accent">
          <span className="cp-menu-tile"><ShieldCheck {...IC} size={20} /></span>
          <div className="cp-menu-rowmid">
            <div className="ttl">{welfareOfficer.name}</div>
            <div className="sub">Welfare / Safeguarding Officer</div>
          </div>
          <ContactMail email={welfareOfficer.email}><EnvelopeSimple {...IC} size={17} /></ContactMail>
        </div>
      )}
      {contact_name && (
        <div className="cp-menu-row">
          <span className="cp-menu-tile"><EnvelopeSimple {...IC} size={20} /></span>
          <div className="cp-menu-rowmid">
            <div className="ttl">{contact_name}</div>
            <div className="sub">Club secretary</div>
          </div>
          <ContactMail email={contact_email}><CaretRight {...IC} size={16} /></ContactMail>
        </div>
      )}
      {(committee || []).map((c, i) => (
        <div key={i} className="cp-menu-row">
          <span className="cp-menu-tile"><UsersThree {...IC} size={20} /></span>
          <div className="cp-menu-rowmid">
            <div className="ttl">{c.name}</div>
            <div className="sub">{c.role}</div>
          </div>
          <ContactMail email={c.email}><EnvelopeSimple {...IC} size={17} /></ContactMail>
        </div>
      ))}
    </>
  );
}

// ── about ────────────────────────────────────────────────────────────────────
const SOCIAL_ICONS = {
  website: Globe, facebook: FacebookLogo, instagram: InstagramLogo, x: XLogo,
  youtube: YoutubeLogo, tiktok: TiktokLogo,
};
export function AboutSection({ club, branding }) {
  const about = branding?.about;
  const socials = branding?.socials || {};
  const socialKeys = Object.keys(SOCIAL_ICONS).filter((k) => socials[k]);
  if (!about && socialKeys.length === 0) return <MenuNote>This club hasn’t added an about section yet.</MenuNote>;
  const meta = [
    club?.founded_year ? `Founded ${club.founded_year}` : null,
    club?.discipline ? club.discipline.replace(/_/g, " ") : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="cp-about">
      {meta && <div className="cp-about-meta">{meta}</div>}
      {about && <div className="cp-about-body">{about}</div>}
      {socialKeys.length > 0 && (
        <div className="cp-socials">
          {socialKeys.map((k) => {
            const Ico = SOCIAL_ICONS[k];
            return (
              <a key={k} className="cp-social" href={socials[k]} target="_blank" rel="noopener noreferrer" aria-label={k}>
                <Ico {...IC} size={22} />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════ CLUBHOUSE OVERLAY + DOCK (menu chrome) ═══════════════════════════

// Fixed spec of the six info sections that live in the Clubhouse. `key` matches the
// section key from the payload's section order (so a club that disables one drops it
// from the menu); `view` is the menu-state id. Titles/labels/icons are design-fixed.
const MENU_SPEC = [
  { key: "news", view: "news", label: "Latest", desc: "Match reports & club news", Icon: Newspaper },
  { key: "tournaments", view: "tournaments", label: "Tournaments", desc: "Cup runs & sevens", Icon: Trophy },
  { key: "events", view: "events", label: "What's on", desc: "Socials & club events", Icon: Confetti },
  { key: "documents", view: "documents", label: "Documents", desc: "Policies & forms", Icon: FileText },
  { key: "contacts", view: "contacts", label: "Contacts", desc: "Committee & welfare", Icon: AddressBook },
  { key: "about", view: "about", label: "About", desc: "Our story & socials", Icon: IdentificationBadge },
];

// Floating glass dock — the always-reachable Clubhouse trigger.
export function ClubhouseDock({ onOpen }) {
  return (
    <button type="button" className="cp-dock" onClick={onOpen}>
      <span className="cp-dock-label">CLUBHOUSE</span>
      <span className="cp-dock-ico"><SquaresFour {...IC} size={19} /></span>
    </button>
  );
}

// Full-screen takeover: index (EXPLORE THE CLUB) ↔ detail. `detail` maps a view id to
// the rendered section body; `allowedKeys` filters/orders the index rows.
export function ClubhouseMenu({ open, view, club, branding, allowedKeys, detail, onClose, onBack, onSelect }) {
  if (!open) return null;
  const allowed = allowedKeys && allowedKeys.length
    ? MENU_SPEC.filter((s) => allowedKeys.includes(s.key))
    : MENU_SPEC;
  const items = allowed.map((s, i) => ({ ...s, num: String(i + 1).padStart(2, "0") }));
  const isIndex = view === "index";
  const current = MENU_SPEC.find((s) => s.view === view);

  return (
    <div className="cp-menu" role="dialog" aria-modal="true" aria-label="Clubhouse">
      <div className="cp-menu-stripes" />
      <div className="cp-menu-glow" />
      <div className="cp-menu-col">
        <div className="cp-menu-top">
          <div className="cp-menu-brand">
            <Crest club={club} branding={branding} className="cp-menu-crest" />
            <span className="cp-menu-word">CLUBHOUSE</span>
          </div>
          <button type="button" className="cp-menu-round" onClick={onClose} aria-label="Close menu">
            <X {...IC} size={18} />
          </button>
        </div>

        {isIndex ? (
          <div className="cp-menu-index">
            <div className="cp-menu-headline">EXPLORE<br />THE CLUB</div>
            {items.map((it, i) => {
              const Ico = it.Icon;
              return (
                <button key={it.key} type="button" className="cp-menu-item"
                  style={{ animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s` }}
                  onClick={() => onSelect(it.view)}>
                  <span className="cp-menu-num">{it.num}</span>
                  <span className="cp-menu-itemtile"><Ico {...IC} size={22} /></span>
                  <div className="cp-menu-itemmid">
                    <div className="cp-menu-itemlabel">{it.label}</div>
                    <div className="cp-menu-itemdesc">{it.desc}</div>
                  </div>
                  <ArrowRight {...IC} size={18} className="cp-menu-itemarrow" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cp-menu-detail">
            <div className="cp-menu-detailhead">
              <button type="button" className="cp-menu-round" onClick={onBack} aria-label="Back to menu">
                <ArrowLeft {...IC} size={18} />
              </button>
              <span className="cp-menu-detailtitle">{current?.label || ""}</span>
            </div>
            <div className="cp-menu-detailbody">
              {detail?.[view] || <MenuNote>Nothing here yet.</MenuNote>}
            </div>
          </div>
        )}
      </div>
    </div>
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
