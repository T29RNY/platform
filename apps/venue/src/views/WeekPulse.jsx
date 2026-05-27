import React, { useMemo } from "react";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function WeekPulse({ fixtures = {}, today = new Date() }) {
  const days = useMemo(() => buildWeek(fixtures, today), [fixtures, today]);

  const W = 520;
  const H = 96;
  const padX = 16;
  const colW = (W - padX * 2) / 7;

  return (
    <div className="week-pulse" aria-label="Week schedule">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img">
        {/* horizontal baseline */}
        <line x1={padX} x2={W - padX} y1={H - 26} y2={H - 26}
              stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
        {/* hour-tick guides */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={padX} x2={W - padX}
                y1={H - 26 - (H - 50) * t} y2={H - 26 - (H - 50) * t}
                stroke="currentColor" strokeOpacity="0.04" strokeDasharray="2 6" />
        ))}

        {days.map((d, i) => {
          const cx = padX + colW * i + colW / 2;
          const isToday = d.isToday;
          return (
            <g key={i}>
              {isToday && (
                <rect
                  x={cx - colW / 2 + 4} y={6}
                  width={colW - 8} height={H - 18}
                  rx={10}
                  fill="var(--accent-soft)"
                  stroke="var(--accent)"
                  strokeOpacity="0.45"
                />
              )}
              {d.fixtures.map((f, j) => {
                const y = mapTimeY(f.kickoff_time, H);
                const cls = `wp-dot wp-${f.status || "scheduled"}` + (f.live ? " wp-live" : "");
                return (
                  <g key={j} className={cls} transform={`translate(${cx}, ${y})`}>
                    <circle r="6" className="wp-halo" />
                    <circle r="3.5" className="wp-core" />
                    <line x1="0" y1="3.5" x2="0" y2={H - 30 - y} className="wp-stem" />
                  </g>
                );
              })}
              <text x={cx} y={H - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="Geist Mono, monospace"
                    letterSpacing="0.12em"
                    fill={isToday ? "var(--accent)" : "var(--ink-mute)"}
                    fontWeight={isToday ? 600 : 500}>
                {DAYS[d.dow]}
              </text>
              <text x={cx} y={H - 38}
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="Geist, sans-serif"
                    fontWeight={isToday ? 600 : 500}
                    fill={isToday ? "var(--ink)" : "var(--ink-faint)"}>
                {d.dom}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function buildWeek(fixtures, today) {
  const all = []
    .concat(fixtures.tonight ?? [])
    .concat(fixtures.this_week ?? [])
    .concat(fixtures.upcoming ?? []);
  const start = startOfWeek(today);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const fx = all
      .filter((f) => f.scheduled_date === iso)
      .map((f) => ({
        ...f,
        live: f.status === "in_progress",
      }))
      .slice(0, 4);
    days.push({
      dow: d.getDay(),
      dom: d.getDate(),
      iso,
      isToday: sameDay(d, today),
      fixtures: fx,
    });
  }
  return days;
}

function startOfWeek(d) {
  const c = new Date(d); c.setHours(0, 0, 0, 0);
  const day = c.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday-start week
  c.setDate(c.getDate() + diff);
  return c;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function mapTimeY(t, H) {
  // 17:00 → top, 22:30 → bottom of the plot range
  if (!t) return H - 32;
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  if (!m) return H - 32;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const lo = 17 * 60, hi = 22.5 * 60;
  const pct = Math.max(0, Math.min(1, (mins - lo) / (hi - lo)));
  return 14 + pct * (H - 50);
}
