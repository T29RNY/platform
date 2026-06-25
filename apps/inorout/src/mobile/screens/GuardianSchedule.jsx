// GuardianSchedule.jsx — Guardian track, screen 5 (mounted at /hub, More hub → "Schedule").
//
// Honest build of design_handoff_guardian_app README "Schedule": the child's
// upcoming training sessions + league fixtures + booked classes blended into ONE
// chronological agenda, grouped by day, future-facing. Parents can mark the child
// In/Out where RSVP applies (training sessions + fixtures); classes are bookings,
// so they show display-only here.
//
// PURE RE-PRESENTATION — no new backend. Merges three existing guardian-gated
// readers client-side:
//   • guardian_list_children_sessions()        → training + internal matches (club_sessions)
//   • guardian_list_child_fixtures(child)       → upcoming FA grassroots league fixtures
//   • guardian_list_child_class_options(child)  → upcoming classes (filtered already_booked)
// RSVP writers also already exist + are guardian-gated/audited:
//   • member_rsvp_session(…, for_profile)       → sessions
//   • guardian_set_fixture_availability(…)      → fixtures
//
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens).

import { useState, useEffect, useCallback } from "react";
import {
  guardianListChildrenSessions,
  guardianListChildFixtures,
  guardianListChildClassOptions,
  memberRsvpSession,
  guardianSetFixtureAvailability,
} from "@platform/core";
import MIcon from "../icons.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// timestamptz → { dateKey:'YYYY-MM-DD', time:'HH:MM' } in Europe/London (DST-safe).
function londonOf(iso) {
  if (!iso) return null;
  const dt = new Date(iso);
  if (isNaN(dt)) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(dt).map((x) => [x.type, x.value])
  );
  const hh = p.hour === "24" ? "00" : p.hour;
  return { dateKey: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}` };
}

// 'YYYY-MM-DD' (a pure calendar date) → a human day label. Parsed as local date
// parts so there's no timezone shift.
function dayLabel(dateKey, todayKey, tomorrowKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const dt = new Date(y, m - 1, d);
  const dm = `${d} ${MONTHS[m - 1]}`;
  if (dateKey === todayKey) return `Today · ${dm}`;
  if (dateKey === tomorrowKey) return `Tomorrow · ${dm}`;
  return `${WEEKDAYS[dt.getDay()]} · ${dm}`;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// kind → glyph + whether it's an amber-accented competitive game.
const KIND = {
  training: { icon: "whistle", game: false },
  match:    { icon: "flag",    game: true  },
  fixture:  { icon: "flag",    game: true  },
  class:    { icon: "figure",  game: false },
};

export default function GuardianSchedule({ childId, childFirst, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, items: [] });
  const [rsvp, setRsvp] = useState({});     // item.key → in|out|maybe
  const [saving, setSaving] = useState({}); // item.key → bool

  const load = useCallback(async () => {
    if (!childId) { setState({ loading: false, error: false, items: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [sessRes, fxRes, clsRes] = await Promise.all([
        guardianListChildrenSessions().catch(() => null),
        guardianListChildFixtures(childId).catch(() => null),
        guardianListChildClassOptions(childId).catch(() => null),
      ]);

      const items = [];

      // Training + internal matches for THIS child only.
      // guardianListChildrenSessions() returns the children ARRAY directly.
      const child = (sessRes || []).find((c) => c.profile_id === childId);
      for (const s of child?.sessions || []) {
        const lp = londonOf(s.scheduled_at);
        if (!lp) continue;
        const isMatch = s.session_type === "match" || s.session_type === "friendly";
        items.push({
          key: "s:" + s.session_id, id: s.session_id, rsvpKind: "session",
          kind: isMatch ? "match" : "training",
          dateKey: lp.dateKey, time: lp.time, sortKey: lp.dateKey + "T" + lp.time,
          title: isMatch ? (s.opponent_name ? `vs ${s.opponent_name}` : (s.title || "Match")) : (s.title || "Training"),
          sub: isMatch
            ? [s.home_away ? cap(s.home_away) : null, s.location || s.opponent_venue_name].filter(Boolean).join(" · ")
            : (s.location || "Training session"),
          rsvpStatus: s.own_rsvp_status || null,
        });
      }

      // Upcoming league fixtures.
      for (const f of fxRes?.upcoming || []) {
        items.push({
          key: "f:" + f.fixture_id, id: f.fixture_id, rsvpKind: "fixture", kind: "fixture",
          dateKey: f.scheduled_date, time: f.kickoff_time || "",
          sortKey: f.scheduled_date + "T" + (f.kickoff_time || "00:00"),
          title: f.opponent_name ? `vs ${f.opponent_name}` : "League fixture",
          sub: [f.is_home ? "Home" : "Away", f.pitch_name || f.venue_name || f.league_name].filter(Boolean).join(" · "),
          rsvpStatus: f.own_rsvp_status || null,
        });
      }

      // Booked classes (display-only).
      for (const c of (clsRes?.options || []).filter((o) => o.already_booked)) {
        const lp = londonOf(c.starts_at);
        if (!lp) continue;
        items.push({
          key: "c:" + c.session_id, id: c.session_id, rsvpKind: null, kind: "class",
          dateKey: lp.dateKey, time: lp.time, sortKey: lp.dateKey + "T" + lp.time,
          title: c.class_name || "Class", sub: "Booked", rsvpStatus: null,
        });
      }

      items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      setRsvp(Object.fromEntries(items.filter((i) => i.rsvpStatus).map((i) => [i.key, i.rsvpStatus])));
      setState({ loading: false, error: false, items });
    } catch {
      setState({ loading: false, error: true, items: [] });
    }
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  const setAvail = async (item, next) => {
    if (!item.rsvpKind || saving[item.key]) return;
    const prev = rsvp[item.key] || null;
    setRsvp((s) => ({ ...s, [item.key]: next }));            // optimistic
    setSaving((s) => ({ ...s, [item.key]: true }));
    try {
      if (item.rsvpKind === "session") {
        await memberRsvpSession(item.id, next, { forProfileId: childId });
      } else {
        await guardianSetFixtureAvailability(item.id, next, { forProfileId: childId });
      }
      toast?.({
        icon: next === "in" ? "check" : "alert",
        text: next === "in" ? `${childFirst} marked available` : `${childFirst} marked unavailable`,
        sub: item.title,
      });
    } catch {
      setRsvp((s) => ({ ...s, [item.key]: prev }));          // revert
      toast?.({ icon: "alert", text: "Couldn't save — try again" });
    } finally {
      setSaving((s) => ({ ...s, [item.key]: false }));
    }
  };

  const { loading, error, items } = state;

  if (loading) return <Frame onBack={onBack}><Note>Loading {childFirst ? `${childFirst}'s` : "your"} schedule…</Note></Frame>;
  if (error) {
    return (
      <Frame onBack={onBack}>
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 14, margin: 0 }}>Couldn't load the schedule right now.</p>
          <button onClick={load} style={pillBtn}>Try again</button>
        </div>
      </Frame>
    );
  }
  if (!items.length) {
    return (
      <Frame onBack={onBack}>
        <Note>Nothing coming up for {childFirst}. Training, matches and booked classes will appear here.</Note>
      </Frame>
    );
  }

  // Today / tomorrow keys for friendly day headers.
  const todayKey = londonOf(new Date().toISOString())?.dateKey || "";
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  const tomorrowKey = londonOf(tmr.toISOString())?.dateKey || "";

  // Group sorted items by day.
  const groups = [];
  for (const it of items) {
    let g = groups[groups.length - 1];
    if (!g || g.dateKey !== it.dateKey) { g = { dateKey: it.dateKey, items: [] }; groups.push(g); }
    g.items.push(it);
  }

  return (
    <Frame onBack={onBack}>
      <div className="m-eyebrow" style={{ margin: "2px 2px 4px" }}>{childFirst}'s week</div>

      {groups.map((g) => (
        <div key={g.dateKey} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.01em", color: "var(--ink2)", margin: "0 2px 9px", textTransform: "uppercase" }}>
            {dayLabel(g.dateKey, todayKey, tomorrowKey)}
          </div>

          {g.items.map((it) => {
            const meta = KIND[it.kind] || KIND.training;
            const mine = rsvp[it.key] || null;
            const busy = !!saving[it.key];
            return (
              <div key={it.key} className="m-card" style={{
                padding: "12px 13px", marginBottom: 9,
                borderLeft: meta.game ? "3px solid var(--amber)" : "3px solid transparent",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 46, flex: "none", textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em" }}>{it.time || "TBC"}</div>
                  </div>
                  <div style={{
                    width: 36, height: 36, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                    background: meta.game ? "var(--amber-soft)" : "var(--s4)",
                  }}>
                    <MIcon name={meta.icon} size={18} color={meta.game ? "var(--amber)" : "var(--ink2)"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
                    <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.sub || ""}</div>
                  </div>
                  {it.kind === "class" && (
                    <span style={{ flex: "none", fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink3)" }}>Class</span>
                  )}
                </div>

                {it.rsvpKind && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--hair)" }}>
                    <span style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 600, flex: 1 }}>
                      {mine === "in" ? `${childFirst} is available` : mine === "out" ? `${childFirst} can't make it` : `Is ${childFirst} available?`}
                    </span>
                    <AvailBtn on={mine === "in"} tone="ok" busy={busy} onClick={() => setAvail(it, "in")} icon="check" label="In" />
                    <AvailBtn on={mine === "out"} tone="live" busy={busy} onClick={() => setAvail(it, "out")} label="Out" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </Frame>
  );
}

function Frame({ children, onBack }) {
  return (
    <div className="m-view-enter">
      {onBack && (
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 10, cursor: "pointer",
          background: "transparent", border: "none", color: "var(--ink3)", fontFamily: "var(--m-font)",
          fontWeight: 600, fontSize: 13.5, padding: "2px 0",
        }}>
          <MIcon name="chevleft" size={16} /> More
        </button>
      )}
      {children}
    </div>
  );
}

function Note({ children }) {
  return <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5, lineHeight: 1.5 }}>{children}</div>;
}

const pillBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
};

function AvailBtn({ on, tone, busy, onClick, icon, label }) {
  const soft = tone === "ok" ? "var(--ok-soft)" : "var(--live-soft)";
  const ink = tone === "ok" ? "var(--ok-ink)" : "var(--live-ink)";
  const line = tone === "ok" ? "var(--ok)" : "var(--live)";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        height: 30, padding: "0 13px", cursor: busy ? "default" : "pointer", borderRadius: "var(--r-pill)",
        display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700,
        opacity: busy ? 0.6 : 1, border: "1px solid",
        background: on ? soft : "transparent",
        color: on ? ink : "var(--ink3)",
        borderColor: on ? line : "var(--hair2)",
      }}
    >
      {icon ? <MIcon name={icon} size={13} /> : null}{label}
    </button>
  );
}
