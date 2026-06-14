// LetTrack home — main app. Wires the hero, mission-control stage,
// stats, audiences, trust, final CTA, footer.

const { useEffect, useRef, useState } = React;

/* ---------------- Reveal: scroll-into-view fade+rise ---------------- */

function Reveal({ children, delay = 0, immediate = false, className = "" }) {
  // Simplified: render visible. Decorative reveal animations were getting frozen
  // mid-animation by the screenshot environment, so we render content directly.
  return <div className={`rv ${className}`}>{children}</div>;
}

/* ---------------- Particles ---------------- */

function Particles() {
  const items = Array.from({ length: 14 });
  return (
    <div className="particles" aria-hidden>
      {items.map((_, i) => {
        const left = 50 + (Math.random() - 0.5) * 90;
        const delay = Math.random() * 8;
        const duration = 6 + Math.random() * 5;
        return (
          <i
            key={i}
            style={{
              left: `${left}%`,
              top: `${600 + Math.random() * 400}px`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              width: `${2 + Math.random() * 2}px`,
              height: `${2 + Math.random() * 2}px`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------------- Audience content map ---------------- */

const AUDIENCES = {
  landlord: {
    h1l1: "Less paperwork.",
    h1l2: "More rent.",
    sub:  "Every cert, deadline, repair, message and tax record — handled in one place. Free for 60 days, no card.",
    cta:  "Start 60 days free",
    dashAddr: "14 Maple Road, Leeds · LS6 2AB",
    dashLabel: "MY PROPERTY · LIVE VIEW",
    pillLabel: "Landlord",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>),
  },
  agency: {
    h1l1: "Run your book",
    h1l2: "on autopilot.",
    sub:  "From compliance to mortgage prep, every property in your portfolio handled in one place. Free for 60 days, no card.",
    cta:  "Start 60 days free",
    dashAddr: "Highbury Lettings · 12 properties",
    dashLabel: "PORTFOLIO · LIVE VIEW",
    pillLabel: "Agency",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16"/><path d="M13 9h5a1 1 0 0 1 1 1v11"/><path d="M8 8h.01M8 12h.01M8 16h.01"/></svg>),
  },
  tenant: {
    h1l1: "Your home,",
    h1l2: "in your hands.",
    sub:  "Your safety certs, deposit, repairs and messages — one app, free forever.",
    cta:  "Join free",
    dashAddr: "14 Maple Road · my home",
    dashLabel: "MY HOME · LIVE VIEW",
    pillLabel: "Tenant",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/></svg>),
  },
};

const AudienceCtx = React.createContext({ aud: "landlord", set: () => {} });

const ArrowRight = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 6l6 6-6 6"/>
  </svg>
);
const Check = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
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

/* ---------------- Nav + Footer ---------------- */

function Nav() {
  return (
    <nav className="mk">
      <div className="nav-in">
        <a className="brand" href="#"><LogoMark/>LetTrack</a>
        <div className="nav-links">
          <a href="#audiences" className="on">Home</a>
          <a href="#audiences">Agencies</a>
          <a href="#audiences">Landlords</a>
          <a href="#audiences">Tenants</a>
          <a href="#">Help</a>
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
        <a className="brand" href="#" style={{fontSize: 15}}><LogoMark/>LetTrack</a>
        <div className="foot-links">
          <a href="#">Agencies</a>
          <a href="#">Landlords</a>
          <a href="#">Tenants</a>
          <a href="LetTrack%20Security.html">Security</a>
          <a href="#">Help</a>
          <a href="#">Sign in</a>
        </div>
        <div className="copy">© 2026 LETTRACK · UK PRS COMPLIANCE</div>
      </div>
    </footer>
  );
}

/* ---------------- Telemetry strip ---------------- */

function Telemetry() {
  const [scan, setScan] = useState(2);
  const [risk, setRisk] = useState("0.06");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const risks = ["0.06", "0.05", "0.07", "0.06", "0.04"];
    let s = 2, ri = 0;
    const id = setInterval(() => {
      s = s >= 9 ? 2 : s + 1;
      setScan(s);
      if (s === 2) { ri = (ri + 1) % risks.length; setRisk(risks[ri]); }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="telemetry">
      <span className="live">LIVE</span>
      <span>PORTFOLIO <b>12</b></span>
      <span>UPRN <b>100023336956</b></span>
      <span>53.8008°N · 1.5491°W</span>
      <span>RISK_INDEX <b>{risk}</b></span>
      <span>LAST_SCAN <b>{scan}s</b></span>
      <span>ENGINE <b>v1·RRA2025</b></span>
    </div>
  );
}

/* ---------------- Dashboard mockup (left of stage) ---------------- */

const OBLIG_ICONS = {
  gas: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2s4 5 4 9a4 4 0 0 1-8 0c0-2 2-4 2-6 0 2 2 3 2 5"/></svg>),
  shield: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>),
  id:     (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.5 1.7-2 3-2s2.4.5 3 2"/></svg>),
  smoke:  (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>),
  bolt:   (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m13 2-9 12h8l-1 8 9-12h-8l1-8z"/></svg>),
  doc:    (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>),
};

function Dashboard() {
  const { aud } = React.useContext(AudienceCtx);
  const A = AUDIENCES[aud];
  const [flashRow, setFlashRow] = useState(0);
  const rows = [
    { icon: OBLIG_ICONS.shield, t: "Right to Rent · new tenant",     s: "VERIFIED · 17 Mar",      stat: "OK",      cls: "ok"   },
    { icon: OBLIG_ICONS.bolt,   t: "EPC · domestic energy",          s: "DUE in 28 days",         stat: "REVIEW",  cls: "warn" },
    { icon: OBLIG_ICONS.gas,    t: "Gas safety certificate",         s: "VALID · 11 Aug 2026",    stat: "OK",      cls: "ok"   },
    { icon: OBLIG_ICONS.smoke,  t: "Smoke / CO alarm sweep",         s: "ACTION · breach risk",   stat: "ACTION",  cls: "bad"  },
    { icon: OBLIG_ICONS.doc,    t: "Deposit protection (DPS)",       s: "PROTECTED · ref 7Y2K9",  stat: "OK",      cls: "ok"   },
  ];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % rows.length;
      setFlashRow(i);
    }, 1600);
    return () => clearInterval(id);
  }, []);

  // ring progress: 11 of 14
  const total = 14, met = 11;
  const C = 2 * Math.PI * 28;
  const off = C * (1 - met / total);

  return (
    <div className="dash">
      <div className="dash-head">
        <div className="addr">
          <span className="label">{A.dashLabel}</span>
          <span className="h">{A.dashAddr}</span>
        </div>
        <span className="status-pill">DETECTING</span>
      </div>

      <div className="dash-summary">
        <div className="dash-score">
          <div className="ring">
            <svg viewBox="0 0 64 64">
              <circle className="track" cx="32" cy="32" r="28" fill="none" strokeWidth="4"/>
              <circle className="fill"  cx="32" cy="32" r="28" fill="none" strokeWidth="4"
                strokeDasharray={C} strokeDashoffset={off}/>
            </svg>
            <div className="ring-num">{Math.round((met/total)*100)}<span>%</span></div>
          </div>
          <div className="dash-score-body">
            <div className="score-h mono">// compliance score</div>
            <div className="score-line">
              <span className="score-v">{met}<span className="of">/{total}</span></span>
              <span className="score-l">duties met</span>
            </div>
          </div>
        </div>
        <div className="dash-tiles">
          <div className="dtile">
            <span className="dt-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg></span>
            <div className="dt-v">3</div>
            <div className="dt-l">Tenancies</div>
            <div className="dt-s">all current</div>
          </div>
          <div className="dtile warn">
            <span className="dt-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
            <div className="dt-v">2</div>
            <div className="dt-l">To review</div>
            <div className="dt-s">within 30 days</div>
          </div>
          <div className="dtile bad">
            <span className="dt-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></span>
            <div className="dt-v">1</div>
            <div className="dt-l">Needs action</div>
            <div className="dt-s">Awaab Law risk</div>
          </div>
          <div className="dtile">
            <span className="dt-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg></span>
            <div className="dt-v">3</div>
            <div className="dt-l">Renewals</div>
            <div className="dt-s">due this quarter</div>
          </div>
        </div>
      </div>

      <div className="oblig-head">
        <span className="l">// obligation stack</span>
        <span className="r">SORT · severity</span>
      </div>

      <div className="oblig">
        {rows.map((r, i) => (
          <div key={r.t} className={`row ${i === flashRow ? "flash" : ""}`}>
            <div className="icon">{r.icon}</div>
            <div className="meta">
              <div className="t">{r.t}</div>
              <div className="s">{r.s}</div>
            </div>
            <div className={`stat ${r.cls}`}>{r.stat}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Detection log (streaming) ---------------- */

const LOG_ENTRIES = [
  { txt: "SCAN property#LS6-2AB" },
  { txt: "DETECT gas",            tag: "VALID",      cls: "ok" },
  { txt: "DETECT epc",            tag: "REVIEW",     cls: "wn" },
  { txt: "DETECT rtr",            tag: "VERIFIED",   cls: "ok" },
  { txt: "FLAG smoke",            tag: "AWAAB_LAW",  cls: "bd" },
  { txt: "INDEX deposit#7Y2K9",   tag: "PROTECTED",  cls: "ok" },
  { txt: "DETECT eicr",           tag: "VALID",      cls: "ok" },
  { txt: "INGEST contract.pdf",   tag: "PARSED",     cls: "ok" },
  { txt: "DETECT epc_band",       tag: "D→C REQUIRED", cls: "wn" },
  { txt: "MATCH uprn 100023336956", tag: "LINKED",   cls: "ok" },
  { txt: "SCHEDULE gas_renewal",  tag: "−28 DAYS",   cls: "wn" },
  { txt: "FLAG damp_report",      tag: "AWAAB_LAW",  cls: "bd" },
  { txt: "NOTIFY tenant#mh21",    tag: "SENT",       cls: "ok" },
  { txt: "DETECT smoke_alarm",    tag: "×2 ROOMS",   cls: "wn" },
];

const MAX_LOG = 5;

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function nowStamp(offset = 0) {
  const d = new Date(Date.now() + offset * 1000);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function DetectionLog() {
  const seedRef = useRef(0);
  const [lines, setLines] = useState(() => {
    return LOG_ENTRIES.slice(0, MAX_LOG).map((e, i) => ({
      ...e,
      id: i,
      ts: nowStamp(i - MAX_LOG),
    }));
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let idx = MAX_LOG;
    seedRef.current = MAX_LOG;
    const tick = () => {
      const entry = LOG_ENTRIES[idx % LOG_ENTRIES.length];
      idx += 1;
      seedRef.current += 1;
      const id = seedRef.current;
      setLines((prev) => {
        const next = [...prev.slice(-(MAX_LOG - 1)), { ...entry, id, ts: nowStamp() }];
        return next;
      });
    };
    const id = setInterval(tick, 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="detlog">
      <h4>// detection log <span className="detlog-live">LIVE</span></h4>
      <div className="detlog-feed">
        {lines.map((l, i) => {
          const isLatest = i === lines.length - 1;
          return (
            <div key={l.id} className={`ll${isLatest ? " latest" : ""}`}>
              <span className="ts">{l.ts}</span> {l.txt}
              {l.tag ? <> <span className={l.cls}>{l.tag}</span></> : null}
              {isLatest ? <span className="caret" aria-hidden></span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Mission Control stage ---------------- */

function MissionControl() {
  const phaseRef = useRef(null);
  return (
    <div className="stage-wrap" id="mission">
      <Reveal>
        <div className="stage">
          <Telemetry/>
          <div className="stage-body">
            <Dashboard/>
            <div className="scan-side">
              <div className="scan-head">
                <span className="l">scan target · <b>14 Maple Rd</b></span>
                <span className="phase" ref={phaseRef}>▸ SCANNING</span>
              </div>
              <HouseCanvas phaseRef={phaseRef}/>
              <DetectionLog/>
            </div>
          </div>
        </div>
      </Reveal>
      <div className="stage-foot">solid · wireframe · detection — the same property, seen the way LetTrack sees it</div>
    </div>
  );
}

/* ---------------- Stats row ---------------- */

function Counter({ to, suffix = "" }) {
  const ref = useRef(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(to); return; }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            let cur = 0;
            const step = Math.max(1, Math.round(to / 28));
            const tick = () => {
              cur = Math.min(to, cur + step);
              setN(cur);
              if (cur < to) requestAnimationFrame(tick);
            };
            tick();
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{n}{suffix}</span>;
}

function Stats() {
  return (
    <section className="stats-section" id="ai">
      <div className="wrap">
        <Reveal>
          <div className="ai-strap">
            <div className="ai-strap-head">
              <span className="ai-tag mono">// ai compliance core</span>
              <h3>One AI engine, watching every property, every law, every day.</h3>
              <p>LetTrack's AI ingests your certificates, tenancies and deeds, cross-references every duty under the Renters' Rights Act, and flags the things that need a human — so you only ever look at what matters.</p>
            </div>
            <div className="ai-strap-loop" aria-hidden>
              <span>INGEST</span>
              <i></i>
              <span>UNDERSTAND</span>
              <i></i>
              <span>DETECT</span>
              <i></i>
              <span>NOTIFY</span>
            </div>
          </div>
        </Reveal>
        <Reveal>
          <div className="stats">
            <div className="cell">
              <div className="v g"><Counter to={8}/></div>
              <div className="l">connected modules</div>
              <div className="sub">From Compliance Engine to Right to Rent — all linked by one AI.</div>
            </div>
            <div className="cell">
              <div className="v"><Counter to={0}/></div>
              <div className="l">missed deadlines</div>
              <div className="sub">AI watches every duty, all the way to expiry.</div>
            </div>
            <div className="cell">
              <div className="v"><Counter to={24} suffix="/7"/></div>
              <div className="l">AI detection, always on</div>
              <div className="sub">Re-scans on every event, every document, every law change.</div>
            </div>
            <div className="cell">
              <div className="v g">RRA 2025</div>
              <div className="l">ready out of the box</div>
              <div className="sub">Renters' Rights Act mapped end-to-end by our AI.</div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Onboarding ---------------- */

function Onboarding() {
  return (
    <section className="onb-section" id="onboard">
      <div className="wrap">
        <div className="sec-head">
          <Reveal><div className="sec-tag mono">// onboarding</div></Reveal>
          <Reveal delay={0.08}><h2>Drop your docs.<br/>Compliance starts itself.</h2></Reveal>
          <Reveal delay={0.16}><p>Upload a folder of certificates and tenancy paperwork. LetTrack reads each one, pulls out the dates, parties and addresses that matter, links them to the right property, and starts the clock on every duty.</p></Reveal>
        </div>

        <Reveal>
          <div className="onb">
            <div className="onb-doc">
              <div className="onb-doc-head">
                <div className="onb-doc-name">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>
                  <span>gas-safety-cert-2026.pdf</span>
                </div>
                <span className="onb-doc-status">EXTRACTING</span>
              </div>
              <div className="onb-doc-body">
                <div className="onb-line">
                  <span className="k">Engineer</span>
                  <span className="v hl">M. Halligan · Gas Safe 547821</span>
                </div>
                <div className="onb-line">
                  <span className="k">Property</span>
                  <span className="v hl">14 Maple Rd, Leeds LS6 2AB</span>
                </div>
                <div className="onb-line">
                  <span className="k">Issued</span>
                  <span className="v hl">11 Aug 2025</span>
                </div>
                <div className="onb-line">
                  <span className="k">Expires</span>
                  <span className="v hl">11 Aug 2026</span>
                </div>
                <div className="onb-line">
                  <span className="k">Appliances</span>
                  <span className="v">3 inspected · 0 defects</span>
                </div>
              </div>
              <div className="onb-doc-foot">
                <span className="mono">UPRN 100023336956 · matched</span>
                <span className="mono ok">✓ LINKED</span>
              </div>
            </div>

            <ol className="onb-steps">
              <li>
                <span className="num">01</span>
                <div>
                  <h4>Drop your documents in</h4>
                  <p>Drag a folder, forward an email, or connect your inbox. Certificates, tenancy agreements, deposit receipts — anything PDF, photo or scan.</p>
                </div>
              </li>
              <li>
                <span className="num">02</span>
                <div>
                  <h4>AI reads and extracts</h4>
                  <p>Our engine identifies the document type and pulls the dates, parties, certificate numbers and addresses out of the page — no forms to fill in.</p>
                </div>
              </li>
              <li>
                <span className="num">03</span>
                <div>
                  <h4>Linked to the property</h4>
                  <p>Each document is matched to the correct UPRN and tenancy, with conflicts flagged for review. One file, in the right place, every time.</p>
                </div>
              </li>
              <li>
                <span className="num">04</span>
                <div>
                  <h4>Compliance starts the clock</h4>
                  <p>Every duty under the Renters' Rights Act begins tracking automatically — expiry windows, reminders and audit trail — from the moment your docs land.</p>
                </div>
              </li>
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Platform (everything in one place) ---------------- */

const PLATFORM_TILES = [
  {
    tag: "messages",
    title: "Stop chasing email threads",
    body: "Every conversation with tenants, contractors and agents lives next to the property they're about. Nothing buried, nothing lost.",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.7-.8L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>),
  },
  {
    tag: "maintenance",
    title: "Repairs sorted, without the spreadsheet",
    body: "Tenant reports a leak. Your approved contractor quotes. You approve. Paid and logged — all in one thread.",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 1 1-5 5L3 18l3 3 6.7-6.7a4 4 0 0 1 5-5l-2.5-2.5z"/></svg>),
  },
  {
    tag: "mortgage",
    title: "Refinance ready in an afternoon",
    body: "A clean mortgage pack — every cert, statement and tenancy — auto-collated for your broker the moment you ask.",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M3 10l9-7 9 7"/><path d="M5 21V10m14 11V10M9 21v-6h6v6"/></svg>),
  },
  {
    tag: "finance & tax",
    title: "Self-assessment without the shoebox",
    body: "Rent in, expenses out, allowances and mortgage interest — reconciled per property. Export an HMRC-ready return.",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/></svg>),
  },
  {
    tag: "timeline",
    title: "One scroll = the property's whole story",
    body: "Every event, document, payment and conversation on a single timeline. Searchable, shareable, defensible.",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l2.5 2.5"/><circle cx="12" cy="12" r="9"/></svg>),
  },
  {
    tag: "audit reports",
    title: "Print-ready compliance, on demand",
    body: "One-click PDF audit packs for councils, courts, insurers and lenders. With a paper trail that holds up.",
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 13h6M9 17h6"/></svg>),
  },
];

function Platform() {
  return (
    <section className="plat-section" id="platform">
      <div className="wrap">
        <div className="sec-head">
          <Reveal><div className="sec-tag mono">// one platform</div></Reveal>
          <Reveal delay={0.08}><h2>Everything a let needs.<br/>In one calm place.</h2></Reveal>
          <Reveal delay={0.16}><p>Messages, maintenance, contractors, finance, mortgage prep, audit reports — not six different apps and a shoebox of receipts. Less time on the let, more left for the rest of life.</p></Reveal>
        </div>

        <Reveal>
          <div className="plat-grid">
            {PLATFORM_TILES.map((t) => (
              <article key={t.tag} className="plat-tile spotlight">
                <div className="plat-ico">{t.icon}</div>
                <div className="plat-tag mono">{t.tag}</div>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
              </article>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Pricing / Trial ---------------- */

function Pricing() {
  return (
    <section className="price-section" id="pricing">
      <div className="wrap">
        <div className="sec-head">
          <Reveal><div className="sec-tag mono">// start free</div></Reveal>
          <Reveal delay={0.08}><h2>Up and running in five minutes.<br/>No card. No catch.</h2></Reveal>
          <Reveal delay={0.16}><p>Tenants and contractors are free, forever. Landlords and agencies get sixty days on us — enough to onboard a whole portfolio and see the value before you pay a penny.</p></Reveal>
        </div>

        <Reveal>
          <div className="price-grid">
            <article className="price-card free spotlight">
              <div className="price-eyebrow mono">tenants &amp; contractors</div>
              <div className="price-head">
                <span className="price-big">Free</span>
                <span className="price-sub">forever</span>
              </div>
              <p className="price-tag">Your home, your trade, no fee. Ever.</p>
              <ul>
                <li><Check size={14}/>Full property record &amp; documents</li>
                <li><Check size={14}/>Repair reporting &amp; quotes</li>
                <li><Check size={14}/>Direct messages, no email tag</li>
              </ul>
              <a href="#" className="btn btn-ghost">Join free <ArrowRight/></a>
            </article>

            <article className="price-card trial highlight spotlight">
              <div className="price-eyebrow mono">landlords <span className="chip">most popular</span></div>
              <div className="price-head">
                <span className="price-big">60 days</span>
                <span className="price-sub">free, then per property</span>
              </div>
              <p className="price-tag">Long enough to onboard, settle, and see the rent admin disappear.</p>
              <ul>
                <li><Check size={14}/>All compliance, finance &amp; tax modules</li>
                <li><Check size={14}/>Mortgage &amp; refinance packs included</li>
                <li><Check size={14}/>Unlimited audit-ready reports</li>
                <li><Check size={14}/>Free contractor &amp; tenant seats</li>
              </ul>
              <a href="#" className="btn btn-primary">Start 60 days free <ArrowRight/></a>
            </article>

            <article className="price-card agency spotlight">
              <div className="price-eyebrow mono">agencies &amp; portfolios</div>
              <div className="price-head">
                <span className="price-big">60 days</span>
                <span className="price-sub">free, then per portfolio</span>
              </div>
              <p className="price-tag">Move a whole book across with white-glove onboarding.</p>
              <ul>
                <li><Check size={14}/>Whole-book risk view &amp; portfolio reports</li>
                <li><Check size={14}/>White-label landlord &amp; tenant portals</li>
                <li><Check size={14}/>Migration help &amp; named onboarding lead</li>
              </ul>
              <a href="#" className="btn btn-ghost">Book a portfolio demo <ArrowRight/></a>
            </article>
          </div>

          <div className="price-note mono">no card to start · cancel any time during trial · your data is yours to export, always</div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Audiences ---------------- */

function Audiences() {
  return (
    <section id="audiences" className="audiences">
      <div className="wrap">
        <div className="sec-head">
          <Reveal><div className="sec-tag mono">// who it's for</div></Reveal>
          <Reveal delay={0.08}><h2>Whatever side of the let<br/>you're on, you're sorted.</h2></Reveal>
          <Reveal delay={0.16}><p>Same trusted record. A view tailored to what you actually need to do today.</p></Reveal>
        </div>
        <div className="aud">
          <Reveal delay={0.04}>
            <a href="#" className="acard agency spotlight">
              <div className="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16"/><path d="M13 9h5a1 1 0 0 1 1 1v11"/><path d="M8 8h.01M8 12h.01M8 16h.01"/></svg></div>
              <div className="role">Agencies & portfolio operators</div>
              <h3>Run a whole book on autopilot</h3>
              <ul>
                <li><Check size={14}/>10 or 10,000 properties in one risk view</li>
                <li><Check size={14}/>White-label landlord & tenant portals</li>
                <li><Check size={14}/>Mortgage, audit and council packs — one click</li>
                <li><Check size={14}/>Migrate your existing book with us</li>
              </ul>
              <div className="go">Try free for 60 days <ArrowRight/></div>
            </a>
          </Reveal>
          <Reveal delay={0.12}>
            <a href="#" className="acard landlord spotlight">
              <div className="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg></div>
              <div className="role">Private & portfolio landlords</div>
              <h3>Less paperwork, more rent</h3>
              <ul>
                <li><Check size={14}/>Compliance, repairs & messages in one place</li>
                <li><Check size={14}/>Self-assessment & refinance packs auto-built</li>
                <li><Check size={14}/>Plain-English reminders before things lapse</li>
                <li><Check size={14}/>60 days free — no card to start</li>
              </ul>
              <div className="go">Try free for 60 days <ArrowRight/></div>
            </a>
          </Reveal>
          <Reveal delay={0.2}>
            <a href="#" className="acard tenant spotlight">
              <div className="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/><path d="M8 18c.7-2 2.2-3 4-3s3.3 1 4 3"/></svg></div>
              <div className="role">Tenants & contractors · free forever</div>
              <h3>A clearer, calmer tenancy</h3>
              <ul>
                <li><Check size={14}/>See your safety certs & deposit anytime</li>
                <li><Check size={14}/>Report a repair, watch it get fixed</li>
                <li><Check size={14}/>Move out smoother — your history is yours</li>
                <li><Check size={14}/>Contractors quote and get paid in-app</li>
              </ul>
              <div className="go">Join free <ArrowRight/></div>
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Trust strip ---------------- */

function Trust() {
  return (
    <section className="trust-section" id="data">
      <div className="wrap">
        <div className="sec-head">
          <Reveal><div className="sec-tag mono">// your data</div></Reveal>
          <Reveal delay={0.08}><h2>Your data, locked down.<br/>So you can stay loose.</h2></Reveal>
          <Reveal delay={0.16}><p>Plain-English promises about how we keep your records safe — with the technical detail underneath, for anyone who wants to look.</p></Reveal>
        </div>
        <Reveal>
          <div className="trust">
            <article>
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/></svg>
              </div>
              <h3>Only the right eyes see your records</h3>
              <p>Whether you're a landlord, agency, tenant or contractor, you only ever see the world that belongs to you. Row-level security is enforced at the <em>database</em>, not just in the app — and proven by automated tests that try to break it on every release.</p>
            </article>
            <article>
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 13h6M9 17h4"/></svg>
              </div>
              <h3>Nothing ever quietly disappears</h3>
              <p>An append-only audit log records who did what, on what, and when. Database triggers physically block edits and deletes — so when you need to prove compliance to a council, court or lender, the trail is intact.</p>
            </article>
            <article>
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></svg>
              </div>
              <h3>The most sensitive data, locked deepest</h3>
              <p>Right to Rent IDs and share-code data are field-encrypted with a key the app never reads, stored in a separate locked bucket. Documents are only ever served over short-lived signed links — never a public URL.</p>
            </article>
            <article>
              <div className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>
              </div>
              <h3>EU-hosted under strong data law</h3>
              <p>Your data lives on AWS Ireland in the EU, covered by UK–EU data-protection adequacy. We act as <em>processor</em> for landlord and agency uploads, with retention periods and data-subject-request structures already in place.</p>
            </article>
          </div>
        </Reveal>
        <Reveal>
          <div className="trust-foot">
            <a href="LetTrack%20Security.html" className="trust-more">
              See the full security posture
              <ArrowRight size={14}/>
            </a>
            <span className="trust-note mono">self-assessed against ISO 27001 / NIST CSF · independent audit on the pre-launch roadmap</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Final CTA ---------------- */

function Final() {
  return (
    <section className="wrap final-section">
      <Reveal>
        <div className="final">
          <div className="final-inner">
            <h2>Less time on the let.<br/>More left for the rest of life.</h2>
            <p>Drop in your documents and watch the admin disappear. 60 days free for landlords and agencies, free forever for tenants and contractors.</p>
            <div className="hero-cta">
              <a href="#" className="btn btn-primary">Start 60 days free <ArrowRight/></a>
              <a href="#" className="btn btn-ghost">Book a portfolio demo</a>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------- Audience selector pill ---------------- */

function AudienceSelector() {
  const { aud, set } = React.useContext(AudienceCtx);
  const keys = ["agency", "landlord", "tenant"];
  return (
    <div className="aud-select" role="tablist" aria-label="Who are you?">
      {keys.map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={aud === k}
          className={`pill ${aud === k ? "on" : ""}`}
          onClick={() => set(k)}
          type="button"
        >
          {AUDIENCES[k].icon}
          {AUDIENCES[k].pillLabel}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Activity ribbon (live ticker under hero eyebrow) ---------------- */

const LIVE_EVENTS = [
  { who: "Highbury Lettings",   what: "gas safety renewed",        tag: "VALID",      tone: "ok"   },
  { who: "14 Maple Rd, Leeds",  what: "EPC band C confirmed",      tag: "OK",         tone: "ok"   },
  { who: "Right to Rent · 9X2K", what: "share code verified",       tag: "VERIFIED",   tone: "ok"   },
  { who: "22 Park Avenue",      what: "deposit protected with DPS", tag: "PROTECTED",  tone: "ok"   },
  { who: "8 Crescent Rd, SE15", what: "damp report flagged",        tag: "AWAAB_LAW",  tone: "bad"  },
  { who: "Cole & Co · 47 props", what: "audit pack exported",        tag: "PDF",        tone: "info" },
  { who: "31 Beech Close",      what: "EICR due in 14 days",        tag: "REVIEW",     tone: "warn" },
];

function ActivityRibbon() {
  const [i, setI] = useState(0);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI(n => (n + 1) % LIVE_EVENTS.length), 3200);
    return () => clearInterval(id);
  }, [reduce]);
  const ev = LIVE_EVENTS[i];
  return (
    <div className="activity" aria-live="polite" aria-label="Live platform activity">
      <span className="activity-live">LIVE</span>
      <div className="activity-feed">
        <div className="activity-event" key={i}>
          <span className="who">{ev.who}</span>
          <span className="what">{ev.what}</span>
          <span className={`act-tag ${ev.tone}`}>{ev.tag}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Spotlight cursor (writes --mx/--my on hovered cards) ---------------- */

function SpotlightLayer() {
  useEffect(() => {
    const onMove = (e) => {
      const el = e.target.closest(".spotlight");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => document.removeEventListener("mousemove", onMove);
  }, []);
  return null;
}

/* ---------------- Hero ---------------- */

function Hero() {
  const { aud } = React.useContext(AudienceCtx);
  const A = AUDIENCES[aud];
  return (
    <header className="home-hero">
      <div className="rv">
        <div className="eyebrow mono">
          <span className="dot"></span>BUILT FOR THE RENTERS' RIGHTS ACT 2025
        </div>
      </div>
      <ActivityRibbon/>
      <div className="aud-prompt">Are you a landlord, agency, or tenant?</div>
      <AudienceSelector/>
      <h1 key={`h-${aud}`}>
        {A.h1l1}<br/>
        <span className="g">{A.h1l2}</span>
      </h1>
      <p className="sub" key={`s-${aud}`}>{A.sub}</p>
      <div className="hero-cta">
        <a href="#" className="btn btn-primary">{A.cta} <ArrowRight/></a>
      </div>
      <div className="reassure">
        <span><Check size={14}/>60 days free for landlords &amp; agencies</span>
        <span><Check size={14}/>Free forever for tenants &amp; contractors</span>
        <span><Check size={14}/>No card to start</span>
      </div>
    </header>
  );
}

function Bubbles() {
  const ref = useRef(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (ref.current) ref.current.style.setProperty("--scroll", String(window.scrollY));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="bubbles" ref={ref} aria-hidden>
      <div className="bubble-wrap w1"><div className="bubble b1"/></div>
      <div className="bubble-wrap w2"><div className="bubble b2"/></div>
      <div className="bubble-wrap w3"><div className="bubble b3"/></div>
      <div className="bubble-wrap w4"><div className="bubble b4"/></div>
      <div className="bubble-wrap w5"><div className="bubble b5"/></div>
    </div>
  );
}

/* ---------------- Atlas — ambient section navigator ---------------- */

const ATLAS_SECTIONS = [
  { id: "top",       label: "Start",     ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>) },
  { id: "mission",   label: "See it work", ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 12 17 7"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>) },
  { id: "onboard",   label: "Onboard",   ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M12 11v6M9 14l3 3 3-3"/></svg>) },
  { id: "ai",        label: "AI core",   ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/></svg>) },
  { id: "platform",  label: "Platform",  ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>) },
  { id: "audiences", label: "For you",   ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5"/><path d="M15 14c2 0 4 1 5 3"/></svg>) },
  { id: "data",      label: "Your data", ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z"/></svg>) },
  { id: "pricing",   label: "Try free",  ico: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 7H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H7M12 4v3M12 17v3"/></svg>) },
];

function Atlas() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("top");
  const [isMobile, setIsMobile] = useState(false);
  const wrapRef = useRef(null);

  // Track viewport size for layout switch
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Active-section tracking via IntersectionObserver
  useEffect(() => {
    const els = ATLAS_SECTIONS
      .filter(s => s.id !== "top")
      .map(s => ({ id: s.id, el: document.getElementById(s.id) }))
      .filter(x => x.el);
    const onScroll = () => {
      if (window.scrollY < 200) { setActive("top"); return; }
      let cur = "top";
      const mark = window.scrollY + window.innerHeight * 0.35;
      for (const { id, el } of els) {
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (top <= mark) cur = id;
      }
      setActive(cur);
    };
    onScroll();
    let raf = 0;
    const handler = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(onScroll); };
    window.addEventListener("scroll", handler, { passive: true });
    return () => { window.removeEventListener("scroll", handler); cancelAnimationFrame(raf); };
  }, []);

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      if (e.key === "/" || (e.key === "." && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (id) => {
    if (id === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      const el = document.getElementById(id);
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
    setOpen(false);
  };

  const n = ATLAS_SECTIONS.length;
  // Diagonal cascade rising up-left from orb — no two pills share a row, so they can never overlap.
  // Mobile: tighter vertical column.
  const stepX = isMobile ? -10 : -32;
  const stepY = isMobile ? -46 : -50;
  const baseY = isMobile ? -56 : -64;
  const activeIdx = Math.max(0, ATLAS_SECTIONS.findIndex(s => s.id === active));
  // Needle still uses an angular feel for closed state
  const angularT = activeIdx / Math.max(1, n - 1);
  const needleRot = -angularT * 88;

  return (
    <div className={`atlas ${open ? "open" : ""}`} ref={wrapRef} aria-hidden={!open}>
      <div className="atlas-arc">
        {ATLAS_SECTIONS.map((s, i) => {
          // i=0 nearest orb, i=n-1 farthest. Cascade upward-leftward.
          const x = i * stepX;
          const y = baseY + i * stepY;
          return (
            <button
              key={s.id}
              type="button"
              className={`atlas-pill ${active === s.id ? "current" : ""}`}
              style={{
                "--x": `${x}px`,
                "--y": `${y}px`,
                "--d": `${(open ? i : n - 1 - i) * 0.04}s`,
              }}
              onClick={() => go(s.id)}
              tabIndex={open ? 0 : -1}
              aria-label={`Jump to ${s.label}`}
            >
              <span className="atlas-ico">{s.ico}</span>
              <span className="atlas-name">{s.label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="atlas-orb"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Close atlas" : "Open atlas"}
        title="Press / to navigate"
      >
        <span className="atlas-orb-glass"></span>
        <span className="atlas-orb-needle" style={{ transform: `rotate(${needleRot}deg)` }}>
          <i className="stem"></i>
          <i className="tip"></i>
        </span>
        <span className="atlas-orb-core"></span>
        <span className="atlas-orb-hint">{open ? "esc" : "/"}</span>
      </button>
    </div>
  );
}

/* ---------------- App ---------------- */

function App() {
  const [aud, setAud] = useState("landlord");
  return (
    <AudienceCtx.Provider value={{ aud, set: setAud }}>
      <div className={`lt-marketing t-home t-${aud}-on`}>
        <Bubbles/>
        <SpotlightLayer/>
        <Atlas/>
        <Nav/>
        <Hero/>
        <MissionControl/>
        <Onboarding/>
        <Stats/>
        <Platform/>
        <Audiences/>
        <Trust/>
        <Pricing/>
        <Final/>
        <Footer/>
      </div>
    </AudienceCtx.Provider>
  );
}

window.App = App;
