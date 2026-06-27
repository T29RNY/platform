// ============================================================
// watch/frame.jsx — Apple Watch case chrome (Ultra 49mm + Series 45mm)
// + crafted glyphs + shared screen atoms. No emoji.
// ============================================================
const { useState, useEffect, useRef } = React;

// ---- exact geometry (shared so artboards size to the case) ----
const DIMS = {
  ultra:  { sw: 410, sh: 502, pad: 20, crownP: 11, actionP: 10, leftPad: 10, screenR: 72, frameR: 92 },
  series: { sw: 396, sh: 480, pad: 18, crownP: 10, actionP: 0,  leftPad: 6,  screenR: 86, frameR: 104 },
};
function wrapSize(size) {
  const d = DIMS[size];
  const fw = d.sw + d.pad * 2, fh = d.sh + d.pad * 2;
  return { w: fw + d.leftPad + d.crownP, h: fh, fw, fh, d };
}
window.WATCH_DIMS = { ultra: wrapSize('ultra'), series: wrapSize('series') };

// =================== glyphs ===================
function GGoal({ s = 30 }) { return <span className="w-goaldot" style={{ width: s, height: s }} />; }
function GCard({ red, w = 30, h = 40 }) { return <span className={'w-card ' + (red ? 'r' : 'y')} style={{ width: w, height: h }} />; }
function GSub({ s = 34 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 34 34" fill="none">
      <path d="M10 22V8M10 8L5.5 12.5M10 8l4.5 4.5" stroke="var(--w-green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M24 12v14M24 26l4.5-4.5M24 26l-4.5-4.5" stroke="var(--w-red)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function GPause({ s = 30, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 28 28"><rect x="5" y="3" width="6.4" height="22" rx="2.4" fill={c}/><rect x="16.6" y="3" width="6.4" height="22" rx="2.4" fill={c}/></svg>; }
function GPlay({ s = 30, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 28 28"><path d="M7 4.2v19.6a1 1 0 001.53.85l15.4-9.8a1 1 0 000-1.7L8.53 3.35A1 1 0 007 4.2z" fill={c}/></svg>; }
function GWhistle({ s = 34, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 34 34" fill="none"><circle cx="13" cy="20" r="8.2" stroke={c} strokeWidth="3"/><path d="M21 16.5L31.5 12.5v7.4L21 15.8M13 11.4V6.5h6" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function GSinbin({ s = 30, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 30 30" fill="none"><circle cx="15" cy="16.5" r="10" stroke={c} strokeWidth="2.6"/><path d="M15 11.5v5.2l3.4 2.2M15 4h0M11 4h8" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function GCheck({ s = 28, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 28 28" fill="none"><path d="M5 14.5l6 6 12-13" stroke={c} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function GUndo({ s = 26, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 26 26" fill="none"><path d="M7 9H16a6 6 0 110 12H9M7 9l4-4M7 9l4 4" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function GMore({ s = 30, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 30 30" fill={c}><circle cx="7" cy="15" r="2.6"/><circle cx="15" cy="15" r="2.6"/><circle cx="23" cy="15" r="2.6"/></svg>; }
function GChev({ s = 24, c = 'currentColor', style }) { return <svg style={style} width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function GPlus({ s = 30, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 30 30" fill="none"><path d="M15 6v18M6 15h18" stroke={c} strokeWidth="3.4" strokeLinecap="round"/></svg>; }
function GFlag({ s = 28, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 28 28" fill="none"><path d="M7 4v20" stroke={c} strokeWidth="3" strokeLinecap="round"/><path d="M7 5h14l-3 4 3 4H7z" fill={c}/></svg>; }
function GWarn({ s = 30, c = 'currentColor' }) { return <svg width={s} height={s} viewBox="0 0 30 30" fill="none"><path d="M15 4l12 21H3L15 4z" stroke={c} strokeWidth="2.6" strokeLinejoin="round"/><path d="M15 12v6" stroke={c} strokeWidth="2.6" strokeLinecap="round"/><circle cx="15" cy="21.5" r="1.5" fill={c}/></svg>; }

// =================== watch case ===================
function Watch({ size = 'ultra', children }) {
  const { w, h, fw, fh, d } = wrapSize(size);
  const isUltra = size === 'ultra';
  return (
    <div className={'w-case w-case-' + size} style={{ width: w, height: h, position: 'relative' }}>
      <div className="w-frame" style={{
        position: 'absolute', left: d.leftPad, top: 0, width: fw, height: fh, borderRadius: d.frameR,
      }}>
        {/* OLED screen */}
        <div className="w-screen" style={{ position: 'absolute', inset: d.pad, borderRadius: d.screenR }}>
          {children}
        </div>

        {/* Digital Crown */}
        <div className="w-crown" style={{
          top: isUltra ? fh * 0.30 : fh * 0.30, width: isUltra ? 17 : 15,
          height: isUltra ? 52 : 46, borderRadius: '4px 7px 7px 4px',
          marginLeft: -1,
        }} />
        {/* side button */}
        <div className="w-sidebtn" style={{
          top: isUltra ? fh * 0.30 + 70 : fh * 0.30 + 60, width: isUltra ? 13 : 12,
          height: isUltra ? 84 : 70, borderRadius: '3px 6px 6px 3px', marginLeft: -1,
        }} />

        {isUltra && (
          <>
            {/* Action Button (orange, left) */}
            <div className="w-action" style={{
              top: fh * 0.40, width: 13, height: 66, borderRadius: '6px 3px 3px 6px', marginRight: -1,
            }} />
            {/* mic/speaker vent */}
            <div className="w-vent" style={{ top: fh * 0.62, width: 8, height: 40, marginRight: -1 }} />
          </>
        )}
      </div>
    </div>
  );
}

// =================== shared screen atoms ===================
function TopTime({ t = '15:47', plain }) { return <div className={'w-time' + (plain ? ' plain' : '')}>{t}</div>; }

function Pill({ kind, dot, children }) {
  return (
    <span className={'w-pill' + (kind ? ' ' + kind : '')}>
      {dot && <span className="w-livedot" />}
      {children}
    </span>
  );
}

// compact two-team score row with colour bars
function ScoreRow({ home, away }) {
  return (
    <div className="w-scorerow">
      <div className="w-team-mini">
        <span className="w-bar" style={{ color: home.color, background: home.color, height: 44 }} />
        <span className="ab">{home.ab}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span className="w-bignum">{home.score}</span>
        <span className="w-bignum" style={{ color: 'var(--w-txt3)', fontSize: 34 }}>–</span>
        <span className="w-bignum">{away.score}</span>
      </div>
      <div className="w-team-mini away">
        <span className="w-bar" style={{ color: away.color, background: away.color, height: 44 }} />
        <span className="ab">{away.ab}</span>
      </div>
    </div>
  );
}

// Digital-Crown scroll indicator (right edge)
function CrownInd({ pos = 0.5, frac = 0.34, h = 150 }) {
  return (
    <div className="w-crownind" style={{ height: h }}>
      <div className="thumb" style={{ height: `${frac * 100}%`, top: `${pos * (1 - frac) * 100}%` }} />
    </div>
  );
}

// shirt token
function Shirt({ n, size = 56, color, sentOff, ring }) {
  return (
    <span className="w-shirt" style={{
      width: size, height: size, fontSize: size * 0.42, borderRadius: size * 0.32,
      boxShadow: ring ? `inset 0 0 0 2.5px ${ring}` : undefined,
      opacity: sentOff ? 0.5 : 1,
    }}>
      {color && <span style={{ position: 'absolute' }} />}{n}
    </span>
  );
}

Object.assign(window, {
  Watch, DIMS, TopTime, Pill, ScoreRow, CrownInd, Shirt,
  GGoal, GCard, GSub, GPause, GPlay, GWhistle, GSinbin, GCheck, GUndo, GMore, GChev, GPlus, GFlag, GWarn,
});
