// ============================================================
// watch/screens-b.jsx — card / sub / period / sin-bin / log / result
// ============================================================

// ---------------- 4a · Card confirmation moment ----------------
function CardConfirm() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '34px 28px 24px', textAlign: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 45% at 50% 32%, rgba(245,197,24,0.18), transparent 70%)' }} />
      <TopTime t="3:48" plain />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, marginTop: 6 }}>
        <GCard w={78} h={104} />
        <div className="w-disp" style={{ fontSize: 40, color: 'var(--w-yellow)', letterSpacing: '0.02em' }}>Yellow</div>
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Shirt n={8} size={56} ring={HOME.color} />
        <div style={{ textAlign: 'left' }}>
          <div className="w-disp" style={{ fontSize: 32, lineHeight: 1 }}>L. Mendes</div>
          <div style={{ fontSize: 18, color: 'var(--w-txt2)', fontWeight: 700, marginTop: 3 }}>{HOME.full} · 24&apos;</div>
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

// ---------------- 4b · 2nd yellow → red ----------------
function SecondYellow() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '34px 28px 24px', textAlign: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 45% at 50% 34%, rgba(255,75,68,0.16), transparent 70%)' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GWarn s={28} c="var(--w-amber)" />
          <span className="w-eyebrow" style={{ fontSize: 19, color: 'var(--w-amber)' }}>Second yellow</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GCard w={34} h={46} />
          <GChev s={26} c="var(--w-txt3)" />
          <GCard red w={34} h={46} />
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <div className="w-disp" style={{ fontSize: 30, lineHeight: 1.05 }}>#8 Mendes is<br />already booked</div>
        <div style={{ fontSize: 20, color: 'var(--w-txt2)', fontWeight: 700, marginTop: 12, lineHeight: 1.35 }}>
          This logs a 2nd yellow <b style={{ color: 'var(--w-red)' }}>and a red</b> — he is sent off.
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex', gap: 12, width: '100%' }}>
        <button className="w-btn" style={{ flex: 1, height: 64, fontSize: 23, background: 'var(--w-surface2)', color: 'var(--w-txt2)' }}>Cancel</button>
        <button className="w-btn" style={{ flex: 1.2, height: 64, fontSize: 24, background: 'linear-gradient(180deg, #ff6a64, var(--w-red))', color: '#fff', boxShadow: '0 10px 26px rgba(255,75,68,0.3)' }}>Send off</button>
      </div>
    </div>
  );
}

// ---------------- 5 · Substitution (off → on, Crown) ----------------
function Substitution() {
  return (
    <div className="w-scr" style={{ padding: '22px 24px 22px', gap: 14 }}>
      <div className="w-eyebrow" style={{ textAlign: 'center', fontSize: 18 }}>Substitution · {HOME.full}</div>

      {/* OFF */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--w-surface)', borderRadius: 22, padding: '12px 18px', boxShadow: 'inset 0 0 0 1.5px var(--w-hair2)' }}>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none"><path d="M21 10v14M21 24l4.5-4.5M21 24l-4.5-4.5" stroke="var(--w-red)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--w-red)', width: 38 }}>OFF</span>
        <Shirt n={9} size={48} />
        <div className="w-disp" style={{ fontSize: 26 }}>J. Cole</div>
      </div>

      {/* ON — crown picker */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--w-surface)', borderRadius: 22, padding: '4px 18px', boxShadow: 'inset 0 0 0 2px var(--w-green)' }}>
        <CrownInd pos={0.5} frac={0.36} h={120} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: 0.45 }}>
          <span style={{ width: 38 }} /><Shirt n={12} size={36} /><span className="w-disp" style={{ fontSize: 20 }}>R. Vela</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0' }}>
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none"><path d="M9 20V6M9 6L4.5 10.5M9 6l4.5 4.5" stroke="var(--w-green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <Shirt n={16} size={52} ring="var(--w-green)" />
          <div className="w-disp" style={{ fontSize: 28 }}>S. Park</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: 0.45 }}>
          <span style={{ width: 38 }} /><Shirt n={18} size={36} /><span className="w-disp" style={{ fontSize: 20 }}>N. Osei</span>
        </div>
      </div>

      <button className="w-btn w-btn-primary w-btn-block" style={{ height: 64, fontSize: 24 }}><GCheck s={26} c="var(--w-accent-ink)" /> Confirm sub</button>
    </div>
  );
}

// ---------------- 6 · Period control / half-time moment ----------------
function HalfTime() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '32px 28px 24px', textAlign: 'center' }}>
      <div className="w-aura" />
      <div style={{ position: 'relative' }}>
        <div className="w-eyebrow" style={{ fontSize: 18, marginBottom: 6 }}>End of</div>
        <div className="w-disp" style={{ fontSize: 52, letterSpacing: '0.01em' }}>Half-time</div>
        <div className="w-disp w-tabnum" style={{ fontSize: 26, color: 'var(--w-accent-b)', marginTop: 6 }}>45:00 <span style={{ color: 'var(--w-txt3)' }}>+2</span></div>
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        <ScoreRow home={{ ...HOME, score: 2 }} away={{ ...AWAY, score: 0 }} />
      </div>

      <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <span className="w-pill amber"><GSinbin s={20} c="var(--w-amber)" /> Logging paused</span>
        <button className="w-btn w-btn-primary w-btn-block w-btn-lg"><GPlay s={28} c="var(--w-accent-ink)" /> Start 2nd half</button>
      </div>
    </div>
  );
}

// ---------------- 7 · Sin-bin countdown ----------------
function Ring({ size = 220, stroke = 14, frac = 0.767, color = 'var(--w-amber)', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="w-ringwrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          style={{ filter: 'drop-shadow(0 0 8px rgba(251,166,58,0.5))' }} />
      </svg>
      <div className="inner">{children}</div>
    </div>
  );
}
function SinBin() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <GChev s={20} c="var(--w-txt3)" style={{ transform: 'rotate(180deg)' }} />
        <span className="w-pill amber"><GSinbin s={20} c="var(--w-amber)" /> Sin bin</span>
      </div>
      <Ring size={236} stroke={15} frac={0.767}>
        <div className="w-disp w-tabnum" style={{ fontSize: 64, color: 'var(--w-amber)', lineHeight: 1 }}>1:32</div>
        <div style={{ fontSize: 17, color: 'var(--w-txt3)', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>remaining</div>
      </Ring>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Shirt n={14} size={50} ring="var(--w-amber)" color />
        <div style={{ textAlign: 'left' }}>
          <div className="w-disp" style={{ fontSize: 28, lineHeight: 1 }}>T. Oakes</div>
          <div style={{ fontSize: 17, color: 'var(--w-txt2)', fontWeight: 700, marginTop: 2 }}>{AWAY.full} · 2 min</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, width: '100%' }}>
        <button className="w-btn" style={{ flex: 1, height: 58, fontSize: 21, background: 'var(--w-surface2)', color: 'var(--w-txt2)' }}>End early</button>
        <button className="w-btn" style={{ flex: 1, height: 58, fontSize: 21, background: 'var(--w-surface2)', color: 'var(--w-accent-b)' }}><GChev s={20} c="var(--w-accent-b)" style={{ transform: 'rotate(180deg)' }} /> Match</button>
      </div>
    </div>
  );
}

// ---------------- 7b · May-return alert ----------------
function MayReturn() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '34px 28px 24px', textAlign: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 45% at 50% 34%, rgba(251,166,58,0.18), transparent 70%)' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 8 }}>
        <span className="w-pill amber" style={{ fontSize: 22 }}><GSinbin s={22} c="var(--w-amber)" /> May return</span>
        <div style={{ width: 92, height: 92, borderRadius: '50%', background: 'rgba(251,166,58,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 2.5px var(--w-amber)' }}>
          <GSinbin s={48} c="var(--w-amber)" />
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <div className="w-disp" style={{ fontSize: 34 }}>#14 Oakes</div>
        <div style={{ fontSize: 20, color: 'var(--w-txt2)', fontWeight: 700, marginTop: 8 }}>Sin bin complete · 2:00 served</div>
      </div>
      <div style={{ position: 'relative', display: 'flex', gap: 12, width: '100%' }}>
        <button className="w-btn" style={{ flex: 1, height: 64, fontSize: 22, background: 'var(--w-surface2)', color: 'var(--w-txt2)' }}>Keep off</button>
        <button className="w-btn" style={{ flex: 1.3, height: 64, fontSize: 23, background: 'linear-gradient(180deg, #4ad98a, var(--w-green))', color: '#04231a' }}><GCheck s={24} c="#04231a" /> Bring on</button>
      </div>
    </div>
  );
}

// ---------------- 8 · Match log / timeline ----------------
function MatchLog() {
  const rows = [
    { min: "23'", glyph: <GGoal s={22} />, lbl: 'Goal · #9 Cole', sub: HOME.full, sync: 'ok' },
    { min: "24'", glyph: <GCard w={18} h={24} />, lbl: 'Yellow · #8 Mendes', sub: HOME.full, sync: 'ok' },
    { min: "20'", glyph: <GSub s={24} />, lbl: 'Sub · 16 ▸ 19', sub: AWAY.full, sync: 'pend' },
    { min: "14'", glyph: <GSinbin s={22} c="var(--w-amber)" />, lbl: 'Sin bin · #14 Oakes', sub: AWAY.full, sync: 'ok' },
    { min: "8'", glyph: <GGoal s={22} />, lbl: 'Goal · #11 Quinn', sub: HOME.full, sync: 'ok' },
  ];
  return (
    <div className="w-scr" style={{ padding: '22px 22px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="w-eyebrow" style={{ fontSize: 19 }}>Match log</span>
        <span className="w-disp w-tabnum" style={{ fontSize: 22, color: 'var(--w-accent-b)' }}>23&apos;</span>
      </div>
      <CrownInd pos={0} frac={0.5} h={170} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div className="w-logrow" key={i}>
            <span className="min">{r.min}</span>
            <span style={{ width: 26, display: 'flex', justifyContent: 'center', flex: 'none' }}>{r.glyph}</span>
            <span className="lbl">{r.lbl}<small>{r.sub}</small></span>
            <span className={'w-syncdot ' + r.sync} />
          </div>
        ))}
      </div>
      <button className="w-btn w-btn-block" style={{ height: 56, fontSize: 21, background: 'var(--w-surface2)', color: 'var(--w-accent-b)', marginTop: 6 }}><GUndo s={22} c="var(--w-accent-b)" /> Undo last event</button>
    </div>
  );
}

// ---------------- 9 · Full-time + result ----------------
function FullTime() {
  return (
    <div className="w-scr" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '30px 26px 24px', textAlign: 'center' }}>
      <div className="w-aura" />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <GWhistle s={34} c="var(--w-accent-b)" />
        <div className="w-eyebrow" style={{ fontSize: 20, color: 'var(--w-accent-b)', letterSpacing: '0.16em' }}>Full time</div>
      </div>

      <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[{ t: HOME, s: 2, win: true }, { t: AWAY, s: 1, win: false }].map(({ t, s, win }) => (
          <div key={t.ab} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="w-bar" style={{ color: t.color, background: t.color, height: 46 }} />
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

Object.assign(window, {
  CardConfirm, SecondYellow, Substitution, HalfTime, Ring, SinBin, MayReturn, MatchLog, FullTime,
});
