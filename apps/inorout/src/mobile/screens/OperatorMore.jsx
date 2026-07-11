// OperatorMore.jsx — Operator track, the "All views" launcher hub (mounted at /hub, tab "more").
//
// Mirrors design_handoff_guardian_app m-more.jsx OperatorMoreSheet(): a searchable directory of
// venue views grouped by NAV_GROUPS, EXCLUDING the views already on the bottom tab bar
// (Operations/Bookings/Payments + People's Members/Teams/Staff), plus a "Venue tools" block.
//
// Every directory row + every venue tool is shown as "Soon": none of these views has a mobile
// screen yet, and the prototype itself only renders branded Placeholders for them. We do NOT
// deep-link to the laptop venue dashboard (poor WKWebView UX) or invent backends. When those
// screens get built, flip soon→false and wire the handler — same shape as GuardianMore.
//
// Role-awareness uses the honest role proxy (roleSub = owner|manager|staff) — the same proxy as
// the People contact-gate, because the mobile client carries no caps (get_my_world/venue_get_state
// return none). FLAG gating from the prototype is skipped (no venue feature-flags reach mobile);
// since every row is "Soon" nothing false is implied.
//
// "Profile & settings" is the one real row — opens the existing shell ProfileSheet.

import { useState } from "react";
import MIcon from "../icons.jsx";

// staff:0  manager:1  owner:2 — matches the prototype's minRole 0/1/2 scale.
const RANK = { owner: 2, manager: 1, staff: 0 };

// Directory of operator views WITHOUT a mobile screen yet (the tab-covered views —
// operations/bookings/payments + members/teams/staff — are deliberately excluded).
const DIRECTORY = [
  { group: "People", rows: [
    { id: "memberships", icon: "card", title: "Memberships", sub: "Tiers, grading, club", minRank: 1 },
  ] },
  { group: "Programmes", rows: [
    { id: "camps", icon: "star", title: "Camps & classes", sub: "Who's booked in", minRank: 1 },
    { id: "timetable", icon: "grid", title: "Timetable", sub: "Classes + team training", minRank: 0 },
    { id: "trainers", icon: "figure", title: "Trainers", sub: "PT roster + appointments", minRank: 1 },
    { id: "equipment", icon: "box", title: "Equipment", sub: "Catalogue, hires, utilisation", minRank: 0 },
    { id: "rooms", icon: "door", title: "Rooms", sub: "Spaces + room bookings", minRank: 0 },
  ] },
  { group: "Competition", rows: [
    { id: "club_leagues", icon: "globe", title: "Club Leagues", sub: "External fixtures + matchday", minRank: 1 },
    { id: "league", icon: "trophy", title: "Internal League", sub: "Overview + season setup", minRank: 1 },
    { id: "standings", icon: "list", title: "Standings", sub: "Round-robin table", minRank: 0 },
    { id: "cups", icon: "cup", title: "Cups", sub: "Knockout brackets", minRank: 1 },
  ] },
  { group: "Club & Admin", rows: [
    { id: "broadcasts", icon: "bell", title: "Broadcasts", sub: "Message teams & members", minRank: 0 },
    { id: "qr", icon: "qr", title: "QR codes", sub: "Join / check-in links", minRank: 0 },
    { id: "access", icon: "key", title: "Access", sub: "Admin roster + capabilities", minRank: 0, ownerOnly: true },
  ] },
];

// Venue-wide tools (operator only). Send broadcast depends on the unbuilt Broadcast composer →
// "Soon"; Reception display + Season setup live on other surfaces → "Soon" toast like the prototype.
const TOOLS = [
  { id: "broadcast", icon: "bell", label: "Send broadcast" },
  { id: "reception", icon: "tv", label: "Reception display" },
  { id: "season", icon: "cup", label: "Season setup" },
];

function rowVisible(row, rank, isOwner) {
  if (rank < row.minRank) return false;
  if (row.ownerOnly && !isOwner) return false;
  return true;
}

export default function OperatorMore({ roleSub = "staff", venueName, onOpenProfile, onOpenCups, onOpenCamps, onOpenSetup, toast }) {
  const [q, setQ] = useState("");
  const rank = RANK[roleSub] ?? 0;
  const isOwner = roleSub === "owner";
  const ql = q.trim().toLowerCase();

  // rows that route to a real screen (the rest are "Soon" toasts)
  const liveOpeners = { cups: onOpenCups, camps: onOpenCamps };

  const groups = DIRECTORY
    .map((g) => ({
      group: g.group,
      rows: g.rows.filter(
        (r) => rowVisible(r, rank, isOwner) && (!ql || (r.title + " " + r.sub).toLowerCase().includes(ql)),
      ),
    }))
    .filter((g) => g.rows.length);

  const soon = (label) => toast?.({ icon: "spark", text: label, sub: "Coming soon" });

  return (
    <div className="m-view-enter">
      {/* search */}
      <div
        className="m-card"
        style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 13px", height: 46, marginBottom: 6 }}
      >
        <MIcon name="search" size={18} color="var(--ink3)" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search views…"
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15,
          }}
        />
      </div>

      {/* Set up venue — a real screen (moved off the tab bar into More). Owner/
          manager only, matching where it lived as a tab. */}
      {rank >= 1 && onOpenSetup && (
        <button
          onClick={onOpenSetup}
          className="m-card"
          style={{
            width: "100%", textAlign: "left", cursor: "pointer", padding: "13px 14px", marginBottom: 9,
            display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)", color: "inherit",
          }}
        >
          <div style={{
            width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--amber-soft)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <MIcon name="cog" size={18} color="var(--amber)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Set up venue</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>Details, hours, pitches &amp; what you offer</div>
          </div>
          <MIcon name="chevron" size={16} color="var(--ink4)" />
        </button>
      )}

      {groups.map((g) => (
        <div key={g.group} style={{ marginTop: 16 }}>
          <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>{g.group}</div>
          {g.rows.map((r) => {
            const opener = liveOpeners[r.id]; // real screen if present; otherwise "Soon"
            const isLive = !!opener;
            return (
              <button
                key={r.id}
                onClick={() => (isLive ? opener() : soon(r.title))}
                className="m-card"
                style={{
                  width: "100%", textAlign: "left", cursor: "pointer", padding: "13px 14px", marginBottom: 9,
                  display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)", color: "inherit",
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 11, flex: "none", background: isLive ? "var(--amber-soft)" : "var(--s4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <MIcon name={r.icon} size={18} color="var(--amber)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</div>
                </div>
                {isLive ? (
                  <MIcon name="chevron" size={16} color="var(--ink4)" />
                ) : (
                  <span style={{
                    flex: "none", fontSize: 10.5, fontWeight: 700, padding: "3px 9px",
                    borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink3)",
                  }}>Soon</span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      {ql && !groups.length && (
        <div className="m-card" style={{ padding: "22px 16px", textAlign: "center", marginTop: 16 }}>
          <div style={{ fontSize: 13.5, color: "var(--ink3)" }}>No views match “{q}”.</div>
        </div>
      )}

      {/* venue tools */}
      <div className="m-eyebrow" style={{ margin: "20px 2px 9px" }}>Venue tools</div>
      <div style={{ display: "flex", gap: 9 }}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => soon(t.label)}
            className="m-card"
            style={{
              flex: 1, cursor: "pointer", padding: "14px 11px", display: "flex", flexDirection: "column",
              gap: 8, alignItems: "flex-start", fontFamily: "var(--m-font)", color: "inherit",
              background: t.id === "broadcast" ? "var(--amber-soft)" : undefined,
              borderColor: t.id === "broadcast" ? "var(--amber-glow)" : undefined,
            }}
          >
            <MIcon name={t.icon} size={20} color={t.id === "broadcast" ? "var(--amber)" : "var(--ink2)"} />
            <span style={{ fontSize: 12.5, fontWeight: 700, textAlign: "left", color: "var(--ink)" }}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* profile & settings — the one real row */}
      <button
        onClick={onOpenProfile}
        className="m-card"
        style={{
          width: "100%", textAlign: "left", cursor: "pointer", marginTop: 16, marginBottom: 4,
          padding: "13px 14px", display: "flex", alignItems: "center", gap: 12,
          fontFamily: "var(--m-font)", color: "inherit",
        }}
      >
        <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <MIcon name="cog" size={18} color="var(--ink2)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Profile & settings</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{venueName ? venueName + " · " : ""}Appearance, account, sign out</div>
        </div>
        <MIcon name="chevron" size={16} color="var(--ink4)" />
      </button>
    </div>
  );
}
