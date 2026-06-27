// ============================================================
// watch/screens-a.jsx — match data + setup / live / logging screens
// Each component renders the inner content of a .w-screen.
// ============================================================

const HOME = { name: 'Riverside', full: 'Riverside FC', ab: 'RIV', color: '#3B74E8' };
const AWAY = { name: 'Rothwell', full: 'Rothwell Town', ab: 'ROT', color: '#E64034' };
const RIV = [
  { n: 9, name: 'J. Cole', role: 'Striker' },
  { n: 8, name: 'L. Mendes', role: 'Midfield' },
  { n: 7, name: 'A. Rai', role: 'Winger' },
  { n: 11, name: 'D. Quinn', role: 'Forward' },
  { n: 16, name: 'S. Park', role: 'Bench' },
  { n: 4, name: 'K. Boateng', role: 'Defender' },
];

function Brandmark({ s = 40 }) {
  return (
    <span style={{
      width: s, height: s, borderRadius: s * 0.3, flex: 'none',
      background: 'linear-gradient(150deg, var(--w-accent-b), var(--w-accent-d))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 0 18px -2px var(--w-glow)',
    }}>
      <GWhistle s={s * 0.56} c="var(--w-accent-ink)" />
    </span>
  );
}

function TeamLine({ team, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span className="w-bar" style={{ color: team.color, background: team.color, height: 34 }} />
      <div style={{ minWidth: 0 }}>
        <div className="w-disp" style={{ fontSize: 30, lineHeight: 1, letterSpacing: '0.01em' }}>{team.full}</div>
        {sub && <div style={{ fontSize: 17, color: 'var(--w-txt3)', fontWeight: 700, marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ---------------- 1 · Pre-match / kickoff gate ----------------
function PreMatch() {
  return (
    <div className="w-scr w-scr-pad" style={{ justifyContent: 'space-between' }}>
      <TopTime t="14:02" plain />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Brandmark s={38} />
        <div className="w-eyebrow" style={{ fontSize: 17 }}>U18 League · Rd 12</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <TeamLine team={HOME} sub="Home · navy" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 4 }}>
          <span style={{ fontFamily: 'var(--w-disp)', fontSize: 20, color: 'var(--w-txt3)', letterSpacing: '0.1em' }}>VS</span>
          <span style={{ flex: 1, height: 1, background: 'var(--w-hair)' }} />
        </div>
        <TeamLine team={AWAY} sub="Away · red" />
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--w-accent-b)' }}>Kicks off 14:15</span>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--w-txt3)' }}>· unlocked</span>
        </div>
        <button className="w-btn w-btn-primary w-btn-block w-btn-lg" style={{ position: 'relative', overflow: 'hidden' }}>
          <span style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: '34%',
            background: 'rgba(4,32,29,0.18)',
          }} />
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid var(--w-accent-ink)', borderTopColor: 'transparent', display: 'inline-block' }} />
            Hold to start
          </span>
        </button>
        <div style={{ textAlign: 'center', fontSize: 16, color: 'var(--w-txt3)', fontWeight: 700, marginTop: 10 }}>
          Press &amp; hold 3s · or Action button
        </div>
      </div>
    </div>
  );
}

// ---------------- 2 · Live match home (hero) ----------------
function LiveHome() {
  return (
    <div className="w-scr" style={{ padding: '24px 26px 22px' }}>
      <div className="w-aura" />
      <TopTime t="3:47" />

      {/* period */}
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <Pill kind="live" dot>1st Half</Pill>
      </div>

      {/* sin-bin strip — persistent, glanceable, never blocks logging.
          Tap to open the manage screen. Stacks if >1 bin is running. */}
      <button className="w-binstrip" style={{ zIndex: 2 }}>
        <span className="w-binstrip-fill" style={{ width: '76%' }} />
        <span className="w-binstrip-row">
          <GSinbin s={18} c="var(--w-amber)" />
          <span className="lbl">Sin bin · ROT #14</span>
          <span className="t w-tabnum">1:32</span>
          <GChev s={16} c="var(--w-amber)" />
        </span>
      </button>

      {/* clock */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1, gap: 4 }}>
        <div className="w-clock" style={{ fontSize: 92 }}>23:14</div>
        <div className="w-eyebrow" style={{ fontSize: 18, color: 'var(--w-accent-b)', letterSpacing: '0.14em' }}>+2 min added</div>
      </div>

      {/* score */}
      <div style={{ position: 'relative', zIndex: 1, marginBottom: 18 }}>
        <ScoreRow home={{ ...HOME, score: 2 }} away={{ ...AWAY, score: 0 }} />
      </div>

      {/* dock */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', zIndex: 1, padding: '0 6px' }}>
        <DockBtn label="Pause"><GPause s={28} /></DockBtn>
        <DockBtn label="Log" primary><GPlus s={38} c="var(--w-accent-ink)" /></DockBtn>
        <DockBtn label="Period"><GWhistle s={30} /></DockBtn>
      </div>

      {/* Action-button → Goal hint, aligned to physical button (left, ~40%) */}
      <div style={{
        position: 'absolute', left: 0, top: '38%', zIndex: 4,
        display: 'flex', alignItems: 'center', gap: 7,
        background: 'rgba(241,89,31,0.16)', color: '#FF8A3C',
        padding: '6px 12px 6px 8px', borderRadius: '0 12px 12px 0',
        fontSize: 16, fontWeight: 800, letterSpacing: '0.02em',
      }}>
        <span style={{ width: 7, height: 26, borderRadius: 3, background: '#F1591F' }} />
        Goal
      </div>
    </div>
  );
}
function DockBtn({ label, primary, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
      <button className={'w-circle' + (primary ? ' primary' : '')}>{children}</button>
      <span style={{ fontSize: 17, fontWeight: 800, color: primary ? 'var(--w-accent-b)' : 'var(--w-txt3)' }}>{label}</span>
    </div>
  );
}

// ---------------- 3a · Log → pick team ----------------
function TeamSelect() {
  return (
    <div className="w-scr w-scr-pad" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'center' }}>
        <GGoal s={22} />
        <span className="w-eyebrow" style={{ fontSize: 18 }}>Goal · which team?</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[HOME, AWAY].map((t) => (
          <button key={t.ab} className="w-btn" style={{
            flex: 1, borderRadius: 28, background: 'var(--w-surface)', justifyContent: 'space-between',
            padding: '0 22px', boxShadow: `inset 0 0 0 1.5px var(--w-hair2)`,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="w-bar" style={{ color: t.color, background: t.color, height: 50 }} />
              <span style={{ textAlign: 'left' }}>
                <span className="w-disp" style={{ display: 'block', fontSize: 32 }}>{t.full}</span>
                <span style={{ fontSize: 17, color: 'var(--w-txt3)', fontWeight: 700 }}>Squad of 16</span>
              </span>
            </span>
            <GChev s={26} c="var(--w-txt3)" />
          </button>
        ))}
      </div>
      <button className="w-btn w-btn-block" style={{ height: 56, fontSize: 22, background: 'var(--w-surface2)', color: 'var(--w-txt2)' }}>Cancel</button>
    </div>
  );
}

// ---------------- 3b · Log → pick player (Digital Crown) ----------------
function PlayerPick() {
  const focusIdx = 0; // #9 Cole focused
  const dim = { color: 'var(--w-txt3)', opacity: 0.5 };
  return (
    <div className="w-scr" style={{ padding: '22px 22px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
        <GGoal s={20} />
        <span className="w-eyebrow" style={{ fontSize: 18 }}>{HOME.full} · scorer?</span>
      </div>

      <CrownInd pos={0.18} frac={0.3} h={170} />
      <div className="w-crownhint" style={{ right: 20, top: 150 }}>
        <span>Turn</span><span className="ring" />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {/* dim neighbour above */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...dim }}>
          <Shirt n={7} size={42} />
          <span className="w-disp" style={{ fontSize: 24 }}>A. Rai</span>
        </div>
        {/* focused */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 18, width: '100%',
          background: 'var(--w-surface)', borderRadius: 26, padding: '14px 20px',
          boxShadow: 'inset 0 0 0 2px var(--w-accent-d)',
        }}>
          <Shirt n={9} size={66} ring="var(--w-accent)" />
          <div style={{ minWidth: 0 }}>
            <div className="w-disp" style={{ fontSize: 34, lineHeight: 1 }}>J. Cole</div>
            <div style={{ fontSize: 18, color: 'var(--w-txt2)', fontWeight: 700, marginTop: 3 }}>Striker</div>
          </div>
        </div>
        {/* dim neighbour below */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...dim }}>
          <Shirt n={8} size={42} />
          <span className="w-disp" style={{ fontSize: 24 }}>L. Mendes</span>
        </div>
      </div>

      <button className="w-btn w-btn-primary w-btn-block" style={{ height: 64, fontSize: 25, borderRadius: 26 }}>
        Choose #9 Cole <GChev s={22} c="var(--w-accent-ink)" />
      </button>
    </div>
  );
}

// ---------------- 3c · Log → action sheet ----------------
function ActionSheet() {
  const cell = {
    flex: 1, borderRadius: 22, background: 'var(--w-surface)', border: 'none', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9,
    fontFamily: 'var(--w-ui)', fontWeight: 800, fontSize: 22, color: 'var(--w-txt)',
    boxShadow: 'inset 0 0 0 1.5px var(--w-hair2)',
  };
  return (
    <div className="w-scr" style={{ padding: '20px 22px 22px', gap: 14 }}>
      {/* entry point — no player yet; ref logs WHAT happened first */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
        <span className="w-disp w-tabnum" style={{ fontSize: 22, color: 'var(--w-accent-b)' }}>23&apos;</span>
        <span className="w-eyebrow" style={{ fontSize: 18 }}>What happened?</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flex: 1 }}>
          <button style={{ ...cell, background: 'linear-gradient(180deg, rgba(25,216,196,0.20), rgba(25,216,196,0.06))', boxShadow: 'inset 0 0 0 1.5px var(--w-accent-d)' }}>
            <GGoal s={34} /><span style={{ color: 'var(--w-accent-b)' }}>Goal</span>
          </button>
          <button style={cell}><GCard w={26} h={34} /><span>Yellow</span></button>
        </div>
        <div style={{ display: 'flex', gap: 12, flex: 1 }}>
          <button style={cell}><GCard red w={26} h={34} /><span>Red</span></button>
          <button style={cell}><GSub s={34} /><span>Sub</span></button>
        </div>
        <div style={{ display: 'flex', gap: 12, height: 70 }}>
          <button style={{ ...cell, flexDirection: 'row', gap: 12, boxShadow: 'inset 0 0 0 1.5px rgba(251,166,58,0.4)', color: 'var(--w-amber)', fontSize: 21 }}>
            <GSinbin s={28} c="var(--w-amber)" />Sin bin
          </button>
          <button style={{ ...cell, flexDirection: 'row', gap: 10, boxShadow: 'inset 0 0 0 1.5px rgba(240,116,60,0.4)', color: 'var(--w-og)', fontSize: 21 }}>
            <span className="w-goaldot" style={{ width: 22, height: 22, background: 'var(--w-surface2)', boxShadow: 'inset 0 0 0 2px var(--w-og)' }} />Own goal
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  HOME, AWAY, RIV, Brandmark, TeamLine, DockBtn,
  PreMatch, LiveHome, TeamSelect, PlayerPick, ActionSheet,
});
