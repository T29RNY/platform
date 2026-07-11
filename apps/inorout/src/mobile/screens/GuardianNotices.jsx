// GuardianNotices.jsx — Guardian track (mounted at /hub, More hub → "Club notices").
//
// Honest build of design_handoff_guardian_app README "Club notices": the guardian's
// received-broadcasts inbox — tone-coloured cards (sender line, title, timestamp, body),
// read-only. Marking a card read drives the unread badge on the More launcher row.
//
// READ-ONLY CONSUMPTION — guardians receive, they don't compose or reply. Composing lives on
// the operator/coach side (apps/venue AnnouncementsTab → club_send_announcement; the coach's
// club_manager_send_announcement, mig 392) and lands in club_announcements, which this reader
// surfaces to the child's guardians. Backend (mig 434):
//   • guardian_list_child_notices(child)   → the CHILD's visible notices + this guardian's
//                                             read flag + unread_count (sender resolved to
//                                             composer / team coach / club name)
//   • guardian_mark_notice_read(id, child) → records the read (auth-only, guardian-gated)
//
// Tone is derived from audience (no importance column exists yet — that's the unbuilt
// messaging upgrade): team = amber (coach/team), club & cohort = info (blue).
//
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens).

import { useState, useEffect, useCallback } from "react";
import { guardianListChildNotices, guardianMarkNoticeRead } from "@platform/core";
import MIcon from "../icons.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// audience → tone (icon + colour) + a short context label for the eyebrow.
const TONE = {
  team:   { icon: "shield", soft: "var(--amber-soft)", ink: "var(--amber)",    label: "Team" },
  cohort: { icon: "users",  soft: "var(--info-soft)",  ink: "var(--info-ink)",  label: "Group" },
  club:   { icon: "info",   soft: "var(--info-soft)",  ink: "var(--info-ink)",  label: "Club-wide" },
};

// timestamptz → a friendly when-line in Europe/London.
function fmtWhen(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt)) return "";
  const now = new Date();
  const mins = Math.floor((now - dt) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", day: "numeric", month: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(dt).map((x) => [x.type, x.value])
  );
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.day} ${MONTHS[Number(p.month) - 1]} · ${hh}:${p.minute}`;
}

export default function GuardianNotices({ childId, childFirst, toast, onBack, onUnreadChange }) {
  const [state, setState] = useState({ loading: true, error: false, notices: [] });
  const [savingAll, setSavingAll] = useState(false);

  const load = useCallback(async () => {
    if (!childId) { setState({ loading: false, error: false, notices: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await guardianListChildNotices(childId);
      setState({ loading: false, error: false, notices: res?.notices || [] });
    } catch {
      setState({ loading: false, error: true, notices: [] });
    }
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, notices } = state;
  const unread = notices.filter((n) => !n.read).length;

  // Keep the parent's unread badge in sync (post-commit, never during render).
  useEffect(() => {
    if (!loading && !error) onUnreadChange?.(unread);
  }, [unread, loading, error, onUnreadChange]);

  // Mark one notice read (optimistic). Silent on the happy path; reverts on failure.
  const markRead = useCallback(async (notice) => {
    if (notice.read) return;
    setState((s) => ({ ...s, notices: s.notices.map((n) => (n.id === notice.id ? { ...n, read: true } : n)) }));
    try {
      await guardianMarkNoticeRead(notice.id, childId);
    } catch {
      setState((s) => ({ ...s, notices: s.notices.map((n) => (n.id === notice.id ? { ...n, read: false } : n)) }));
    }
  }, [childId]);

  const markAll = useCallback(async () => {
    const unreadNotices = state.notices.filter((n) => !n.read);
    if (!unreadNotices.length || savingAll) return;
    setSavingAll(true);
    setState((s) => ({ ...s, notices: s.notices.map((n) => ({ ...n, read: true })) }));
    try {
      await Promise.all(unreadNotices.map((n) => guardianMarkNoticeRead(n.id, childId)));
      toast?.({ icon: "check", text: "All notices marked read" });
    } catch {
      load(); // re-sync truth on partial failure
      toast?.({ icon: "alert", text: "Couldn't mark all read" });
    } finally {
      setSavingAll(false);
    }
  }, [state.notices, savingAll, childId, toast, load]);

  if (loading) return <Frame onBack={onBack}><Note>Loading {childFirst ? `${childFirst}'s` : "your"} notices…</Note></Frame>;
  if (error) {
    return (
      <Frame onBack={onBack}>
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 14, margin: 0 }}>Couldn't load club notices right now.</p>
          <button onClick={load} style={pillBtn}>Try again</button>
        </div>
      </Frame>
    );
  }
  if (!notices.length) {
    return (
      <Frame onBack={onBack}>
        <Note>No notices yet. Messages from {childFirst}'s club and coaches will appear here.</Note>
      </Frame>
    );
  }

  return (
    <Frame onBack={onBack}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 2px 8px" }}>
        <div className="m-eyebrow" style={{ flex: 1 }}>
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </div>
        {unread > 0 && (
          <button onClick={markAll} disabled={savingAll} style={{
            flex: "none", fontSize: 12, fontWeight: 700, padding: "5px 11px", cursor: savingAll ? "default" : "pointer",
            borderRadius: "var(--r-pill)", background: "var(--amber-soft)", border: "1px solid var(--amber-glow)",
            color: "var(--amber)", fontFamily: "var(--m-font)", opacity: savingAll ? 0.6 : 1,
          }}>Mark all read</button>
        )}
      </div>

      {notices.map((n) => {
        const tone = TONE[n.audience] || TONE.club;
        return (
          <button
            key={n.id}
            onClick={() => markRead(n)}
            className="m-card"
            style={{
              width: "100%", textAlign: "left", display: "block", marginBottom: 9, padding: "13px 14px",
              fontFamily: "var(--m-font)", color: "inherit", cursor: n.read ? "default" : "pointer",
              borderLeft: n.audience === "team" ? "3px solid var(--amber)" : "3px solid transparent",
              opacity: n.read ? 0.82 : 1,
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                background: tone.soft,
              }}>
                <MIcon name={tone.icon} size={18} color={tone.ink} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {n.sender_label || "Club"}
                  </span>
                  {!n.read && (
                    <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: "var(--amber)" }} aria-label="Unread" />
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink4)", marginTop: 1 }}>
                  {tone.label} · {fmtWhen(n.created_at)}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", marginTop: 11, lineHeight: 1.3 }}>
              {n.title}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {n.body}
            </div>
          </button>
        );
      })}

      <p style={{ fontSize: 11.5, color: "var(--ink4)", textAlign: "center", margin: "14px 8px 4px", lineHeight: 1.5 }}>
        Notices are one-way — only your club and coaches can post here.
      </p>
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
