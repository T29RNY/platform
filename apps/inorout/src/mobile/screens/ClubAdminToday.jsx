// ClubAdminToday.jsx — Club-admin track, screen 1 ("Today"), mounted at /hub for a
// club_admin role, tab "today". The phone twin of the desktop club lens's
// Monday-morning ops home (apps/venue/src/views/ClubHome.jsx), scoped to the ONE
// club whose shell venue the caller owns (Club Console PR #6b, Decision 10).
//
// The needs-you-now glance for a club admin on the move: DBS gaps in the coaching
// team, pending join requests to approve, and pitch clashes to resolve — each with
// its inline action. Deep setup stays on the desktop console.
//
// AUTH: a club admin passes their shell venue_id as the credential (role.entityId).
// resolve_venue_caller Stage-1b authenticates them via auth.uid() against
// venue_admins — the same venue-token path the operator track and desktop console
// use. clubId (role.clubId) scopes the club-staff read. No token, no new RPC.
//
// Reuses existing venue-token wrappers only (no new backend): venueListClubStaff
// (DBS), venueListCustomersPeople (pending join requests — venue_customers, the
// ONLY table carrying status='pending'; venue_list_members reads venue_memberships
// which has no pending state), venueListBumpProposals + venueResolveBump (pitch
// clashes), venueApproveCustomer (approve a join — by the customer-people row id).

import { useState, useEffect, useCallback, useRef } from "react";
import {
  venueListClubStaff, venueListCustomersPeople, venueApproveCustomer,
  venueListBumpProposals, venueResolveBump,
} from "@platform/core";
import MIcon from "../icons.jsx";

// DBS severity — a verbatim port of the desktop board's dbsChip classifier
// (apps/venue/src/views/SafeguardingBoard.jsx): 60-day expiring window, missing /
// invalid → critical. Kept identical so the phone and console agree.
function dbsSeverity(row) {
  if (!row.dbs_id || !row.dbs_status) return { tone: "crit", label: "No DBS" };
  const s = String(row.dbs_status).toLowerCase();
  if (s === "valid" || s === "verified" || s === "clear") {
    if (row.dbs_expiry_date) {
      const days = (new Date(row.dbs_expiry_date + "T00:00:00").getTime() - Date.now()) / 86400000;
      if (Number.isNaN(days)) return { tone: "warn", label: "Check" };
      if (days < 0) return { tone: "crit", label: "Expired" };
      if (days <= 60) return { tone: "warn", label: "Expiring" };
    }
    return { tone: "ok", label: "Valid" };
  }
  return { tone: "crit", label: "Not valid" };
}

const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Unnamed";

// Bump proposal slot label (mirrors BumpProposalsBanner.slotLabel, date-lib-free).
function slotLabel(p) {
  if (!p.suggested_start) return null;
  const where = [p.suggested_pitch_name, p.suggested_venue_name].filter(Boolean).join(" · ");
  const d = new Date(p.suggested_start);
  if (Number.isNaN(d.getTime())) return where || null;
  const when = d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${where ? where + " · " : ""}${when}`;
}

export default function ClubAdminToday({ venueToken, clubId, clubName, toast }) {
  const [state, setState] = useState({ loading: true, error: false, staff: [], pending: [], proposals: [] });
  const [busy, setBusy] = useState({}); // id → bool (approve / bump)

  // Tappable stat tiles jump to their section (operator #399 parity).
  const dbsRef = useRef(null);
  const joinRef = useRef(null);
  const bumpRef = useRef(null);
  const scrollTo = (r) => r.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setState({ loading: false, error: false, staff: [], pending: [], proposals: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [staff, customers, bump] = await Promise.all([
        venueListClubStaff(venueToken, clubId),
        venueListCustomersPeople(venueToken).catch(() => []),
        venueListBumpProposals(venueToken).catch(() => null),
      ]);
      const pending = (Array.isArray(customers) ? customers : []).filter((c) => c.status === "pending");
      const proposals = bump?.proposals ?? (Array.isArray(bump) ? bump : []);
      setState({ loading: false, error: false, staff: Array.isArray(staff) ? staff : [], pending, proposals });
    } catch {
      setState({ loading: false, error: true, staff: [], pending: [], proposals: [] });
    }
  }, [venueToken, clubId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, staff, pending, proposals } = state;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Club today</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {clubName || "your club"}…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Club today</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your club right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  // DBS attention — active coaching staff whose DBS is expired/expiring/missing.
  // venue_list_club_staff returns one row per (coach, team), so a coach on two
  // teams appears twice with the same person + DBS — dedupe by person so each
  // flagged coach shows once (and React keys stay unique).
  const dbsSeen = new Set();
  const dbsAlerts = staff
    .filter((r) => r.is_active !== false)
    .map((r) => ({ row: r, sev: dbsSeverity(r) }))
    .filter((x) => x.sev.tone === "crit" || x.sev.tone === "warn")
    .filter((x) => {
      const k = x.row.member_profile_id || x.row.dbs_id || fullName(x.row);
      if (dbsSeen.has(k)) return false;
      dbsSeen.add(k);
      return true;
    })
    .sort((a, b) => (a.sev.tone === "crit" ? 0 : 1) - (b.sev.tone === "crit" ? 0 : 1));
  const dbsCrit = dbsAlerts.filter((x) => x.sev.tone === "crit").length;

  const issues = dbsAlerts.length + pending.length + proposals.length;

  // ── Approve a pending join request ──
  const approve = async (m) => {
    const id = m.id;
    if (!id || busy[id]) return;
    setBusy((s) => ({ ...s, [id]: true }));
    try {
      await venueApproveCustomer(venueToken, id, true);
      toast?.({ icon: "check", text: `${fullName(m)} approved` });
      await load();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't approve — try again" });
      setBusy((s) => ({ ...s, [id]: false }));
    }
  };

  // ── Resolve a pitch-clash bump proposal (accept the suggested slot, or decline) ──
  const resolveBump = async (p, action) => {
    if (busy[p.id]) return;
    setBusy((s) => ({ ...s, [p.id]: true }));
    try {
      const res = await venueResolveBump(venueToken, p.id, action);
      if (res?.retry) {
        toast?.({ icon: "refresh", text: "That slot was just taken — new suggestion loaded" });
        await load();
        return;
      }
      toast?.({ icon: action === "accept" ? "check" : "x", text: action === "accept" ? "Moved to the new slot" : "Left for the manager" });
      await load();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't update — try again" });
      setBusy((s) => ({ ...s, [p.id]: false }));
    }
  };

  return (
    <div>
      {/* ── stat strip ── */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "8px 0 2px", scrollbarWidth: "none" }}>
        <StatTile tone={dbsCrit ? "live" : dbsAlerts.length ? "amber" : "ink"} label="DBS" value={dbsAlerts.length} sub={dbsCrit ? `${dbsCrit} expired/missing` : "expiring"} onClick={dbsAlerts.length ? () => scrollTo(dbsRef) : undefined} />
        <StatTile tone={pending.length ? "amber" : "ink"} label="Join requests" value={pending.length} sub="to approve" onClick={pending.length ? () => scrollTo(joinRef) : undefined} />
        <StatTile tone={proposals.length ? "amber" : "ink"} label="Pitch clashes" value={proposals.length} sub="to resolve" onClick={proposals.length ? () => scrollTo(bumpRef) : undefined} />
      </div>

      {/* ── NEEDS YOU ── */}
      <SecHead title="Needs you" meta={issues ? `${issues} item${issues === 1 ? "" : "s"}` : ""} />
      {issues === 0 && (
        <div className="m-card" style={{ padding: "24px 18px", textAlign: "center" }}>
          <MIcon name="check" size={26} color="var(--ok)" />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>All clear — nothing needs you at {clubName || "your club"}</div>
        </div>
      )}

      {/* DBS attention */}
      <div ref={dbsRef} style={{ scrollMarginTop: 12 }}>
      {dbsAlerts.length > 0 && <div className="m-eyebrow" style={{ margin: "2px 2px 9px" }}>Coach DBS · review on desktop</div>}
      {dbsAlerts.map(({ row, sev }) => (
        <div key={`dbs-${row.member_profile_id || row.dbs_id || fullName(row)}`} className="m-card" style={{ padding: "13px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
            background: sev.tone === "crit" ? "var(--live-soft)" : "var(--amber-soft)",
          }}><MIcon name="shield" size={19} color={sev.tone === "crit" ? "var(--live)" : "var(--amber)"} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(row)}</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.team_name || "Coach"}
            </div>
          </div>
          <Chip tone={sev.tone} text={sev.label} />
        </div>
      ))}
      </div>

      {/* Join requests */}
      <div ref={joinRef} style={{ scrollMarginTop: 12 }}>
      {pending.length > 0 && <div className="m-eyebrow" style={{ margin: "14px 2px 9px" }}>Join requests</div>}
      {pending.map((m) => {
        const b = !!busy[m.id];
        return (
          <div key={`join-${m.id}`} className="m-card" style={{ padding: "13px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--amber-soft)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><MIcon name="users" size={19} color="var(--amber)" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(m)}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Wants to join
              </div>
            </div>
            <IconAction icon="check" tone="ok" busy={b} onClick={() => approve(m)} aria="Approve" />
          </div>
        );
      })}
      </div>

      {/* Pitch clashes */}
      <div ref={bumpRef} style={{ scrollMarginTop: 12 }}>
      {proposals.length > 0 && <div className="m-eyebrow" style={{ margin: "14px 2px 9px" }}>Pitch clashes</div>}
      {proposals.map((p) => {
        const b = !!busy[p.id];
        const sugg = slotLabel(p);
        return (
          <div key={`bump-${p.id}`} className="m-card" style={{ padding: "13px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flex: "none", background: "var(--amber)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{p.club_team_name || "A team"} was bumped</div>
                <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 4, lineHeight: 1.35 }}>
                  {sugg ? <>Closest free: <strong style={{ color: "var(--ink2)" }}>{sugg}</strong></> : "No automatic alternative — needs a manual re-book."}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
              <button onClick={() => resolveBump(p, "decline")} disabled={b} style={{
                flex: 1, height: 36, borderRadius: "var(--r-pill)", cursor: b ? "default" : "pointer",
                background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--ink2)", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--m-font)", opacity: b ? 0.5 : 1,
              }}>Leave it</button>
              <button onClick={() => resolveBump(p, "accept")} disabled={b || !p.suggested_start} style={{
                flex: 1, height: 36, borderRadius: "var(--r-pill)", cursor: b || !p.suggested_start ? "default" : "pointer",
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 800, fontSize: 13, fontFamily: "var(--m-font)", opacity: b || !p.suggested_start ? 0.5 : 1,
              }}>{b ? "…" : "Accept slot"}</button>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function StatTile({ tone, label, value, sub, onClick }) {
  const col = tone === "live" ? "var(--live)" : tone === "amber" ? "var(--amber)" : "var(--ink)";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="m-card" style={{
      flex: "none", width: 122, padding: "13px 13px", display: "flex", flexDirection: "column", gap: 6,
      textAlign: "left", cursor: onClick ? "pointer" : "default", fontFamily: "var(--m-font)", color: "inherit",
    }}>
      <span className="m-eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: col, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </Tag>
  );
}

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}

function Chip({ tone, text }) {
  const bg = tone === "crit" ? "var(--live-soft)" : tone === "warn" ? "var(--amber-soft)" : "var(--s3)";
  const ink = tone === "crit" ? "var(--live)" : tone === "warn" ? "var(--amber)" : "var(--ink2)";
  return (
    <span style={{
      height: 21, fontSize: 11, padding: "0 8px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", fontWeight: 700, flex: "none",
      background: bg, color: ink,
    }}>{text}</span>
  );
}

function IconAction({ icon, tone, busy, onClick, aria }) {
  const soft = tone === "ok" ? "var(--ok-soft)" : "var(--live-soft)";
  const ink = tone === "ok" ? "var(--ok-ink)" : "var(--live-ink)";
  return (
    <button onClick={onClick} disabled={busy} aria-label={aria} style={{
      width: 34, height: 34, borderRadius: 10, flex: "none", cursor: busy ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: soft, border: "none", opacity: busy ? 0.5 : 1,
    }}><MIcon name={icon} size={16} color={ink} /></button>
  );
}
