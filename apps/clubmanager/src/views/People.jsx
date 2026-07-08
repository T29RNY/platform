import React, { useCallback, useEffect, useState } from "react";
import { venueListClubStaff, venueListMembers } from "@platform/core/storage/supabase.js";

// People — the club's coaches/staff (real, via venue_list_club_staff) and paid
// members (via venue_list_members). Read-only in PR #1/#2; coach ASSIGN and the
// per-team youth roster + clinical member detail are deferred to a later PR
// (they need a venue-token club-roster read that doesn't exist yet, and the
// clinical fields are DPIA/safeguarding-gated child special-category data).
function dbsChip(row) {
  if (!row.dbs_id || !row.dbs_status) return { cls: "danger", label: "No DBS" };
  const s = String(row.dbs_status).toLowerCase();
  if (s === "valid" || s === "verified" || s === "clear") {
    if (row.dbs_expiry_date) {
      const days = (new Date(row.dbs_expiry_date + "T00:00:00").getTime() - Date.now()) / 86400000;
      // Unparseable expiry on a safeguarding surface: don't claim a clean "Valid".
      if (Number.isNaN(days)) return { cls: "warn", label: "Check" };
      if (days < 0) return { cls: "danger", label: "Expired" };
      if (days <= 60) return { cls: "warn", label: "Expiring" };
    }
    return { cls: "good", label: "Valid" };
  }
  return { cls: "danger", label: "Not valid" };
}

function CoachesSection({ venueId, clubId }) {
  const [state, setState] = useState({ loading: true, error: false, staff: [] });
  const load = useCallback(async () => {
    if (!venueId || !clubId) { setState({ loading: false, error: false, staff: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const staff = await venueListClubStaff(venueId, clubId);
      setState({ loading: false, error: false, staff: Array.isArray(staff) ? staff : [] });
    } catch { setState({ loading: false, error: true, staff: [] }); }
  }, [venueId, clubId]);
  useEffect(() => { load(); }, [load]);

  const { loading, error, staff } = state;
  const active = staff.filter((s) => s.is_active !== false);

  return (
    <div className="tile" style={{ minHeight: 0 }}>
      <h3>Coaches &amp; staff</h3>
      {loading && <div className="state">Loading coaches…</div>}
      {error && (<><div className="state err">Couldn't load coaches.</div><button className="retry" onClick={load}>Try again</button></>)}
      {!loading && !error && active.length === 0 && <div className="state">No coaches assigned yet.</div>}
      {!loading && !error && active.length > 0 && (
        <table className="atable">
          <thead><tr><th>Name</th><th>Team</th><th>Role</th><th className="num">DBS</th></tr></thead>
          <tbody>
            {active.map((row, i) => {
              const c = dbsChip(row);
              return (
                <tr key={row.member_profile_id ? `${row.member_profile_id}-${row.team_id}` : i}>
                  <td>{`${row.first_name || ""} ${row.last_name || ""}`.trim() || "Coach"}</td>
                  <td style={{ color: "var(--t2)" }}>{row.team_name || "—"}</td>
                  <td style={{ color: "var(--t2)" }}>{row.role || "coach"}</td>
                  <td className="num"><span className={`rag rag--${c.cls}`}><span className="dot" />{c.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MembersSection({ venueId }) {
  const [state, setState] = useState({ loading: true, error: false, members: [] });
  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, members: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // venueListMembers already unwraps to the members array server-side.
      const res = await venueListMembers(venueId);
      setState({ loading: false, error: false, members: Array.isArray(res) ? res : [] });
    } catch { setState({ loading: false, error: true, members: [] }); }
  }, [venueId]);
  useEffect(() => { load(); }, [load]);

  const { loading, error, members } = state;

  return (
    <div className="tile" style={{ minHeight: 0 }}>
      <h3>Members</h3>
      {loading && <div className="state">Loading members…</div>}
      {error && (<><div className="state err">Couldn't load members.</div><button className="retry" onClick={load}>Try again</button></>)}
      {!loading && !error && members.length === 0 && (
        <div className="state">No paid members yet. Membership sign-ups land in a later release.</div>
      )}
      {!loading && !error && members.length > 0 && (
        <table className="atable">
          <thead><tr><th>Name</th><th>Tier</th><th className="num">Status</th></tr></thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={m.membership_id || m.customer_id || i}>
                <td>{`${m.first_name || ""} ${m.last_name || ""}`.trim() || "Member"}</td>
                <td style={{ color: "var(--t2)" }}>{m.tier_name || "—"}</td>
                <td className="num" style={{ color: "var(--t2)" }}>{m.status || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function People({ venueId, clubId }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h2>People</h2>
          <p className="sub">Coaches, staff and members.</p>
        </div>
      </div>
      <div className="tiles tiles--2">
        <CoachesSection venueId={venueId} clubId={clubId} />
        <MembersSection venueId={venueId} />
      </div>
    </>
  );
}
