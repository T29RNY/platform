import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";
import { guardianListChildrenSessions, memberRsvpSession } from "@platform/core/storage/supabase.js";
import { Chats, User, House } from "@phosphor-icons/react";
import NavBar from "../components/ui/NavBar.jsx";
import Tour from "../components/Tour.jsx";
import { deriveGuardianContext } from "../lib/deriveContext.js";
import { clubToursEnabled } from "../lib/tourRegistry.js";

function formatWhen(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

const RSVP = [
  { key: "in",    label: "In",    on: C.green },
  { key: "maybe", label: "Maybe", on: C.amber },
  { key: "out",   label: "Out",   on: C.red },
];

function isMatch(t) {
  return t === "match" || t === "friendly";
}

function SessionRow({ session, childId, onRsvp, saving }) {
  const match = isMatch(session.session_type);
  const heading = match
    ? `${session.home_away === "away" ? "Away" : "Home"} vs ${session.opponent_name || "TBC"}`
    : session.title;
  const when = formatWhen(session.meet_time || session.scheduled_at);

  return (
    <div style={{
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "12px 14px", marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
          color: match ? C.amber : C.muted,
          border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 6px",
        }}>
          {match ? "Match" : (session.session_type || "Training")}
        </span>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{heading}</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>
        {session.club_name}{session.cohort_name ? ` · ${session.cohort_name}` : ""}
      </div>
      {when && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{when}</div>}

      <div style={{ display: "flex", gap: 6 }}>
        {RSVP.map(({ key, label, on }) => {
          const active = session.own_rsvp_status === key;
          return (
            <button
              key={key}
              disabled={saving}
              onClick={() => onRsvp(session.session_id, childId, key)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 8, cursor: saving ? "default" : "pointer",
                border: `1px solid ${active ? on : C.border}`,
                background: active ? on : C.surface,
                color: active ? C.black : C.text,
                fontFamily: "Inter,sans-serif", fontSize: 12, fontWeight: 700,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChildBlock({ child, onRsvp, savingKey }) {
  const sessions = child.sessions || [];
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontFamily: "Bebas Neue,sans-serif", fontSize: 22, color: C.amber, letterSpacing: 2 }}>
          {child.first_name} {child.last_name}
        </div>
        <a data-tour="follow-live-link" href={`/follow-live/${child.profile_id}`} style={{
          fontSize: 12, color: C.amber, fontWeight: 700, textDecoration: "none",
        }}>
          Follow live →
        </a>
      </div>
      {sessions.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, padding: "4px 2px 6px" }}>
          No upcoming training or matches.
        </div>
      ) : (
        sessions.map((s) => (
          <SessionRow
            key={s.session_id}
            session={s}
            childId={child.profile_id}
            onRsvp={onRsvp}
            saving={savingKey === `${s.session_id}:${child.profile_id}`}
          />
        ))
      )}
    </div>
  );
}

export default function ParentHomeScreen() {
  const [children, setChildren] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [activeChild, setActiveChild] = useState("all");
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    guardianListChildrenSessions()
      .then((c) => setChildren(c || []))
      .catch((err) => console.error("[parent-home] load failed", err))
      .finally(() => setLoading(false));
  }, []);

  // Optimistic RSVP on behalf of a child (member_rsvp_session is guardian-aware).
  const handleRsvp = async (sessionId, childId, status) => {
    const key = `${sessionId}:${childId}`;
    const prev = children;
    setSavingKey(key);
    setChildren((cs) => cs.map((c) => c.profile_id !== childId ? c : {
      ...c,
      sessions: (c.sessions || []).map((s) =>
        s.session_id === sessionId ? { ...s, own_rsvp_status: status } : s),
    }));
    try {
      await memberRsvpSession(sessionId, status, { forProfileId: childId });
    } catch (err) {
      console.error("[parent-home] rsvp failed", err);
      setChildren(prev); // revert
    } finally {
      setSavingKey(null);
    }
  };

  const go = (href) => { window.location.href = href; };
  const guardianTabs = (() => {
    deriveGuardianContext(); // descriptor (Phase 1 — single guardian context)
    return [
      { id: "home",     label: "Home",     Icon: House, active: true,  onSelect: () => {} },
      { id: "sessions", label: "Sessions", Icon: Chats, active: false, onSelect: () => go("/sessions") },
      { id: "profile",  label: "Profile",  Icon: User,  active: false, onSelect: () => go("/profile") },
    ];
  })();

  const visible = activeChild === "all"
    ? children
    : children.filter((c) => c.profile_id === activeChild);

  return (
    <div style={{ background: C.bg, minHeight: "100dvh", color: C.text,
      maxWidth: 430, margin: "0 auto", fontFamily: "Inter,sans-serif", paddingBottom: 90 }}>
      <div style={{ padding: "20px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: "Bebas Neue,sans-serif", fontSize: 28, color: C.amber, letterSpacing: 3 }}>
          IN OR OUT
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          Set your children's availability
        </div>
      </div>

      {children.length > 1 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 0" }}>
          {[{ profile_id: "all", first_name: "All" }, ...children].map((c) => {
            const active = activeChild === c.profile_id;
            return (
              <button
                key={c.profile_id}
                onClick={() => setActiveChild(c.profile_id)}
                style={{
                  flexShrink: 0, padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${active ? C.amber : C.border}`,
                  background: active ? C.amber : C.surface,
                  color: active ? C.black : C.text,
                  fontSize: 12, fontWeight: 700,
                }}
              >
                {c.first_name}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ padding: "18px 18px 0" }}>
        {loading && (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", paddingTop: 40 }}>
            Loading…
          </div>
        )}

        {!loading && children.length === 0 && (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>👶</div>
            <div style={{ fontSize: 14, color: C.muted }}>
              No children linked to your account yet.
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
              Ask your club to link your child's membership.
            </div>
          </div>
        )}

        {!loading && visible.map((child) => (
          <ChildBlock key={child.profile_id} child={child} onRsvp={handleRsvp} savingKey={savingKey} />
        ))}
      </div>

      <Tour tourKey="io_tour_guardian_home" enabled={clubToursEnabled()} />
      <NavBar tabs={guardianTabs} />
    </div>
  );
}
