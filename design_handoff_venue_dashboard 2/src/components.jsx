/* Shared components: crests, fixture cards, pills, modal scaffold */

const { useState, useEffect, useMemo, useRef } = React;

// Icon proxy — actual SVGs defined in app.jsx, exposed via window.Icon
const Icon = (props) => window.Icon ? React.createElement(window.Icon, props) : null;

function Crest({ c1, c2, size = 28, initials, big = false }) {
  const radius = big ? Math.round(size * 0.27) : Math.round(size * 0.30);
  return (
    <div className="crest"
         style={{ width: size, height: size, borderRadius: radius,
                  position: 'relative', overflow: 'hidden',
                  border: '1px solid var(--border-strong)',
                  display: 'inline-grid', placeItems: 'center', flex: 'none' }}>
      <div className="gradient" style={{ position: 'absolute', inset: 0,
                    background: `linear-gradient(135deg, ${c1} 0 50%, ${c2} 50% 100%)` }} />
      {initials && (
        <span className="glyph" style={{ position: 'relative',
                       fontSize: big ? Math.round(size * 0.32) : Math.round(size * 0.40),
                       fontWeight: 700, color: 'white',
                       textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                       letterSpacing: '-0.02em' }}>
          {initials}
        </span>
      )}
    </div>
  );
}

function TeamCrest({ teamId, big = false, size }) {
  const t = window.DATA_teams[teamId];
  if (!t) return null;
  return <Crest c1={t.primary_colour} c2={t.secondary_colour}
                size={size || (big ? 52 : 28)}
                initials={getInitials(t.name)} big={big} />;
}

function StatusPill({ status }) {
  const map = {
    scheduled:   { cls: 'pill-muted', label: 'Needs pitch' },
    needs_pitch: { cls: 'pill-warn',  label: 'Needs pitch' },
    needs_ref:   { cls: 'pill-warn',  label: 'Needs ref' },
    allocated:   { cls: 'pill-muted', label: 'All set' },
    in_progress: { cls: 'pill-live',  label: 'Live' },
    completed:   { cls: 'pill-ok',    label: 'Result' },
    postponed:   { cls: 'pill-muted', label: 'Postponed' },
    void:        { cls: 'pill-muted', label: 'Void' },
    walkover:    { cls: 'pill-warn',  label: 'Walkover' },
    forfeit:     { cls: 'pill-warn',  label: 'Forfeit' },
  };
  const c = map[status] || map.scheduled;
  return (
    <span className={'pill ' + c.cls}>
      <span className="pill-dot" /> {c.label}
    </span>
  );
}

function deriveStatusForCard(fx) {
  if (fx.status === 'scheduled' && !fx.playing_area_id) return 'needs_pitch';
  if (fx.status === 'allocated' && !fx.official_id) return 'needs_ref';
  return fx.status;
}

function FixtureCard({ fx, onPitch, onRef, onStatus, currentMinute = 0 }) {
  const home = window.DATA_teams[fx.home_team_id];
  const away = window.DATA_teams[fx.away_team_id];
  const pitch = window.DATA_pitches.find(p => p.id === fx.playing_area_id);
  const ref = window.DATA_refs.find(r => r.id === fx.official_id);
  const status = deriveStatusForCard(fx);
  const live = fx.status === 'in_progress';
  const completed = fx.status === 'completed';
  const showScore = live || completed || fx.home_score != null;
  const cls = ['fxc',
    live && 'fxc--live',
    completed && 'fxc--completed',
    ['postponed','void','walkover','forfeit'].includes(fx.status) && ('fxc--' + fx.status),
  ].filter(Boolean).join(' ');
  const progressPct = live ? Math.min(100, (currentMinute / 90) * 100)
                     : completed ? 100
                     : 0;

  return (
    <article className={cls}>
      <header className="fxc-head">
        <span className="when">{window.dayLabel(fx.scheduled_date)} {fx.kickoff_time}</span>
        <span className="dot" />
        <span className="meta">{fx.round_name}</span>
        <span className="spacer" />
        {live
          ? <span className="pill pill-live"><span className="pill-dot" />Live &middot; {currentMinute}'</span>
          : <StatusPill status={status} />}
      </header>
      <div className="fxc-body">
        <div className="fxc-team">
          <Crest c1={home.primary_colour} c2={home.secondary_colour} size={28} initials={getInitials(home.name)} />
          <span className="name">{home.name}</span>
        </div>
        {showScore
          ? <div className="fxc-score">{fx.home_score ?? '–'}</div>
          : <div className="fxc-score vs">vs</div>}
        <div className="fxc-team">
          <Crest c1={away.primary_colour} c2={away.secondary_colour} size={28} initials={getInitials(away.name)} />
          <span className="name">{away.name}</span>
        </div>
        {showScore
          ? <div className="fxc-score">{fx.away_score ?? '–'}</div>
          : <div className="fxc-score vs"></div>}
      </div>
      {(live || completed) && (
        <div className="fxc-progress">
          <div className="fxc-progress-fill" style={{ width: progressPct + '%' }} />
        </div>
      )}
      {fx.status === 'walkover' && (
        <div className="text-mute" style={{ fontSize: 12, marginBottom: 14 }}>
          Walkover — winner: <strong style={{ color: 'var(--ink)' }}>{window.DATA_teams[fx.walkover_winner_id]?.name}</strong>
        </div>
      )}
      {fx.status === 'postponed' && (
        <div className="text-mute" style={{ fontSize: 12, marginBottom: 14 }}>Rescheduled — date TBC</div>
      )}
      <footer className="fxc-foot">
        <span className="assign">
          <Icon name="pitch" size={12} />
          {pitch ? <strong>{pitch.name.replace(/ \(.*\)/, '')}</strong> : <span className="needs">Pitch?</span>}
        </span>
        <span className="assign">
          <Icon name="whistle" size={12} />
          {ref ? <strong>{ref.name.split(' ')[0]}</strong> : <span className="needs">Ref?</span>}
        </span>
        <span className="spacer" />
        <span className="actions">
          {!live && !completed && (
            <>
              <button className="btn btn-xs" onClick={() => onPitch?.(fx)}>Pitch</button>
              <button className="btn btn-xs" onClick={() => onRef?.(fx)}>Ref</button>
              <button className="btn btn-xs" onClick={() => onStatus?.(fx)}>•••</button>
            </>
          )}
          {completed && (
            <button className="btn btn-xs" onClick={() => onStatus?.(fx)}>Edit</button>
          )}
        </span>
      </footer>
    </article>
  );
}

function FixtureCompact({ fx }) {
  const home = window.DATA_teams[fx.home_team_id];
  const away = window.DATA_teams[fx.away_team_id];
  const showScore = fx.status === 'completed' || fx.status === 'in_progress' || fx.home_score != null;
  return (
    <div className="fxc-compact">
      <span className="when"><strong>{fx.kickoff_time}</strong>{window.dayLabel(fx.scheduled_date)}</span>
      <span className="matchup">
        <Crest c1={home.primary_colour} c2={home.secondary_colour} size={18} initials={getInitials(home.name)} />
        <span>{home.name}</span>
        <span className="vs-sep">vs</span>
        <Crest c1={away.primary_colour} c2={away.secondary_colour} size={18} initials={getInitials(away.name)} />
        <span>{away.name}</span>
      </span>
      <span className="score">
        {fx.status === 'walkover' ? 'W/O'
         : fx.status === 'postponed' ? 'PP'
         : fx.status === 'void' ? '—'
         : showScore ? `${fx.home_score}–${fx.away_score}`
         : ''}
      </span>
    </div>
  );
}

function Modal({ title, onClose, children, foot, wide, xwide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sizeCls = xwide ? ' modal--xwide' : wide ? ' modal--wide' : '';
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={'modal' + sizeCls} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

function SectionHead({ label, count, children }) {
  return (
    <div className="h-section">
      <h2>{label}</h2>
      {count != null && <span className="h-count">{count}</span>}
      {children && <span className="h-actions">{children}</span>}
    </div>
  );
}

function EmptyState({ title, body, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

function StarRating({ n, max = 5 }) {
  return (
    <span className="rating">
      {Array.from({ length: max }).map((_, i) =>
        <span key={i} className={'star' + (i < n ? ' on' : '')} />)}
    </span>
  );
}

Object.assign(window, {
  Crest, TeamCrest, StatusPill, deriveStatusForCard,
  FixtureCard, FixtureCompact, Modal,
  SectionHead, EmptyState, StarRating,
});
