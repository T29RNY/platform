import { useEffect, useRef, useState } from "react";
import { getClubPublic } from "@platform/core/storage/supabase.js";
import { getPublicVocab } from "./ClubPublic/clubPublicVocab.js";
import { allFixtures, deriveHero, themeVars } from "./ClubPublic/clubPublicHelpers.js";
import {
  TopBar, Hero, FixturesSection, TeamsSection, NewsSection, SponsorsSection,
  TournamentsSection, StatsSection, ContactsSection, DocumentsSection,
  EventsSection, AboutSection, GetInvolvedSection, SafeguardNote, Footer,
  ClubLoading, ClubNotFound,
} from "./ClubPublic/clubPublicSections.jsx";
import "./ClubPublic/clubPublic.css";

// Modular Platform Epic B — Phase 4. The public club home page at /c/<slug>.
// Presentational; data comes from get_club_public (mig 445). The hero swaps
// next-fixture ↔ latest-result on a ~30s poll (NO live in-play score — the club
// fixtures source has no minute state; live scores live only on the tournament
// hub). Theming is per-club CSS vars scoped to .club-public; type/icons stay
// platform (Bebas / DM Sans / Phosphor thin). Conditional modules (stats/contacts/
// documents/events/get-involved + sponsor tier) read optional payload keys and
// render empty/absent until the P5 read-extension populates them.

const POLL_MS = 30000;

// Default section order + visibility when a club hasn't configured `sections`
// (most clubs until they run the P5 wizard). The wizard's [{key,enabled,order}]
// overrides this. Each renderer hides itself when it has nothing worth showing.
const DEFAULT_ORDER = [
  "fixtures", "teams", "stats", "news", "sponsors", "tournaments",
  "events", "documents", "contacts", "about", "get-involved",
];

function orderedKeys(sections) {
  if (Array.isArray(sections) && sections.length > 0) {
    return sections
      .filter((s) => s && s.key && s.enabled !== false)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((s) => s.key);
  }
  return DEFAULT_ORDER;
}

export default function ClubPublicScreen({ slug }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer = null;

    const load = async (first) => {
      try {
        const r = await getClubPublic(slug);
        if (!alive.current) return;
        if (!r?.found) { setNotFound(true); setData(null); }
        else { setData(r); setNotFound(false); }
      } catch (e) {
        console.error("[club-page] fetch failed", e);
        if (alive.current && first) setNotFound(true);
      } finally {
        if (alive.current && first) setLoading(false);
      }
    };

    load(true);
    timer = setInterval(() => load(false), POLL_MS); // swap-only refresh
    return () => { alive.current = false; if (timer) clearInterval(timer); };
  }, [slug]);

  if (loading) return <ClubLoading />;
  if (notFound || !data) return <ClubNotFound />;

  const { club, branding, leagues, teams, sponsors, news, tournaments } = data;
  const vocab = getPublicVocab(club?.discipline);
  const hero = deriveHero(allFixtures(leagues));
  const hideRosters = false; // server already strips members when policy hides them

  const website = branding?.socials?.website || null;
  // Gated per-club trial CTA (P5): when club_pages.trial_cta_enabled is on, the primary CTA
  // points at the /c/<slug>/trial flow and takes precedence over the website link. Default OFF
  // ⇒ trialHref is null and every CTA falls back to the website exactly as before, so an
  // un-opted club (e.g. PA Sports) renders byte-identical.
  const trialEnabled = !!branding?.trial_cta_enabled;
  const trialHref = trialEnabled ? `/c/${slug}/trial` : null;
  // No dead self-anchor fallback: when there's no real destination, joinHref stays null and
  // GetInvolvedSection hides the CTA rather than rendering a button that scrolls to itself.
  const joinHref = trialHref || website;
  const joinLabel = trialEnabled ? "Book a FREE trial" : vocab.joinCta;
  const joinSub = trialEnabled ? "No card needed · one free session" : `New ${vocab.participant.toLowerCase()} welcome`;

  const renderers = {
    fixtures: () => <FixturesSection key="fixtures" leagues={leagues} vocab={vocab} />,
    teams: () => <TeamsSection key="teams" teams={teams} vocab={vocab} />,
    stats: () => <StatsSection key="stats" stats={data.stats} vocab={vocab} />,
    news: () => <NewsSection key="news" news={news} />,
    sponsors: () => <SponsorsSection key="sponsors" sponsors={sponsors} />,
    tournaments: () => <TournamentsSection key="tournaments" tournaments={tournaments} />,
    events: () => <EventsSection key="events" events={data.events} />,
    documents: () => <DocumentsSection key="documents" documents={data.documents} />,
    contacts: () => <ContactsSection key="contacts" contacts={data.contacts} />,
    about: () => <AboutSection key="about" club={club} branding={branding} />,
    "get-involved": () => (
      <GetInvolvedSection key="get-involved" getInvolved={data.getInvolved}
        joinHref={joinHref} joinLabel={joinLabel} joinSub={joinSub} />
    ),
  };

  return (
    <div className="club-public" style={themeVars(branding)}>
      <div className="cp-col">
        <TopBar club={club} branding={branding}
          joinHref={trialHref || website} joinLabel={trialEnabled ? "Book a trial" : "Join"} />
        <Hero club={club} branding={branding} hero={hero} vocab={vocab}
          joinHref={joinHref} joinLabel={joinLabel} hasNews={(news || []).length > 0} />
        {orderedKeys(branding?.sections).map((k) => (renderers[k] ? renderers[k]() : null))}
        <SafeguardNote hidden={hideRosters} />
        <Footer club={club} />
      </div>
    </div>
  );
}
