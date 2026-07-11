// GuardianMatches.jsx — Guardian track, tab "matches" (labelled "Sessions").
//
// The child's whole week of activity, not just league games: MATCHES (FA grassroots
// league fixtures + internal club matches), TRAINING (club sessions), and CAMPS & EXTRAS
// (bookable classes / holiday camps). Each tile is tappable → a detail sheet (opponent/
// title, full date, time, home/away, venue/pitch, address, referee, who's-going, In/Out).
// Preview the first few per section; "See all fixtures →" / "See all training →" deep-link
// into the blended Schedule (More→Schedule) filtered to that kind — reuse, not a new screen.
//
// Data (all existing guardian-gated readers; NO new backend):
//   • guardian_list_child_fixtures(child)    (mig 426/530) → league fixtures + counts + recent
//   • guardian_list_children_sessions()       (mig 350)     → club_sessions (training + internal
//         matches) for THIS child — GUARDIAN mode only (selfMode keeps its fixtures-only layout;
//         the member track already has its own Schedule tab for training).
//   • guardian_list_child_class_options(child)(mig 429)     → bookable classes / holiday camps
// RSVP writers already exist + are guardian-gated/audited:
//   • guardian_set_fixture_availability(fixture,…)  → league fixtures
//   • member_rsvp_session(session,…, for_profile)    → club sessions
//
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens).

import { useState, useEffect, useCallback } from "react";
import {
  guardianListChildFixtures, guardianSetFixtureAvailability,
  guardianListChildrenSessions, guardianListChildClassOptions, memberRsvpSession,
  guardianBookClassSession, guardianMarkNoticeRead,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";
import BookPaySheet from "./BookPaySheet.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PREVIEW = 3; // tiles shown per section before "See all →"

// "2026-06-21" (pure calendar date) → { day:"Sat", dm:"21 Jun" }. Local date parts, no TZ shift.
function fmtDate(iso) {
  if (!iso) return { day: "", dm: "TBC" };
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return { day: "", dm: "TBC" };
  const dt = new Date(y, m - 1, d);
  return { day: DAYS[dt.getDay()], dm: `${d} ${MONTHS[m - 1]}` };
}

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

function fmtFull(dateKey) {
  const d = fmtDate(dateKey);
  return `${d.day} ${d.dm}`.trim();
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function hueFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function Crest({ name, size = 38, r = 11 }) {
  const hue = hueFor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, hsl(${hue} 46% 40%) 0 52%, hsl(${hue} 46% 30%) 100%)`,
      color: "white", fontSize: size * 0.36, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(name)}</div>
  );
}

function resultOf(us, them) { return us > them ? "W" : us < them ? "L" : "D"; }
const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

// selfMode (Club Console PR #6): reuse for the adult member's OWN matches. In selfMode we
// keep the ORIGINAL fixtures-only layout (training lives on the member's own Schedule tab) —
// only the copy switches to self-voice. Guardian mode gets the full Sessions blend.
export default function GuardianMatches({ childId, childFirst, toast, selfMode = false, onSeeAllFixtures, onSeeAllTraining, noticesUnread = 0, recentNotices = [], onOpenNotices, onMarkNoticesRead }) {
  const [state, setState] = useState({ loading: true, error: false, matches: [], training: [], camps: [], recent: [] });
  const [rsvp, setRsvp] = useState({});       // item.key → in|out|maybe
  const [saving, setSaving] = useState({});   // item.key → bool (double-fire guard)
  const [detail, setDetail] = useState(null); // the tapped item (detail sheet) | null
  const [bookBusy, setBookBusy] = useState(false); // camp booking in flight (double-fire guard)
  const [payCtx, setPayCtx] = useState(null);      // book-and-pay sheet (post-booking)
  const [showAllM, setShowAllM] = useState(false); // matches expanded (selfMode inline)
  const poss = selfMode ? "your" : (childFirst ? `${childFirst}'s` : "your");
  // Adult member (selfMode) reads their own club notices in a MobileSheet (iOS-safe, portaled) —
  // guardians route to the More/notices screen via onOpenNotices. Opening marks the member's own
  // unread read (best-effort) so the badge/strip clears, mirroring GuardianNotices' mark-all.
  const [noticesSheet, setNoticesSheet] = useState(false);
  const openMemberNotices = useCallback(() => {
    setNoticesSheet(true);
    const unread = (recentNotices || []).filter((n) => !n.read);
    if (unread.length) {
      Promise.allSettled(unread.map((n) => guardianMarkNoticeRead(n.id, childId)));
      onMarkNoticesRead?.();
    }
  }, [recentNotices, childId, onMarkNoticesRead]);

  const load = useCallback(async () => {
    if (!childId) { setState({ loading: false, error: false, matches: [], training: [], camps: [], recent: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Fixtures are required; sessions/classes are best-effort (guardian mode only).
      const [fxRes, sessRes, clsRes] = await Promise.all([
        guardianListChildFixtures(childId),
        selfMode ? Promise.resolve(null) : guardianListChildrenSessions().catch(() => null),
        selfMode ? Promise.resolve(null) : guardianListChildClassOptions(childId).catch(() => null),
      ]);

      const matches = [];
      const training = [];

      // League fixtures → matches
      for (const f of fxRes?.upcoming || []) {
        matches.push({
          key: "f:" + f.fixture_id, rsvpKind: "fixture", id: f.fixture_id, kind: "match",
          sortKey: (f.scheduled_date || "") + "T" + (f.kickoff_time || "00:00"),
          dateKey: f.scheduled_date, time: f.kickoff_time || "",
          title: f.opponent_name || "League fixture",
          isHome: !!f.is_home, homeAway: f.is_home ? "Home" : "Away",
          venue: f.venue_name || null, pitch: f.pitch_name || null, address: f.location || f.venue_address || null,
          ref: f.ref_name || null, league: f.league_name || null,
          counts: f.counts || null, rsvpStatus: f.own_rsvp_status || null,
        });
      }

      // Club sessions (guardian mode) → internal matches to `matches`, training to `training`
      if (!selfMode) {
        const child = (sessRes || []).find((c) => c.profile_id === childId);
        for (const s of child?.sessions || []) {
          const lp = londonOf(s.scheduled_at);
          if (!lp) continue;
          const isMatch = s.session_type === "match" || s.session_type === "friendly";
          const item = {
            key: "s:" + s.session_id, rsvpKind: "session", id: s.session_id,
            kind: isMatch ? "match" : "training",
            sortKey: lp.dateKey + "T" + lp.time, dateKey: lp.dateKey, time: lp.time,
            title: isMatch ? (s.opponent_name ? s.opponent_name : (s.title || "Match")) : (s.title || "Training"),
            isHome: s.home_away ? s.home_away === "home" : null,
            homeAway: s.home_away ? (s.home_away.charAt(0).toUpperCase() + s.home_away.slice(1)) : null,
            venue: s.opponent_venue_name || null, pitch: null,
            address: s.opponent_address || s.location || null,
            location: s.location || null, ref: null, league: s.club_name || null,
            notes: s.notes || null, counts: null, rsvpStatus: s.own_rsvp_status || null,
          };
          (isMatch ? matches : training).push(item);
        }
      }

      matches.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      training.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

      // Bookable classes / holiday camps (guardian mode)
      const camps = selfMode ? [] : (clsRes?.options || []).map((o) => {
        const lp = londonOf(o.starts_at);
        return {
          key: "c:" + o.session_id, kind: "camp", id: o.session_id, rsvpKind: null,
          dateKey: lp?.dateKey || null, time: lp?.time || "",
          title: o.class_name || "Camp / class", pricePence: o.price_pence,
          spotsLeft: o.spots_left, booked: !!o.already_booked, paymentMode: o.payment_mode,
          // Holiday Camps (mig 536): camp flavour + detail for the "Camps & extras" sheet
          isCamp: !!o.is_camp, bookingMode: o.booking_mode, endDateKey: o.end_date || null,
          campInfo: o.camp_info || null, campDietary: o.camp_dietary || null,
          pickupTime: o.pickup_time || null, dropoffTime: o.dropoff_time || null,
          pickupLocation: o.pickup_location || null, dropoffLocation: o.dropoff_location || null,
        };
      });

      const seed = {};
      for (const it of [...matches, ...training]) if (it.rsvpStatus) seed[it.key] = it.rsvpStatus;
      setRsvp(seed);
      setState({ loading: false, error: false, matches, training, camps, recent: fxRes?.recent || [] });
    } catch {
      setState({ loading: false, error: true, matches: [], training: [], camps: [], recent: [] });
    }
  }, [childId, selfMode]);

  useEffect(() => { load(); }, [load]);

  // Move the child's own vote between the squad-count buckets (prev bucket → next) so the
  // "N/total in" label reflects the tap immediately, in BOTH the list tile and the open detail
  // sheet. The child is always a counted member of their own team's fixture, so a self in/out
  // shifts the count by exactly one; the reader recomputes the authoritative count on next load.
  const bumpCount = (key, from, to) => {
    if (from === to) return;
    const moveVote = (c) => {
      if (!c) return c;
      const n = { ...c };
      if (n[from] != null) n[from] = Math.max(0, n[from] - 1);
      if (n[to] != null) n[to] = (n[to] || 0) + 1;
      return n;
    };
    setState((s) => {
      const move = (arr) => arr.map((it) => (it.key === key && it.counts) ? { ...it, counts: moveVote(it.counts) } : it);
      return { ...s, matches: move(s.matches), training: move(s.training) };
    });
    setDetail((d) => (d && d.key === key && d.counts) ? { ...d, counts: moveVote(d.counts) } : d);
  };

  const setAvail = async (item, next) => {
    if (!item.rsvpKind || saving[item.key]) return;
    const prev = rsvp[item.key] || null;
    const from = prev || "pending";                              // no prior vote = counted as pending
    setRsvp((s) => ({ ...s, [item.key]: next }));                 // optimistic button
    bumpCount(item.key, from, next);                             // optimistic squad-count move
    setSaving((s) => ({ ...s, [item.key]: true }));
    try {
      if (item.rsvpKind === "fixture") {
        await guardianSetFixtureAvailability(item.id, next, { forProfileId: childId });
      } else {
        await memberRsvpSession(item.id, next, { forProfileId: childId });
      }
      toast?.({
        icon: next === "in" ? "check" : "alert",
        text: next === "in"
          ? (selfMode ? "Marked available" : `${childFirst} marked available`)
          : (selfMode ? "Marked unavailable" : `${childFirst} marked unavailable`),
        sub: item.title,
      });
    } catch {
      setRsvp((s) => ({ ...s, [item.key]: prev }));               // revert button
      bumpCount(item.key, next, from);                            // revert count move
      toast?.({ icon: "alert", text: "Couldn't save — try again" });
    } finally {
      setSaving((s) => ({ ...s, [item.key]: false }));
    }
  };

  // Book a camp/class for the child directly from the detail sheet (mirrors
  // GuardianMembership.bookClass — the same guardian_book_class_session path). On success the
  // option becomes already_booked and drops out on reload; a door camp books with pay-on-the-day.
  const bookCamp = async (item) => {
    if (bookBusy || !item?.id || item.booked) return;
    setBookBusy(true);
    try {
      const r = await guardianBookClassSession(item.id, { forProfileId: childId });
      if (!r?.ok) {
        const reason = r?.reason || "couldnt_book";
        toast?.({ icon: "alert", tone: "warn", text:
          reason === "already_booked" ? "Already booked"
          : reason === "suspended" ? "Booking is suspended for missed sessions"
          : "Couldn't book that" });
        return;
      }
      // Book-and-pay: the booking is made — now take payment (card / bank / cash) in one shared
      // sheet, mirroring Membership → Extra classes. No more silent "booked, go pay elsewhere".
      setDetail(null);
      setPayCtx({ ...r, class_name: item.title });
      load();
    } catch (e) {
      const m = e?.message || "";
      toast?.({ icon: "alert", tone: "warn", text: "Couldn't book",
        sub: m.includes("session_not_bookable") ? "This is no longer open." : m.includes("session_full") ? "This is now full." : "Try again." });
    } finally { setBookBusy(false); }
  };

  const { loading, error, matches, training, camps, recent } = state;
  const nextItem = matches[0] || training[0] || null;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Sessions</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {poss} sessions…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Sessions</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load sessions right now.</p>
        <button onClick={load} style={pillBtn}>Try again</button>
      </div>
    );
  }

  // In selfMode there's no deep-linkable Schedule filter wired for the member — expand inline.
  const matchesShown = (selfMode && !showAllM) ? matches.slice(0, PREVIEW) : (selfMode ? matches : matches.slice(0, PREVIEW));
  const trainingShown = training.slice(0, PREVIEW);

  return (
    <div>
      {/* LIVE — honest empty state (no live data for grassroots fixtures yet) */}
      <div className="m-eyebrow" style={{ margin: "8px 2px 10px" }}>
        {selfMode ? "Your" : (childFirst ? `${childFirst}'s` : "Your")} team · no live match
      </div>
      <div className="m-card" style={{ padding: "16px 15px", display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 13, flex: "none", background: "var(--s4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><MIcon name="clock" size={20} color="var(--ink3)" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>No match in play right now</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>
            {nextItem
              ? `Next: ${fmtFull(nextItem.dateKey)}${nextItem.title ? " · " + nextItem.title : ""}`
              : "Nothing scheduled yet"}
          </div>
        </div>
      </div>

      {/* CLUB NOTICES — surface recent/unread announcements here, not only under Comms.
          Reuses the shell's guardian_list_child_notices fetch (count + notices). Shown for a
          guardian's active child AND an adult member (selfMode) — both receive club notices. */}
      {recentNotices.length > 0 && (onOpenNotices || selfMode) && (
        <>
          <SecHead title="Club notices" meta={noticesUnread > 0 ? `${noticesUnread} unread` : "latest"} />
          <button onClick={() => (selfMode ? openMemberNotices() : onOpenNotices())} className="m-card" style={{
            width: "100%", textAlign: "left", cursor: "pointer", padding: "2px 14px",
            background: noticesUnread > 0 ? "var(--amber-soft)" : "var(--s2)",
            border: `1px solid ${noticesUnread > 0 ? "var(--amber-glow)" : "var(--hair)"}`,
            fontFamily: "var(--m-font)",
          }}>
            {recentNotices.slice(0, 2).map((n, i) => (
              <div key={n.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "11px 0",
                borderTop: i ? "1px solid var(--hair)" : "none",
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", flex: "none",
                  background: n.read ? "var(--ink4)" : "var(--amber)",
                }} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.sender_label || "Club"}</div>
                </div>
                <MIcon name="arrow" size={15} color="var(--ink4)" style={{ flex: "none" }} />
              </div>
            ))}
          </button>
        </>
      )}

      {/* MATCHES */}
      <SecHead title="Matches" meta={selfMode ? "your availability" : `${childFirst || "your child"}'s games`} />
      {matches.length === 0 && <Empty>No upcoming matches.</Empty>}
      {matchesShown.map((f) => (
        <ActivityTile key={f.key} item={f} rsvp={rsvp[f.key]} busy={!!saving[f.key]}
          childFirst={childFirst} selfMode={selfMode} onOpen={() => setDetail(f)} onAvail={setAvail} />
      ))}
      {matches.length > PREVIEW && (
        <SeeAll label={`See all ${matches.length} fixtures`}
          onClick={selfMode ? () => setShowAllM((v) => !v) : onSeeAllFixtures}
          expanded={selfMode ? showAllM : false} />
      )}

      {/* TRAINING (guardian only) */}
      {!selfMode && (
        <>
          <SecHead title="Training" meta={`${childFirst || "your child"}'s sessions`} />
          {training.length === 0 && <Empty>No training scheduled.</Empty>}
          {trainingShown.map((t) => (
            <ActivityTile key={t.key} item={t} rsvp={rsvp[t.key]} busy={!!saving[t.key]}
              childFirst={childFirst} selfMode={selfMode} onOpen={() => setDetail(t)} onAvail={setAvail} />
          ))}
          {training.length > PREVIEW && (
            <SeeAll label={`See all ${training.length} training sessions`} onClick={onSeeAllTraining} />
          )}
        </>
      )}

      {/* CAMPS & EXTRAS (guardian only) */}
      {!selfMode && camps.length > 0 && (
        <>
          <SecHead title="Camps & extras" meta="holiday camps & classes" />
          {camps.map((c) => (
            <button key={c.key} onClick={() => setDetail(c)} className="m-card"
              style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)" }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MIcon name="figure" size={19} color="var(--ink2)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</span>
                  {c.isCamp && (
                    <span style={{ flex: "none", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", padding: "2px 6px", borderRadius: "var(--r-pill)", background: "var(--amber-soft)", color: "var(--amber)" }}>Camp</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{campWhen(c)}</div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--amber)" }}>{gbp(c.pricePence)}</div>
                <span style={{ display: "inline-block", marginTop: 3, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: c.booked ? "var(--ok-soft)" : "var(--s3)", color: c.booked ? "var(--ok-ink)" : "var(--ink2)" }}>{c.booked ? "Booked" : "Book"}</span>
              </div>
            </button>
          ))}
        </>
      )}

      {/* RECENT RESULTS */}
      <SecHead title="Recent results" meta={recent.length ? `last ${recent.length}` : ""} />
      {recent.length === 0 && <Empty>No results yet.</Empty>}
      {recent.map((r) => {
        const us = r.is_home ? r.home_score : r.away_score;
        const them = r.is_home ? r.away_score : r.home_score;
        const hasScore = us != null && them != null;
        const res = hasScore ? resultOf(us, them) : null;
        const d = fmtDate(r.scheduled_date);
        const col = res === "W" ? "var(--ok-ink)" : res === "L" ? "var(--live-ink)" : "var(--ink2)";
        const bg = res === "W" ? "var(--ok-soft)" : res === "L" ? "var(--live-soft)" : "var(--s3)";
        return (
          <div key={r.fixture_id} className="m-card" style={{ padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              width: 30, height: 30, borderRadius: 9, flex: "none", display: "flex", alignItems: "center",
              justifyContent: "center", background: bg, color: col, fontSize: 13, fontWeight: 800,
            }}>{res || "–"}</span>
            <Crest name={r.opponent_name} size={34} r={9} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.opponent_name} <span style={{ color: "var(--ink4)", fontWeight: 500 }}>({r.is_home ? "H" : "A"})</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {d.day} {d.dm}{(r.location || r.venue_name) ? " · " + (r.location || r.venue_name) : ""}
              </div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", flex: "none", color: "var(--ink)" }}>
              {hasScore ? <>{us}<span style={{ color: "var(--ink4)", margin: "0 3px" }}>–</span>{them}</> : <span style={{ color: "var(--ink4)", fontSize: 13, fontWeight: 600 }}>result TBC</span>}
            </div>
          </div>
        );
      })}

      {/* DETAIL SHEET */}
      {detail && (
        <DetailSheet item={detail} childFirst={childFirst} selfMode={selfMode}
          rsvp={rsvp[detail.key]} busy={!!saving[detail.key]}
          onAvail={(next) => setAvail(detail, next)} onClose={() => setDetail(null)}
          onBook={() => bookCamp(detail)} bookBusy={bookBusy} />
      )}

      {/* book-and-pay: after a camp/class booking, take payment (card / bank / cash) in one sheet */}
      {payCtx && (
        <BookPaySheet ctx={payCtx} forName={selfMode ? null : childFirst}
          onClose={() => { setPayCtx(null); load(); }} toast={toast} />
      )}

      {/* Adult member's club-notices list (read-only) — opened from the strip; iOS-safe MobileSheet. */}
      {noticesSheet && (
        <MobileSheet title="Club notices" onClose={() => setNoticesSheet(false)}>
          {recentNotices.length === 0 && (
            <div style={{ fontSize: 13.5, color: "var(--ink3)", padding: "10px 2px" }}>No club notices yet.</div>
          )}
          {recentNotices.map((n) => (
            <div key={n.id} className="m-card" style={{ padding: "12px 14px", marginBottom: 9, background: "var(--s2)" }}>
              <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, marginBottom: 3 }}>
                {n.sender_label || "Club"}{n.created_at ? " · " + fmtNoticeWhen(n.created_at) : ""}
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{n.body}</div>}
            </div>
          ))}
        </MobileSheet>
      )}
    </div>
  );
}

// timestamptz → "8 Jul" (viewer-local); for the member notices list.
function fmtNoticeWhen(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// One upcoming match/training tile — tappable (opens detail) with inline In/Out.
function ActivityTile({ item, rsvp, busy, childFirst, selfMode, onOpen, onAvail }) {
  const d = fmtDate(item.dateKey);
  const mine = rsvp || null;
  return (
    <div className="m-card" style={{ padding: "13px 14px", marginBottom: 10 }}>
      <button onClick={onOpen} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "var(--m-font)", color: "inherit", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 54, flex: "none", textAlign: "center" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>{d.day} {d.dm.split(" ")[0]}</div>
          <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 1 }}>{d.dm.split(" ")[1] || ""}{item.time ? " · " + item.time : ""}</div>
        </div>
        <Crest name={item.title} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            {item.homeAway && (
              <span style={{ height: 18, fontSize: 10, padding: "0 7px", flex: "none", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", background: "var(--s3)", color: "var(--ink2)", fontWeight: 700 }}>{item.homeAway}</span>
            )}
            {item.counts && item.counts.total > 0 && (
              <span title="Squad going" style={{ height: 18, fontSize: 10, padding: "0 7px", flex: "none", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", gap: 3, background: "var(--ok-soft)", color: "var(--ok-ink)", fontWeight: 700 }}>{item.counts.in}/{item.counts.total} in</span>
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.pitch || item.venue || item.location || item.league || ""}</span>
          </div>
        </div>
        <MIcon name="chevron" size={16} color="var(--ink4)" style={{ flex: "none" }} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--hair)" }}>
        <span style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 600, flex: 1 }}>
          {mine === "in" ? (selfMode ? "You're in" : `${childFirst} is available`)
            : mine === "out" ? (selfMode ? "You're out" : `${childFirst} can't make it`)
            : (selfMode ? "Available?" : `Is ${childFirst} available?`)}
        </span>
        <AvailBtn on={mine === "in"} tone="ok" busy={busy} onClick={() => onAvail(item, "in")} icon="check" label="In" />
        <AvailBtn on={mine === "out"} tone="live" busy={busy} onClick={() => onAvail(item, "out")} label="Out" />
      </div>
    </div>
  );
}

// Detail sheet — the tapped item's full info + In/Out (matches/training) or booking note (camps).
function DetailSheet({ item, childFirst, selfMode, rsvp, busy, onAvail, onClose, onBook, bookBusy }) {
  const isCamp = item.kind === "camp";
  const mine = rsvp || null;
  // Camps get a pinned "Book" footer (always visible). Booked camps show a done state.
  const campFooter = isCamp ? (
    item.booked ? (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--ok-ink)" }}>
        <MIcon name="check" size={15} color="var(--ok-ink)" /> Booked — see it in Membership → Fees &amp; payments
      </div>
    ) : (
      <button onClick={onBook} disabled={bookBusy} style={{
        width: "100%", padding: "13px 16px", borderRadius: "var(--r-sm)", background: "var(--amber)",
        color: "var(--amber-ink)", border: "none", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 15,
        cursor: bookBusy ? "default" : "pointer", opacity: bookBusy ? 0.6 : 1,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      }}>
        <MIcon name="check" size={16} color="var(--amber-ink)" />
        {bookBusy ? "Booking…" : `Book${item.pricePence != null ? " · " + gbp(item.pricePence) : ""}`}
      </button>
    )
  ) : undefined;
  return (
    <MobileSheet title={isCamp ? "Camp / class" : item.kind === "training" ? "Training" : "Match"} onClose={onClose} footer={campFooter}>
      <div className="m-card" style={{ padding: "15px 15px", background: "var(--s2)", marginTop: 4, display: "flex", alignItems: "center", gap: 13 }}>
        <Crest name={item.title} size={46} r={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink)" }}>{item.title}</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 2 }}>
            {isCamp && item.bookingMode === "block" && item.endDateKey
              ? `${item.dateKey ? fmtFull(item.dateKey) : "Dates TBC"} – ${fmtFull(item.endDateKey)}`
              : <>{item.dateKey ? fmtFull(item.dateKey) : "Dates TBC"}{item.time ? " · " + item.time : ""}</>}
          </div>
        </div>
      </div>

      <div className="m-card" style={{ padding: "4px 15px", marginTop: 11, background: "var(--s2)" }}>
        {item.homeAway && <KV icon="house" k="Home / away" v={item.homeAway} />}
        {(item.venue || item.pitch) && <KV icon="house" k="Venue" v={[item.venue, item.pitch].filter(Boolean).join(" · ")} />}
        {item.address && <KV icon="pin" k="Address" v={item.address} />}
        {item.ref && <KV icon="whistle" k="Referee" v={item.ref} />}
        {item.league && <KV icon="trophy" k={isCamp ? "Club" : "League / club"} v={item.league} />}
        {item.counts && item.counts.total > 0 && <KV icon="users" k="Squad going" v={`${item.counts.in} of ${item.counts.total} in`} />}
        {isCamp && item.pricePence != null && <KV icon="pound" k="Price" v={gbp(item.pricePence)} />}
        {isCamp && item.spotsLeft != null && <KV icon="check" k="Availability" v={item.spotsLeft > 0 ? `${item.spotsLeft} left` : "Waitlist"} />}
        {isCamp && item.campInfo && <KV icon="info" k="Info" v={item.campInfo} />}
        {isCamp && item.campDietary && <KV icon="info" k="Dietary" v={item.campDietary} />}
        {isCamp && (item.pickupTime || item.pickupLocation) && <KV icon="pin" k="Pick-up" v={[hm(item.pickupTime), item.pickupLocation].filter(Boolean).join(" · ")} />}
        {isCamp && (item.dropoffTime || item.dropoffLocation) && <KV icon="pin" k="Drop-off" v={[hm(item.dropoffTime), item.dropoffLocation].filter(Boolean).join(" · ")} />}
        {item.notes && <KV icon="info" k="Notes" v={item.notes} last />}
      </div>

      {/* In/Out for matches + training */}
      {item.rsvpKind && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <span style={{ fontSize: 13, color: "var(--ink3)", fontWeight: 600, flex: 1 }}>
            {mine === "in" ? (selfMode ? "You're in" : `${childFirst} is available`)
              : mine === "out" ? (selfMode ? "You're out" : `${childFirst} can't make it`)
              : (selfMode ? "Are you available?" : `Is ${childFirst} available?`)}
          </span>
          <AvailBtn on={mine === "in"} tone="ok" busy={busy} onClick={() => onAvail("in")} icon="check" label="In" />
          <AvailBtn on={mine === "out"} tone="live" busy={busy} onClick={() => onAvail("out")} label="Out" />
        </div>
      )}
    </MobileSheet>
  );
}

// "HH:MM:SS" (SQL time) -> "HH:MM"
function hm(t) { return t ? String(t).slice(0, 5) : ""; }

// Camp date label: a block camp shows its start–end range; a per-day camp its single day + time.
function campWhen(c) {
  const start = c.dateKey ? fmtFull(c.dateKey) : "Dates TBC";
  if (c.bookingMode === "block" && c.endDateKey) return `${start} – ${fmtFull(c.endDateKey)}`;
  return start + (c.time ? " · " + c.time : "");
}

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}

function SeeAll({ label, onClick, expanded }) {
  if (!onClick) return null;
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "11px 14px", marginBottom: 4, borderRadius: "var(--r-md)", cursor: "pointer",
      background: "transparent", border: "1px dashed var(--hair2)", color: "var(--amber)",
      fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    }}>
      {expanded ? "Show less" : label}
      <MIcon name="arrow" size={15} color="var(--amber)" />
    </button>
  );
}

function Empty({ children }) {
  return <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>{children}</div>;
}

function KV({ icon, k, v, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: last ? "none" : "1px solid var(--hair)" }}>
      <MIcon name={icon} size={16} color="var(--ink3)" style={{ flex: "none" }} />
      <span style={{ flex: "none", fontSize: 13, color: "var(--ink3)", fontWeight: 600, minWidth: 92 }}>{k}</span>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--ink)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function AvailBtn({ on, tone, busy, onClick, icon, label }) {
  const soft = tone === "ok" ? "var(--ok-soft)" : "var(--live-soft)";
  const ink = tone === "ok" ? "var(--ok-ink)" : "var(--live-ink)";
  const line = tone === "ok" ? "var(--ok)" : "var(--live)";
  return (
    <button onClick={onClick} disabled={busy} style={{
      height: 30, padding: "0 13px", cursor: busy ? "default" : "pointer", borderRadius: "var(--r-pill)",
      display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700,
      opacity: busy ? 0.6 : 1, border: "1px solid",
      background: on ? soft : "transparent", color: on ? ink : "var(--ink3)", borderColor: on ? line : "var(--hair2)",
    }}>
      {icon ? <MIcon name={icon} size={13} /> : null}{label}
    </button>
  );
}

const pillBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
};
