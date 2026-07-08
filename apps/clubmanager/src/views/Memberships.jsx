import React, { useCallback, useEffect, useState } from "react";
import {
  venueMembershipSummary,
  venueGetCharges,
  venueListMembers,
  venueListMembershipTiers,
} from "@platform/core/storage/supabase.js";

// Memberships & payments — the admin money dashboard. DISPLAY-ONLY and
// Stripe-free: every read is a pure venue-token DB read (venueMembershipSummary,
// venueGetCharges, venueListMembers, venueListMembershipTiers) — no Stripe call,
// no live-key dependency (Decision: "displaying money ≠ moving money"). The
// member JOIN/enrol flow is a separate member/public surface (MembershipSignup in
// apps/inorout `/q`); the admin console shows the money + points members there.
function gbp(pence) {
  const p = Number(pence) || 0;
  return "£" + (p / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function Memberships({ venueId }) {
  const [state, setState] = useState({
    loading: true, error: false,
    summary: null, charges: null, members: [], tiers: [],
  });

  const load = useCallback(async () => {
    if (!venueId) { setState((s) => ({ ...s, loading: false })); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [summary, charges, members, tiers] = await Promise.all([
        venueMembershipSummary(venueId).catch(() => null),
        venueGetCharges(venueId, { sourceType: "membership", limit: 200 }).catch(() => null),
        venueListMembers(venueId).catch(() => []),
        venueListMembershipTiers(venueId, true).catch(() => []),   // include inactive so the admin sees the full catalogue (chip marks them)
      ]);
      setState({
        loading: false, error: false,
        summary: summary?.summary || summary || null,
        charges: charges || null,
        members: Array.isArray(members) ? members : [],
        tiers: Array.isArray(tiers) ? tiers : [],
      });
    } catch (err) {
      console.error("[clubmanager] memberships load failed", err);
      setState({ loading: false, error: true, summary: null, charges: null, members: [], tiers: [] });
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, summary, charges, members, tiers } = state;

  if (loading) return (<><div className="page-head"><div><h2>Memberships</h2></div></div><div className="tile"><div className="state">Loading memberships…</div></div></>);
  if (error) {
    return (
      <>
        <div className="page-head"><div><h2>Memberships</h2></div></div>
        <div className="tile"><div className="state err">Couldn't load memberships.</div><button className="retry" onClick={load}>Try again</button></div>
      </>
    );
  }

  const moneySummary = charges?.summary || {};
  const outstanding = (charges?.charges || []).filter((c) => c.status === "unpaid" || c.status === "partial");
  const cohortName = (t) => t?.tier_name || "—";

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Memberships</h2>
          <p className="sub">Members, subs and what's owed. Members sign up on your club page.</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="tiles">
        <div className="tile">
          <h3>Active members</h3>
          <div className="stat-row"><span className="stat">{summary?.active ?? 0}</span></div>
          <div className="state" style={{ marginTop: 6 }}>
            {(summary?.due_soon ?? 0) > 0 ? `${summary.due_soon} renewing soon` : "none renewing imminently"}
            {(summary?.paused ?? 0) > 0 ? ` · ${summary.paused} paused` : ""}
          </div>
        </div>
        <div className="tile">
          <h3>Recurring revenue</h3>
          <div className="stat-row"><span className="stat">{gbp(summary?.mrr_pence)}</span><span className="stat-label">/ month</span></div>
        </div>
        <div className="tile">
          <h3>Subs collected</h3>
          {outstanding.length === 0 ? (
            <div className="stat-row"><span className="stat">{gbp(moneySummary.collected_pence)}</span>
              <span className="rag rag--good"><span className="dot" />all paid</span></div>
          ) : (
            <>
              <div className="stat-row"><span className="stat">{gbp(moneySummary.outstanding_pence)}</span><span className="stat-label">outstanding</span></div>
              <div className="state" style={{ marginTop: 6 }}>
                {gbp(moneySummary.collected_pence)} collected
                {moneySummary.collection_rate != null ? ` · ${Math.round(moneySummary.collection_rate * 100)}% rate` : ""}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Outstanding subs */}
      {outstanding.length > 0 && (
        <div className="tile" style={{ marginTop: 16 }}>
          <h3>Outstanding subs</h3>
          <table className="atable">
            <thead><tr><th>Charge</th><th>Due</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {outstanding.slice(0, 12).map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className={`rag rag--${c.status === "partial" ? "warn" : "danger"}`}><span className="dot" /></span>{" "}
                    {c.status === "partial" ? "Part-paid" : "Unpaid"} membership
                  </td>
                  <td style={{ color: "var(--t2)" }}>{c.due_date || "—"}</td>
                  <td className="num">{gbp(c.balance_pence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tiles tiles--2" style={{ marginTop: 16 }}>
        {/* Members roster */}
        <div className="tile" style={{ minHeight: 0 }}>
          <h3>Members</h3>
          {members.length === 0 ? (
            <div className="state">No paid members yet. They'll appear here once they sign up.</div>
          ) : (
            <table className="atable">
              <thead><tr><th>Name</th><th>Tier</th><th className="num">Status</th></tr></thead>
              <tbody>
                {members.slice(0, 30).map((m) => (
                  <tr key={m.membership_id || m.member_profile_id}>
                    <td>{`${m.first_name || ""} ${m.last_name || ""}`.trim() || "Member"}</td>
                    <td style={{ color: "var(--t2)" }}>{cohortName(m)}</td>
                    <td className="num" style={{ color: "var(--t2)" }}>{m.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Tiers catalogue */}
        <div className="tile" style={{ minHeight: 0 }}>
          <h3>Membership tiers</h3>
          {tiers.length === 0 ? (
            <div className="state">No membership tiers set up yet.</div>
          ) : (
            <table className="atable">
              <thead><tr><th>Tier</th><th className="num">Price</th></tr></thead>
              <tbody>
                {tiers.map((t) => {
                  const price = (t.prices || [])[0];
                  return (
                    <tr key={t.tier_id}>
                      <td>{t.name}{t.active === false ? <span className="chip chip--muted" style={{ marginLeft: 6 }}>inactive</span> : ""}</td>
                      <td className="num">{price ? `${gbp(price.price_pence)}/${price.period || ""}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
