// ============================================================
// watch/screens-casual.jsx — Casual / Sunday-league variant
// Same design system, Crown picker, and dock as the league screens.
// Differences only: no competition eyebrow; teams are Team A / Team B
// identified by jersey colour (blue #60A0FF / red #FF6060); smaller
// ad-hoc, possibly-uneven squads; no formal home/away.
// ============================================================

const TEAM_A = { name: 'Team A', full: 'Team A', ab: 'A', color: '#60A0FF', jersey: 'Blue', squad: 8 };
const TEAM_B = { name: 'Team B', full: 'Team B', ab: 'B', color: '#FF6060', jersey: 'Red',  squad: 7 };

// jersey colour chip used in place of a crest
function Jersey({ color, s = 38 }) {
  return (
    <span style={{ width: s, height: s, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={s} height={s} viewBox="0 0 38 38" fill="none">
        <path d="M13 5 L7 9 L4 15 L8 18 L10 16 L10 32 a2 2 0 002 2 h14 a2 2 0 002-2 L28 16 L30 18 L34 15 L31 9 L25 5 a6 6 0 01-12 0 Z"
          fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      </svg>
    </span>
  );
}

// casual team line — jersey chip + name + jersey-colour subtitle (no home/away)
function CasualTeamLine({ team }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span className="w-bar" style={{ color: team.color, background: team.color, height: 34 }} />
      <Jersey color={team.color} s={34} />
      <div style={{ minWidth: 0 }}>
        <div className="w-disp" style={{ fontSize: 30, lineHeight: 1, letterSpacing: '0.01em' }}>{team.full}</div>
        <div style={{ fontSize: 17, color: 'var(--w-txt3)', fontWeight: 700, marginTop: 3 }}>{team.jersey} jerseys</div>
      </div>
    </div>
  );
}

// ---------------- 1 · Kickoff gate (casual) ----------------
function CasualPreMatch() {
  return (
    <div className="w-scr w-scr-pad" style={{ justifyContent: 'space-between' }}>
      <TopTime t="10:28" plain />
      {/* no competition eyebrow — just the mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Brandmark s={38} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <CasualTeamLine team={TEAM_A} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 4 }}>
          <span style={{ fontFamily: 'var(--w-disp)', fontSize: 20, color: 'var(--w-txt3)', letterSpacing: '0.1em' }}>VS</span>
          <span style={{ flex: 1, height: 1, background: 'var(--w-hair)' }} />
        </div>
        <CasualTeamLine team={TEAM_B} />
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--w-accent-b)' }}>Ready</span>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--w-txt3)' }}>· kick off anytime</span>
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

// ---------------- 2 · Live home (casual) ----------------
function CasualLiveHome() {
  return (
    <div className="w-scr" style={{ padding: '24px 26px 22px' }}>
      <div className="w-aura" />
      <TopTime t="0:31" />

      {/* period */}
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <Pill kind="live" dot>1st Half</Pill>
      </div>

      {/* sin-bin strip — identical behaviour; team referenced by jersey */}
      <button className="w-binstrip" style={{ zIndex: 2 }}>
        <span className="w-binstrip-fill" style={{ width: '76%' }} />
        <span className="w-binstrip-row">
          <GSinbin s={18} c="var(--w-amber)" />
          <span className="lbl">Sin bin · Red #7</span>
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
        <ScoreRow home={{ ...TEAM_A, score: 3 }} away={{ ...TEAM_B, score: 2 }} />
      </div>

      {/* dock */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', zIndex: 1, padding: '0 6px' }}>
        <DockBtn label="Pause"><GPause s={28} /></DockBtn>
        <DockBtn label="Log" primary><GPlus s={38} c="var(--w-accent-ink)" /></DockBtn>
        <DockBtn label="Period"><GWhistle s={30} /></DockBtn>
      </div>

      {/* Action-button → Goal hint */}
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

// ---------------- 3 · Team select (casual) ----------------
function CasualTeamSelect() {
  return (
    <div className="w-scr w-scr-pad" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'center' }}>
        <GGoal s={22} />
        <span className="w-eyebrow" style={{ fontSize: 18 }}>Goal · which team?</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[TEAM_A, TEAM_B].map((t) => (
          <button key={t.ab} className="w-btn" style={{
            flex: 1, borderRadius: 28, background: 'var(--w-surface)', justifyContent: 'space-between',
            padding: '0 22px', boxShadow: `inset 0 0 0 1.5px var(--w-hair2)`,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="w-bar" style={{ color: t.color, background: t.color, height: 50 }} />
              <Jersey color={t.color} s={42} />
              <span style={{ textAlign: 'left' }}>
                <span className="w-disp" style={{ display: 'block', fontSize: 32 }}>{t.full}</span>
                <span style={{ fontSize: 17, color: 'var(--w-txt3)', fontWeight: 700 }}>{t.squad} players · {t.jersey}</span>
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

// ---------------- 4 · Full time (casual) ----------------
function CasualFullTime() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '30px 26px 24px', textAlign: 'center' }}>
      <div className="w-aura" />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <GWhistle s={34} c="var(--w-accent-b)" />
        <div className="w-eyebrow" style={{ fontSize: 20, color: 'var(--w-accent-b)', letterSpacing: '0.16em' }}>Full time</div>
      </div>

      <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[{ t: TEAM_A, s: 4, win: true }, { t: TEAM_B, s: 3, win: false }].map(({ t, s, win }) => (
          <div key={t.ab} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="w-bar" style={{ color: t.color, background: t.color, height: 46 }} />
            <Jersey color={t.color} s={38} />
            <span className="w-disp" style={{ fontSize: 30, flex: 1, textAlign: 'left', opacity: win ? 1 : 0.72 }}>{t.full}</span>
            <span className="w-disp w-tabnum" style={{ fontSize: 58, opacity: win ? 1 : 0.72 }}>{s}</span>
          </div>
        ))}
      </div>

      <button className="w-btn w-btn-block w-btn-lg" style={{ position: 'relative', background: 'linear-gradient(180deg, #ff6a64, var(--w-red))', color: '#fff', boxShadow: '0 10px 26px rgba(255,75,68,0.3)' }}>
        <GWhistle s={26} c="#fff" /> Confirm full time
      </button>
    </div>
  );
}

// ---------------- 5 · Log → what happened? (casual, identical grid) ----------------
function CasualActionSheet() {
  const cell = {
    flex: 1, borderRadius: 22, background: 'var(--w-surface)', border: 'none', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9,
    fontFamily: 'var(--w-ui)', fontWeight: 800, fontSize: 22, color: 'var(--w-txt)',
    boxShadow: 'inset 0 0 0 1.5px var(--w-hair2)',
  };
  return (
    <div className="w-scr" style={{ padding: '20px 22px 22px', gap: 14 }}>
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

// ---------------- 6 · Log → pick player (casual Crown picker) ----------------
// Ad-hoc squad: jersey colour is the identity; first names where known,
// bare shirt number where not. Same Crown interaction as the league screen.
function CasualPlayerPick() {
  const dim = { color: 'var(--w-txt3)', opacity: 0.5 };
  return (
    <div className="w-scr" style={{ padding: '22px 22px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'center' }}>
        <Jersey color={TEAM_A.color} s={22} />
        <span className="w-eyebrow" style={{ fontSize: 18 }}>{TEAM_A.full} · scorer?</span>
      </div>

      <CrownInd pos={0.18} frac={0.3} h={170} />
      <div className="w-crownhint" style={{ right: 20, top: 150 }}>
        <span>Turn</span><span className="ring" />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {/* dim neighbour above */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...dim }}>
          <Shirt n={7} size={42} ring={TEAM_A.color} />
          <span className="w-disp" style={{ fontSize: 24 }}>Jay</span>
        </div>
        {/* focused */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 18, width: '100%',
          background: 'var(--w-surface)', borderRadius: 26, padding: '14px 20px',
          boxShadow: 'inset 0 0 0 2px var(--w-accent-d)',
        }}>
          <Shirt n={9} size={66} ring="var(--w-accent)" />
          <div style={{ minWidth: 0 }}>
            <div className="w-disp" style={{ fontSize: 34, lineHeight: 1 }}>Sam</div>
            <div style={{ fontSize: 18, color: 'var(--w-txt2)', fontWeight: 700, marginTop: 3 }}>Blue team</div>
          </div>
        </div>
        {/* dim neighbour below — no name on file, number only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...dim }}>
          <Shirt n={5} size={42} ring={TEAM_A.color} />
          <span className="w-disp" style={{ fontSize: 24 }}>Blue #5</span>
        </div>
      </div>

      <button className="w-btn w-btn-primary w-btn-block" style={{ height: 64, fontSize: 25, borderRadius: 26 }}>
        Choose #9 Sam <GChev s={22} c="var(--w-accent-ink)" />
      </button>
    </div>
  );
}

// ---------------- 7 · Card confirmation (casual) ----------------
function CasualCardConfirm() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '34px 28px 24px', textAlign: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 45% at 50% 32%, rgba(245,197,24,0.18), transparent 70%)' }} />
      <TopTime t="1:04" plain />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, marginTop: 6 }}>
        <GCard w={78} h={104} />
        <div className="w-disp" style={{ fontSize: 40, color: 'var(--w-yellow)', letterSpacing: '0.02em' }}>Yellow</div>
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Shirt n={4} size={56} ring={TEAM_B.color} />
        <div style={{ textAlign: 'left' }}>
          <div className="w-disp" style={{ fontSize: 32, lineHeight: 1 }}>Marcus</div>
          <div style={{ fontSize: 18, color: 'var(--w-txt2)', fontWeight: 700, marginTop: 3 }}>Red team · 24&apos;</div>
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex', gap: 12, width: '100%' }}>
        <button className="w-btn" style={{ flex: 1, height: 64, fontSize: 23, background: 'var(--w-surface2)', color: 'var(--w-txt2)' }}>
          <GUndo s={24} /> Undo
        </button>
        <button className="w-btn w-btn-primary" style={{ flex: 1.4, height: 64, fontSize: 24 }}>
          <GCheck s={26} c="var(--w-accent-ink)" /> Confirm
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  TEAM_A, TEAM_B, Jersey, CasualTeamLine,
  CasualPreMatch, CasualLiveHome, CasualTeamSelect, CasualFullTime,
  CasualActionSheet, CasualPlayerPick, CasualCardConfirm,
});
