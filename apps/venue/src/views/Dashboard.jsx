import React, { useState, useMemo, useRef, useEffect } from "react";
import FixtureCard from "./FixtureCard.jsx";
import Sidebar from "./Sidebar.jsx";
import RegistrationActions from "./RegistrationActions.jsx";
import SeasonWizard from "./SeasonWizard.jsx";
import WeekPulse from "./WeekPulse.jsx";

export default function Dashboard({ state, venueToken, onRefresh, refreshing }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const venue = state.venue ?? {};
  const leagues = state.leagues ?? [];
  const fixtures = state.fixtures ?? {};
  const tonight = fixtures.tonight ?? [];
  const thisWeek = fixtures.this_week ?? [];
  const upcoming = fixtures.upcoming ?? [];
  const recent = fixtures.recent ?? [];
  const pending = state.pending_registrations ?? [];
  const incidents = state.open_incidents ?? [];

  const tonightIds = new Set(tonight.map((f) => f.id));
  const restOfWeek = thisWeek.filter((f) => !tonightIds.has(f.id));

  const liveCount = tonight.filter((f) => f.status === "in_progress").length;
  const onAir = liveCount > 0;

  const tonightRef = useRef(null);
  const ctaRef = useRef(null);

  // Mouse-tracked spotlight on the TONIGHT hero panel.
  useEffect(() => {
    const el = tonightRef.current; if (!el) return;
    let raf = 0;
    const onMove = (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    const onEnter = () => el.classList.add("is-lit");
    const onLeave = () => el.classList.remove("is-lit");
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  // Magnetic cursor pull on the primary CTA.
  useEffect(() => {
    const el = ctaRef.current; if (!el) return;
    const RADIUS = 90;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < RADIUS) {
        const pull = (1 - dist / RADIUS) * 14;
        el.style.transform = `translate(${(dx / dist) * pull}px, ${(dy / dist) * pull}px)`;
      } else {
        el.style.transform = "";
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      el.style.transform = "";
    };
  }, []);

  // Scroll-parallax on the aurora orbs (via root CSS vars).
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        document.documentElement.style.setProperty("--scroll-y", `${y}px`);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", onScroll); };
  }, []);

  // Live ticking clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clockTime = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const clockSec  = String(now.getSeconds()).padStart(2, "0");
  const clockDate = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const tickerItems = useMemo(() => {
    const items = [];
    leagues.forEach((l) => items.push({ k: `lg-${l.id}`, label: l.name }));
    items.push({ k: "stat-pitches", label: `${(state.pitches ?? []).length} pitches` });
    items.push({ k: "stat-refs",    label: `${(state.refs ?? []).length} officials` });
    items.push({ k: "stat-week",    label: `${thisWeek.length} fixtures this week` });
    if (pending.length)   items.push({ k: "stat-pend", label: `${pending.length} pending registration${pending.length === 1 ? "" : "s"}` });
    if (incidents.length) items.push({ k: "stat-inc",  label: `${incidents.length} open incident${incidents.length === 1 ? "" : "s"}` });
    return items;
  }, [leagues, state.pitches, state.refs, thisWeek.length, pending.length, incidents.length]);

  const venueName = venue.name || "Venue";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-eyebrow">
            <span className={`brand-status ${onAir ? "is-on-air" : ""}`}>
              <span className="brand-status-dot" />
              {onAir ? "On Air" : "Standby"}
            </span>
            <span className="brand-eyebrow-sep">·</span>
            <span>Venue Control</span>
          </span>
          <h1 className="brand-line1" aria-label={venueName}>
            {venueName.split("").map((ch, i) => (
              <span key={i} className="brand-letter" style={{ animationDelay: `${80 + i * 28}ms` }}>
                {ch === " " ? " " : ch}
              </span>
            ))}
          </h1>
          <span className="brand-line2">
            {leagues[0]?.name ?? "No active league"}
            {leagues.length > 1 ? ` — and ${leagues.length - 1} more` : ""}
          </span>
        </div>

        <div className="topbar-mid">
          <WeekPulse fixtures={fixtures} today={now} />
        </div>

        <div className="topbar-right">
          <div className="clock" aria-label={`Current time ${clockTime}`}>
            <div className="clock-time">
              <span>{clockTime}</span>
              <span className="clock-sec">{clockSec}</span>
            </div>
            <div className="clock-date">{clockDate}</div>
          </div>
          <div className="user">
            <button ref={ctaRef} className="btn-accent btn-magnetic" onClick={() => setWizardOpen(true)}>
              <span className="btn-accent-shine" />
              Set up new season
            </button>
            <button onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...tickerItems, ...tickerItems].map((it, i) => (
            <span key={`${it.k}-${i}`}><b>◆</b>{it.label}</span>
          ))}
        </div>
      </div>

      {wizardOpen && (
        <SeasonWizard
          state={state}
          venueToken={venueToken}
          onClose={() => setWizardOpen(false)}
          onDone={onRefresh}
        />
      )}

      <main className="content dash-grid">
        <section className="panel panel-tonight" ref={tonightRef}>
          {onAir && (
            <span className="live-badge">
              <span className="live-ring" />
              <span className="live-dot" />
              On Air · {liveCount}
            </span>
          )}
          <div className="panel-tonight-spotlight" aria-hidden="true" />
          <h2>
            <span className="hero-eyebrow">Tonight</span>
            {tonight.length > 0 && <span className="panel-count">{tonight.length}</span>}
          </h2>
          {tonight.length === 0 ? (
            <div className="empty-hero">
              <p className="empty-hero-line">
                <em>Floodlights down.</em>
              </p>
              <p className="empty-hero-sub">No fixtures scheduled for today. The pitch is quiet.</p>
            </div>
          ) : (
            <div className="fixture-list">
              {tonight.map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} prominent withActions />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-issues">
          <h2>Open Issues {(pending.length + incidents.length) > 0 && <span className="panel-count">{pending.length + incidents.length}</span>}</h2>
          {pending.length === 0 && incidents.length === 0 ? (
            <p className="muted">Nothing to action. Quiet pit wall.</p>
          ) : (
            <div className="issues-list">
              {pending.map((p) => (
                <div className="issue-row" key={`reg-${p.id}`}>
                  <span className="issue-tag">Registration</span>
                  <span className="issue-title">{p.team_name || p.team_id}</span>
                  <RegistrationActions venueToken={venueToken} registration={p} onDone={onRefresh} />
                </div>
              ))}
              {incidents.map((i) => (
                <div className="issue-row" key={`inc-${i.id}`}>
                  <span className="issue-tag issue-tag-critical">{(i.severity || "info")}</span>
                  <span className="issue-title">{i.description}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-this-week">
          <h2>This Week {restOfWeek.length > 0 && <span className="panel-count">{restOfWeek.length}</span>}</h2>
          {restOfWeek.length === 0 ? (
            <p className="muted">No other fixtures in the next 7 days.</p>
          ) : (
            <div className="fixture-list">
              {restOfWeek.map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} withActions />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-recent">
          <h2>Recent Results {recent.length > 0 && <span className="panel-count">{recent.length}</span>}</h2>
          {recent.length === 0 ? (
            <p className="muted">No completed fixtures yet.</p>
          ) : (
            <div className="fixture-list">
              {recent.slice(0, 10).map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} compact withActions animateScore />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-upcoming">
          <h2>Upcoming {upcoming.length > 0 && <span className="panel-count">{upcoming.length}</span>}</h2>
          {upcoming.length === 0 ? (
            <p className="muted">No fixtures further out.</p>
          ) : (
            <div className="fixture-list">
              {upcoming.slice(0, 10).map((f) => (
                <FixtureCard key={f.id} fx={f} state={state} venueToken={venueToken} onDone={onRefresh} compact withActions />
              ))}
            </div>
          )}
        </section>

        <aside className="panel panel-sidebar">
          <Sidebar
            pitches={state.pitches ?? []}
            refs={state.refs ?? []}
            venueToken={venueToken}
            onDone={onRefresh}
          />
        </aside>
      </main>
    </div>
  );
}
