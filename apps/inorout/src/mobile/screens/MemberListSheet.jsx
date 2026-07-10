// MemberListSheet.jsx — shared drill-down sheet for the club-admin /hub track.
// A stat tile on ClubAdminMoney / ClubAdminMemberships is tapped → this sheet lists
// the members behind that number (Active / Due soon / Ending / Frozen). Reused by
// both screens (one component, one contract) so the two surfaces stay synchronous.
//
// Reads NOTHING of its own — the caller passes a pre-filtered array of
// venue_list_members rows (mig 410 shape: first_name, last_name, tier_name, status,
// renews_at, frozen_until, cancel_at, amount_pence, …). The caller derives each
// bucket client-side from the SAME venueListMembers read the desktop uses, so no new
// backend. Uses the shared (portaled) MobileSheet, so it clears the docked nav.

import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Unnamed";
function cap(s) { const t = String(s || "").trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; }
function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}
function hueFor(name) {
  let h = 0; const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function Avatar({ name, size = 40 }) {
  const hue = hueFor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: 12, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, hsl(${hue} 30% 36%) 0 55%, hsl(${hue} 30% 26%) 100%)`,
      color: "white", fontSize: size * 0.32, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(name)}</div>
  );
}

// title    — sheet heading (the tile that was tapped)
// members  — pre-filtered array of venue_list_members rows
// dateField/dateLabel — optional trailing date (e.g. "renews_at" / "renews")
// emptyText — shown when the filtered list is empty
export default function MemberListSheet({ title, members, dateField, dateLabel, emptyText, onClose }) {
  const rows = Array.isArray(members) ? members : [];
  return (
    <MobileSheet title={`${title} · ${rows.length}`} onClose={onClose}>
      {rows.length === 0 ? (
        <div style={{ padding: "26px 6px", textAlign: "center", color: "var(--ink3)" }}>
          <MIcon name="users" size={24} color="var(--ink4)" />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>{emptyText || "No members here"}</div>
        </div>
      ) : (
        rows.map((m) => {
          const name = fullName(m);
          const sub = [m.tier_name || "Member", m.status && m.status !== "active" ? cap(m.status) : null].filter(Boolean).join(" · ");
          const when = dateField ? fmtDate(m[dateField]) : null;
          return (
            <div key={m.membership_id || m.member_profile_id || name} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--hair)",
            }}>
              <Avatar name={name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
              </div>
              {when && (
                <div style={{ flex: "none", textAlign: "right" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>{when}</div>
                  {dateLabel && <div style={{ fontSize: 10.5, color: "var(--ink4)", marginTop: 1 }}>{dateLabel}</div>}
                </div>
              )}
            </div>
          );
        })
      )}
    </MobileSheet>
  );
}
