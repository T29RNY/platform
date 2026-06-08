import React, { useEffect, useState } from "react";
import { venueGetCustomer } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { Crest } from "./atoms.jsx";
import { getInitials, poundsRound, poundsFromPence, longDate } from "../lib/format.js";

const BOOKING_STATUS = {
  confirmed: { label: "Confirmed", cls: "pill-ok" },
  requested: { label: "Requested", cls: "pill-warn" },
  cancelled: { label: "Cancelled", cls: "pill-muted" },
  declined:  { label: "Declined",  cls: "pill-muted" },
  expired:   { label: "Expired",   cls: "pill-muted" },
};

const STATUS = {
  new:     { label: "New",     cls: "pill-info" },
  healthy: { label: "Healthy", cls: "pill-ok" },
  lapsing: { label: "Lapsing", cls: "pill-warn" },
  dormant: { label: "Dormant", cls: "pill-muted" },
};

// Customer detail (mig 226) — the booker's bookings (upcoming + recent) with
// charge + live ins on upcoming team sessions. `onNudge` opens the nudge flow.
export default function CustomerDetailModal({ customer, venueToken, onClose, onNudge }) {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    venueGetCustomer(venueToken, customer.booker_key)
      .then((rows) => { if (alive) setBookings(Array.isArray(rows) ? rows : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, customer.booker_key]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (bookings || []).filter((b) => b.booking_date >= today && b.status !== "cancelled");
  const recent = (bookings || []).filter((b) => b.booking_date < today || b.status === "cancelled");
  const st = STATUS[customer.nudge_status] || STATUS.healthy;

  return (
    <Modal onClose={onClose} title={customer.name} wide
      foot={<>
        {customer.is_team && <button className="btn btn-ghost" onClick={() => onNudge?.(customer)}><Icon name="whatsapp" size={14} /> Nudge</button>}
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </>}>
      <div className="cu-detail-head">
        {customer.is_team
          ? <Crest c1={customer.primary_colour} c2={customer.secondary_colour} size={56} initials={getInitials(customer.name)} big seed={customer.name} />
          : <span className="cu-crest cu-crest-xl" style={{ background: "var(--bg-3)" }}><span style={{ color: "var(--ink-2)" }}>{getInitials(customer.name)}</span></span>}
        <div>
          <div className="cu-detail-name">{customer.name}</div>
          <div className="cu-detail-sub">{customer.is_team ? "Registered team" : "Walk-in booker"}</div>
        </div>
        <span className={"pill " + st.cls}>{st.label}</span>
      </div>

      <div className="cu-detail-stats" style={{ marginBottom: 22 }}>
        <div className="cu-stat"><div className="cu-stat-label">Bookings</div><div className="cu-stat-value">{customer.bookings_count}</div></div>
        <div className="cu-stat"><div className="cu-stat-label">Collected</div><div className="cu-stat-value">{poundsRound(customer.total_paid_pence)}</div></div>
        <div className="cu-stat"><div className="cu-stat-label">Outstanding</div><div className="cu-stat-value" style={customer.outstanding_pence > 0 ? { color: "var(--live)" } : null}>{poundsRound(customer.outstanding_pence)}</div></div>
      </div>

      {error && <p style={{ color: "var(--live)", fontSize: 13 }}>{error}</p>}
      {bookings == null && !error && <p className="text-mute">Loading…</p>}

      {upcoming.length > 0 && (
        <>
          <div className="field-label">Upcoming</div>
          <div className="cu-bookings" style={{ marginBottom: 18 }}>
            {upcoming.map((b) => <BookingRow key={b.booking_id} b={b} />)}
          </div>
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className="field-label">Recent</div>
          <div className="cu-bookings cu-bookings--past">
            {recent.slice(0, 12).map((b) => <BookingRow key={b.booking_id} b={b} past />)}
          </div>
        </>
      )}
      {bookings && bookings.length === 0 && <p className="text-mute">No bookings on record.</p>}
    </Modal>
  );
}

function BookingRow({ b, past }) {
  const due = b.amount_due_pence ?? 0;
  const paid = b.paid_pence ?? 0;
  const balance = Math.max(due - paid, 0);
  return (
    <div className={"cu-booking" + (past ? " past" : "")}>
      <div>
        <div className="cb-date">{longDate(b.booking_date)}</div>
        <div className="cb-time">{b.kickoff_time ? String(b.kickoff_time).slice(0, 5) : ""}</div>
      </div>
      <div>
        <div className="cb-pitch"><Icon name="pitch" size={12} /> {(b.pitch_name || "").replace(/ \(.*\)/, "")}</div>
        <div className="cb-source"><span className={"pill " + (b.series_id ? "pill-accent" : "pill-muted")}>{b.series_id ? "Weekly" : "One-off"}</span></div>
      </div>
      <div className="cb-matchup">
        {b.in_count != null
          ? <span className="cb-ins-label" style={{ color: "var(--ok)" }}><strong>{b.in_count}{b.target ? `/${b.target}` : ""}</strong> in</span>
          : <span className="text-mute" style={{ fontSize: 12 }}>—</span>}
      </div>
      <div>
        {(() => { const s = BOOKING_STATUS[b.status] || { label: b.status, cls: "pill-muted" };
          return <span className={"pill " + s.cls}><span className="pill-dot" /> {s.label}</span>; })()}
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{poundsFromPence(paid)}</div>
        {balance > 0 && <div className="text-mute" style={{ fontSize: 11 }}>{poundsFromPence(balance)} due</div>}
      </div>
    </div>
  );
}
