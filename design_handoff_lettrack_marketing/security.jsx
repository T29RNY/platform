// LetTrack — Security & data page.
// Companion to the home page. Same visual system, scoped under .lt-marketing.

const { useEffect, useState } = React;

/* ---------- shared bits ---------- */

const ArrowRight = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 6l6 6-6 6"/>
  </svg>
);

const ArrowLeft = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M11 18l-6-6 6-6"/>
  </svg>
);

const LogoMark = () => (
  <span className="logo-mark">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/>
      <path d="M9 9v.01M9 12v.01M9 15v.01"/>
    </svg>
  </span>
);

/* ---------- nav + footer (lightweight copies) ---------- */

function Nav() {
  return (
    <nav className="mk">
      <div className="nav-in">
        <a className="brand" href="LetTrack%20Home.html"><LogoMark/>LetTrack</a>
        <div className="nav-links">
          <a href="LetTrack%20Home.html">Home</a>
          <a href="LetTrack%20Home.html#audiences">Agencies</a>
          <a href="LetTrack%20Home.html#audiences">Landlords</a>
          <a href="LetTrack%20Home.html#audiences">Tenants</a>
          <a href="#" className="on">Security</a>
        </div>
        <div className="nav-cta">
          <a href="#" className="btn btn-ghost btn-sm">Sign in</a>
          <a href="#" className="btn btn-primary btn-sm">Get started</a>
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="mk">
      <div className="wrap foot">
        <a className="brand" href="LetTrack%20Home.html" style={{fontSize: 15}}><LogoMark/>LetTrack</a>
        <div className="foot-links">
          <a href="LetTrack%20Home.html">Home</a>
          <a href="LetTrack%20Home.html#audiences">Agencies</a>
          <a href="LetTrack%20Home.html#audiences">Landlords</a>
          <a href="LetTrack%20Home.html#audiences">Tenants</a>
          <a href="#">Security</a>
          <a href="#">Help</a>
        </div>
        <div className="copy">© 2026 LETTRACK · UK PRS COMPLIANCE</div>
      </div>
    </footer>
  );
}

/* ---------- bubbles (same as home, minus the parallax JS for simplicity) ---------- */

function Bubbles() {
  return (
    <div className="bubbles" aria-hidden>
      <div className="bubble-wrap w1"><div className="bubble b1"/></div>
      <div className="bubble-wrap w2"><div className="bubble b2"/></div>
      <div className="bubble-wrap w4"><div className="bubble b4"/></div>
    </div>
  );
}

/* ---------- hero ---------- */

function Hero() {
  return (
    <header className="sec-hero">
      <div className="sec-hero-top">
        <a href="LetTrack%20Home.html" className="sec-back">
          <ArrowLeft/> Back to home
        </a>
        <div className="eyebrow mono">
          <span className="dot"></span>SECURITY &amp; DATA
        </div>
      </div>
      <h1>Safe, in plain English.<br/><span className="g">And in the detail underneath.</span></h1>
      <p className="sub">
        LetTrack is a compliance product — which means false claims about security are a liability we won't take.
        Everything on this page is either live in the platform today, or clearly labelled as roadmap.
      </p>
      <div className="sec-posture">
        <div className="sec-posture-rating">
          <span className="rating-big">B<small>+</small></span>
          <span className="rating-label">posture</span>
        </div>
        <div className="sec-posture-body">
          <div className="sec-posture-h mono">// self-assessed security posture</div>
          <p>
            Mapped against <b>ISO 27001:2022</b>, <b>NIST CSF 2.0</b> and <b>OWASP ASVS</b>.
            Independent third-party certification is on the pre-launch roadmap below.
          </p>
        </div>
      </div>
    </header>
  );
}

/* ---------- audience strip ---------- */

const AUDIENCE_LINES = [
  {
    role: "Tenants",
    line: "You only ever see your own home. Your data is private, and never sold.",
    ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/></svg>)
  },
  {
    role: "Landlords",
    line: "A tamper-proof record you can use to prove compliance, later.",
    ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>)
  },
  {
    role: "Agencies",
    line: "Client data is isolated per organisation, and audit-ready by default.",
    ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16"/><path d="M13 9h5a1 1 0 0 1 1 1v11"/></svg>)
  },
  {
    role: "Contractors",
    line: "You see only the job assigned to you — nothing else about the property or tenant.",
    ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 1 1-5 5L3 18l3 3 6.7-6.7a4 4 0 0 1 5-5l-2.5-2.5z"/></svg>)
  },
];

function AudienceStrip() {
  return (
    <section className="wrap">
      <div className="aud-strip">
        {AUDIENCE_LINES.map((a) => (
          <article key={a.role} className="aud-strip-card">
            <div className="ico">{a.ico}</div>
            <div>
              <div className="role mono">For {a.role.toLowerCase()}</div>
              <p>{a.line}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------- control data ---------- */

const RATING_LABELS = {
  A: { label: "Strong",   tone: "ok"   },
  B: { label: "Solid",    tone: "info" },
  C: { label: "Baseline", tone: "warn" },
};

const SHIPPED_GROUPS = [
  {
    id: "isolation",
    title: "Who can see what",
    sub: "Every record knows which organisation, role and user is allowed to touch it — and the database enforces it.",
    controls: [
      {
        n: 1,
        title: "Tenant data isolation",
        body: "You only ever see the world that belongs to you — your home, your properties, or the job you've been assigned. Row-Level Security is enforced at the database layer (organisation_id + membership), so app bugs can't leak cross-tenant data.",
        frameworks: ["ISO A.8.3 / A.5.15", "NIST PR.AA-05", "OWASP ASVS V4"],
        rating: "A",
      },
      {
        n: 2,
        title: "Role-based access",
        body: "Each role gets exactly the access it needs and nothing more. A 9-role hierarchy is enforced in RLS policies; contractors are scoped to assigned jobs only.",
        frameworks: ["ISO A.5.15 / A.5.18", "NIST PR.AA-05", "ASVS V4"],
        rating: "A",
      },
      {
        n: 3,
        title: "Isolation is actively tested",
        body: "The \"you can't see other people's data\" rule isn't trusted — it's proven. Around 35 automated RLS contract tests attempt cross-tenant access on every release and must pass before code ships.",
        frameworks: ["ISO A.8.29", "NIST PR.AA", "ASVS V4"],
        rating: "A",
      },
    ],
  },
  {
    id: "documents",
    title: "Files & sensitive data",
    sub: "Documents are private by default. Right to Rent — the highest-stakes data we hold — gets the strongest lock.",
    controls: [
      {
        n: 4,
        title: "Private document storage",
        body: "Your files can't be reached by a guessed or shared link. No public storage buckets are used; everything sits in private buckets, with a separate locked store reserved for Right to Rent.",
        frameworks: ["ISO A.8.12 / A.5.23", "NIST PR.DS", "ASVS V12"],
        rating: "B",
      },
      {
        n: 5,
        title: "Time-limited file access",
        body: "A document link works only for you, and only briefly. Signed URLs are generated by the server after a permission check; raw storage paths are never exposed to the browser.",
        frameworks: ["ISO A.8.3", "NIST PR.AA-05", "ASVS V12"],
        rating: "A",
      },
      {
        n: 6,
        title: "Right to Rent protection",
        body: "The most sensitive ID and immigration data gets the strongest lock. Stored in a separate bucket with 5-minute links; share code and date of birth are field-level encrypted via pgcrypto, with a key the application never reads, held in a vault.",
        frameworks: ["ISO A.8.24 / A.5.34", "NIST PR.DS-01", "ASVS V6"],
        rating: "A",
      },
    ],
  },
  {
    id: "audit",
    title: "Accountability",
    sub: "If something happens, you can prove what happened — and to whom.",
    controls: [
      {
        n: 7,
        title: "Tamper-proof audit log",
        body: "An honest, unchangeable record of who did what — useful for proving compliance. Every change is written to an append-only audit_log; database triggers physically block edits and deletes; records carry actor, organisation, action, entity and changed fields.",
        frameworks: ["ISO A.8.15 (+log protection)", "NIST DE.AE / PR.PS", "ASVS V7"],
        rating: "A",
      },
      {
        n: 10,
        title: "Safe email handling",
        body: "Test environments can't accidentally email real people; every real email is logged. Sending is dry-run by default; each delivery is recorded with recipient and status.",
        frameworks: ["ISO A.5.14 / A.8.16", "NIST DE.CM"],
        rating: "B",
      },
    ],
  },
  {
    id: "crypto",
    title: "Encryption, secrets & login",
    sub: "What's on the wire is sealed. What grants power lives where the app can't see it.",
    controls: [
      {
        n: 8,
        title: "Encryption in transit",
        body: "Everything you send and receive is sealed in transit. HTTPS/TLS is enforced via HSTS (preload) plus hardening headers (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy).",
        frameworks: ["ISO A.8.24 / A.5.14", "NIST PR.DS-02", "ASVS V9"],
        rating: "A",
      },
      {
        n: 9,
        title: "Secrets kept out of reach",
        body: "Powerful keys never touch your browser or our application code. Secrets live in server config only; the most powerful database key is restricted to back-office jobs; the Right to Rent encryption key lives in a vault.",
        frameworks: ["ISO A.8.24 / A.8.4", "NIST PR.AA", "ASVS V6"],
        rating: "B",
      },
      {
        n: 12,
        title: "Secure login",
        body: "Trusted, standard sign-in via Supabase Auth with JWT sessions: email + password (minimum length enforced), magic link, or Google. Two-factor authentication is on the roadmap below.",
        frameworks: ["ISO A.5.17 / A.8.5", "NIST PR.AA-01 / 02", "ASVS V2"],
        rating: "C",
      },
    ],
  },
  {
    id: "residency",
    title: "Where it lives, who handles it",
    sub: "EU-hosted, under strong data-protection law, with a tight third-party footprint.",
    controls: [
      {
        n: 13,
        title: "EU data hosting",
        body: "Your data sits inside the EU, under strong data-protection law. Hosted on AWS Ireland (EU region) and covered by UK–EU data-protection adequacy. UK residency is on the roadmap if customers require it.",
        frameworks: ["ISO A.5.23 / A.5.34", "UK GDPR Art.44–46"],
        rating: "B",
      },
      {
        n: 14,
        title: "GDPR foundations",
        body: "Clear privacy rights, a published privacy policy, defined retention periods, and stated controller/processor positions — LetTrack acts as processor for data uploaded by landlords and agencies. Data-subject-request structures are in place.",
        frameworks: ["ISO A.5.34", "UK GDPR Art.5 / 12–22"],
        rating: "B",
      },
      {
        n: 11,
        title: "Minimal third parties",
        body: "Your data isn't sold or scattered across vendors. We use Supabase (data and storage), Resend (email), Stripe (payments, currently off), and Sentry (error alerts). No onward data sharing.",
        frameworks: ["ISO A.5.19–A.5.23", "NIST GV.SC"],
        rating: "B",
      },
    ],
  },
];

const ROADMAP = [
  { title: "Two-factor authentication (MFA)",              body: "A second lock on your account even if a password leaks.",                   target: "A" },
  { title: "UK data residency (if required)",              body: "Data held in the UK, not only the EU, for customers that need it.",          target: "A" },
  { title: "Upload malware scanning",                      body: "Files checked for malware before anyone opens them.",                       target: "B" },
  { title: "One-click GDPR erasure & export",              body: "Request deletion or export of your data, and it happens — end-to-end.",     target: "A" },
  { title: "Formal GDPR governance",                       body: "DPO appointed, ICO registration, processor agreements signed and tracked.", target: "A" },
  { title: "Mandatory email verification",                 body: "Confirms an account belongs to the person who owns the email address.",     target: "B" },
  { title: "Broader at-rest field encryption",             body: "More sensitive fields individually locked, like Right to Rent already is.", target: "A" },
  { title: "Retention & legal-hold automation",            body: "Old data removed on schedule; disputed data preserved automatically.",      target: "B" },
  { title: "Breach-response runbook",                      body: "Fast, correct notification if anything ever goes wrong.",                   target: "B" },
  { title: "Independent security audit / pen-test",        body: "Third-party proof, not just our word.",                                     target: "A" },
];

/* ---------- shipped section ---------- */

function RatingChip({ rating }) {
  const r = RATING_LABELS[rating];
  if (!r) return null;
  return (
    <span className={`rating-chip ${r.tone}`} title={`Self-assessed: ${rating} — ${r.label}`}>
      <b>{rating}</b>
      <span>{r.label}</span>
    </span>
  );
}

function ControlCard({ c }) {
  return (
    <article className="ctrl-card">
      <div className="ctrl-card-top">
        <span className="ctrl-num mono">{String(c.n).padStart(2, "0")}</span>
        <RatingChip rating={c.rating}/>
      </div>
      <h4>{c.title}</h4>
      <p>{c.body}</p>
      <div className="ctrl-fw">
        {c.frameworks.map((f) => (
          <span key={f} className="fw-chip mono">{f}</span>
        ))}
      </div>
    </article>
  );
}

function ShippedSection() {
  return (
    <section className="sec-block">
      <div className="wrap">
        <div className="sec-block-head">
          <div className="sec-tag mono">// shipped today</div>
          <h2>What's live in the platform now.</h2>
          <p>
            Fourteen controls that are switched on for every customer, today. Each shows the plain-English benefit,
            the technical detail, and how it maps to recognised frameworks.
          </p>
        </div>

        {SHIPPED_GROUPS.map((g) => (
          <div className="ctrl-group" key={g.id}>
            <div className="ctrl-group-head">
              <h3>{g.title}</h3>
              <p>{g.sub}</p>
            </div>
            <div className="ctrl-grid">
              {g.controls.map((c) => <ControlCard key={c.n} c={c}/>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- roadmap ---------- */

function Roadmap() {
  return (
    <section className="sec-block roadmap-block">
      <div className="wrap">
        <div className="sec-block-head">
          <div className="sec-tag mono roadmap-tag">// before go-live · roadmap</div>
          <h2>What we're building before launch.</h2>
          <p>
            These items are <em>not yet live</em>. They sit on the pre-launch roadmap, and are presented here in
            full — so you can hold us to them when they ship.
          </p>
        </div>
        <ol className="roadmap-grid">
          {ROADMAP.map((r, i) => (
            <li key={r.title} className="roadmap-card">
              <div className="roadmap-card-top">
                <span className="roadmap-num mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="roadmap-badge mono">Coming</span>
              </div>
              <h4>{r.title}</h4>
              <p>{r.body}</p>
              <div className="roadmap-target mono">target: <b>{r.target}</b> {RATING_LABELS[r.target].label}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- footnote ---------- */

function Footnotes() {
  return (
    <section className="wrap sec-footnotes">
      <div className="footnote-card">
        <h4 className="mono">// the small print</h4>
        <ul>
          <li><b>Ratings are self-assessed.</b> A, B and C labels reflect our own mapping against ISO 27001:2022, NIST CSF 2.0 and OWASP ASVS — they are not externally audited certifications. An independent assessment is on the roadmap.</li>
          <li><b>Demo numbers are demo numbers.</b> The illustrative figures shown elsewhere on the marketing site (property counts, percentages, sample timelines) are not live security metrics.</li>
          <li><b>Found something we should fix?</b> Security disclosures are welcome at <a href="mailto:security@lettrack.example">security@lettrack.example</a>.</li>
        </ul>
      </div>
    </section>
  );
}

/* ---------- final CTA ---------- */

function Final() {
  return (
    <section className="wrap final-section">
      <div className="final">
        <div className="final-inner">
          <h2>Questions about how we protect your data?</h2>
          <p>We'd rather have the conversation than oversell. Reach out and we'll walk you through any of the controls above — or the gaps still on the roadmap.</p>
          <div className="hero-cta">
            <a href="mailto:security@lettrack.example" className="btn btn-primary">Email the security team <ArrowRight/></a>
            <a href="LetTrack%20Home.html" className="btn btn-ghost">Back to home</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- root ---------- */

function SecurityPage() {
  return (
    <div className="lt-marketing t-home t-landlord-on sec-page">
      <Bubbles/>
      <Nav/>
      <div className="wrap">
        <Hero/>
      </div>
      <AudienceStrip/>
      <ShippedSection/>
      <Roadmap/>
      <Footnotes/>
      <Final/>
      <Footer/>
    </div>
  );
}

window.SecurityPage = SecurityPage;
