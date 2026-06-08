import React, { useEffect, useMemo, useState } from "react";
import { venueListCustomers, venueRequestNudge } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import CustomerDetailModal from "./CustomerDetailModal.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState, Crest } from "./atoms.jsx";
import { getInitials, poundsRound, relativeFrom } from "../lib/format.js";

const NUDGE_TEMPLATES = {
  dormant: [["dormant_winback", "Win them back"], ["offer_slot", "Offer a slot"]],
  lapsing: [["check_in", "Friendly check-in"], ["offer_slot", "Offer a slot"]],
  healthy: [["check_in", "Friendly check-in"], ["offer_slot", "Offer a regular slot"]],
  new:     [["check_in", "Welcome / check-in"]],
};

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
  const [nudgeFor, setNudgeFor] = useState(null); // customer obj | null
  const [detailFor, setDetailFor] = useState(null); // customer obj | null

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
              <div className="customer-card" key={c.booker_key} onClick={() => setDetailFor(c)} title="View bookings">
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
                  <span style={{ flex: 1 }} />
                  {c.is_team && (
                    <button className="btn btn-xs" onClick={(e) => { e.stopPropagation(); setNudgeFor(c); }}>
                      <Icon name="whatsapp" size={13} /> Nudge
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailFor && (
        <CustomerDetailModal
          customer={detailFor}
          venueToken={venueToken}
          onClose={() => setDetailFor(null)}
          onNudge={(c) => { setDetailFor(null); setNudgeFor(c); }}
        />
      )}
      {nudgeFor && (
        <NudgeModal customer={nudgeFor} venueToken={venueToken} onClose={() => setNudgeFor(null)} />
      )}
    </div>
  );
}

function NudgeModal({ customer, venueToken, onClose }) {
  const options = NUDGE_TEMPLATES[customer.nudge_status] || NUDGE_TEMPLATES.healthy;
  const [template, setTemplate] = useState(options[0][0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await venueRequestNudge(venueToken, customer.booker_key, template);
      if (r?.ok) setResult(r);
      else setError(r?.reason === "no_contact" ? "No contact on file for this booker." : "Couldn't queue the nudge.");
    } catch (e) {
      setError("Couldn't queue the nudge — try again.");
    } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title={`Nudge ${customer.name}`}
      foot={result ? (
        <><span className="spacer" /><button className="btn btn-primary" onClick={onClose}>Done</button></>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={send} disabled={busy}>{busy ? "Queuing…" : "Send nudge"}</button>
        </>
      )}>
      {result ? (
        <p className="text-mute">Queued to {result.recipients} contact{result.recipients === 1 ? "" : "s"} — it sends from the venue automatically (email now; WhatsApp/SMS once those channels are switched on). The booker’s contact details are never shown here.</p>
      ) : (
        <>
          <p className="text-mute" style={{ marginBottom: 14 }}>Pick a message. It’s sent to the team’s admins on your behalf — you never see their contact details.</p>
          <label className="field-label">Message</label>
          <div style={{ display: "grid", gap: 8 }}>
            {options.map(([id, label]) => (
              <button key={id} type="button" className="charge-opt" onClick={() => setTemplate(id)}
                style={{ borderColor: template === id ? "var(--accent)" : "var(--border)" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
              </button>
            ))}
          </div>
          {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
        </>
      )}
    </Modal>
  );
}
