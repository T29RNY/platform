import React, { useEffect, useMemo, useState } from "react";
import { venueListCustomers } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState, Crest } from "./atoms.jsx";
import { getInitials, poundsRound, relativeFrom } from "../lib/format.js";

// Customers — booker directory for this venue (mig 223, venue-domain only).
// Teams and walk-ins that book here, with bookings/spend/recency. No casual
// "ins" or admin contacts (those stay behind the venue<->casual RLS wall).
const STATUS = {
  new:     { label: "New",     cls: "pill-info" },
  healthy: { label: "Healthy", cls: "pill-ok" },
  lapsing: { label: "Lapsing", cls: "pill-warn" },
  dormant: { label: "Dormant", cls: "pill-muted" },
};
const FILTERS = [["all", "All"], ["healthy", "Healthy"], ["lapsing", "Lapsing"], ["dormant", "Dormant"], ["new", "New"]];

export default function CustomersView({ venueToken }) {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all"); // all | teams | walkins

  useEffect(() => {
    let alive = true;
    venueListCustomers(venueToken)
      .then((res) => { if (alive) setCustomers(Array.isArray(res?.customers) ? res.customers : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  const filtered = useMemo(() => {
    let list = customers || [];
    if (status !== "all") list = list.filter((c) => c.nudge_status === status);
    if (kind === "teams") list = list.filter((c) => c.is_team);
    if (kind === "walkins") list = list.filter((c) => !c.is_team);
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((c) => (c.name || "").toLowerCase().includes(term));
    return list;
  }, [customers, status, kind, q]);

  const flagged = (customers || []).filter((c) => c.nudge_status === "dormant" || c.nudge_status === "lapsing").length;

  return (
    <div>
      <SectionHead label="Customers" count={customers == null ? "Loading…" : `${customers.length} booking the venue`}>
        {flagged > 0 && <span className="pill pill-warn">{flagged} need attention</span>}
        <span className="search">
          <span className="ico"><Icon name="search" size={15} /></span>
          <input placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
      </SectionHead>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: "var(--gap-2)" }}>
        <span className="chips">
          {[["all", "All"], ["teams", "Teams"], ["walkins", "Walk-ins"]].map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={kind === v} onClick={() => setKind(v)}>{l}</button>
          ))}
        </span>
        <span className="chips">
          {FILTERS.map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </span>
      </div>

      {error && <EmptyState title="Couldn’t load customers" body={error} />}
      {customers && customers.length === 0 && !error && (
        <EmptyState title="No customers yet" body="Bookers appear here once a team or walk-in books a pitch." />
      )}
      {customers && customers.length > 0 && filtered.length === 0 && (
        <EmptyState title="No customers match" body="Try a different search or filter." />
      )}

      {filtered.length > 0 && (
        <div className="customers-grid">
          {filtered.map((c) => {
            const st = STATUS[c.nudge_status] || STATUS.healthy;
            return (
              <div className="customer-card" key={c.booker_key}>
                <div className="cu-top">
                  {c.is_team
                    ? <span className="cu-crest"><Crest c1={c.primary_colour} c2={c.secondary_colour} size={44} initials={getInitials(c.name)} big seed={c.name} /></span>
                    : <span className="cu-crest" style={{ background: "var(--bg-3)" }}><span style={{ color: "var(--ink-2)" }}>{getInitials(c.name)}</span></span>}
                  <div className="cu-head-text">
                    <div className="cu-name">{c.name}</div>
                    <div className="cu-sub">{c.is_team ? "Registered team" : "Walk-in booker"}</div>
                  </div>
                  <span className={"pill " + st.cls}>{st.label}</span>
                </div>
                <div className="cu-stats">
                  <div className="cu-stat">
                    <div className="cu-stat-label">Bookings</div>
                    <div className="cu-stat-value">{c.bookings_count}</div>
                  </div>
                  <div className="cu-stat">
                    <div className="cu-stat-label">Collected</div>
                    <div className="cu-stat-value">{poundsRound(c.total_paid_pence)}</div>
                  </div>
                  <div className="cu-stat">
                    <div className="cu-stat-label">Outstanding</div>
                    <div className="cu-stat-value" style={c.outstanding_pence > 0 ? { color: "var(--live)" } : null}>{poundsRound(c.outstanding_pence)}</div>
                  </div>
                </div>
                <div className="cu-foot">
                  <span className="text-mute" style={{ fontSize: 12 }}>
                    {c.last_at ? `Active ${relativeFrom(c.last_at)}` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
