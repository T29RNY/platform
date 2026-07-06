import React, { useState, useEffect, useMemo, useCallback } from "react";
import Icon from "./Icon.jsx";
import Modal from "./Modal.jsx";
import {
  computeSetupState,
  venueVerification,
  OFFER_OPTIONS,
  featureOn,
  venueListSpaces,
  venueListAdmins,
  venueGetBillingStatus,
  venueSetVenueFeature,
  venueUpdateDetails,
  venueUpdateHours,
  venueSetSetupDismissed,
} from "@platform/core";

// Venue Setup Hub — web skin of the shared @platform/core setup registry.
// A resumable CHECKLIST HUB: reads live venue state, ticks done steps from real
// signals, deep-links each card into the view the console already has. W3 adds the
// real backend editors: a details/branding form (venue_update_details), a
// venue-level opening-hours editor (venue_update_hours), and "skip for now"
// persistence (venue_set_setup_dismissed). Payments (W4) + Go-live (W5) stay locked.
const COMING_SOON = { payments: "PR-W4" };

const DAYS = [
  { dow: 1, label: "Monday" }, { dow: 2, label: "Tuesday" }, { dow: 3, label: "Wednesday" },
  { dow: 4, label: "Thursday" }, { dow: 5, label: "Friday" }, { dow: 6, label: "Saturday" },
  { dow: 0, label: "Sunday" },
];

const DETAIL_FIELDS = [
  { key: "name", label: "Venue name", type: "text", required: true },
  { key: "address", label: "Address", type: "text" },
  { key: "city", label: "Town / city", type: "text" },
  { key: "postcode", label: "Postcode", type: "text" },
  { key: "contact_email", label: "Contact email", type: "email" },
  { key: "contact_phone", label: "Contact phone", type: "tel" },
  { key: "logo_url", label: "Logo URL", type: "url" },
  { key: "primary_colour", label: "Primary colour (hex)", type: "text" },
  { key: "secondary_colour", label: "Secondary colour (hex)", type: "text" },
];

function fieldStyle() {
  return {
    width: "100%", padding: "9px 11px", borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)", background: "var(--bg-3)", color: "var(--ink)",
    fontSize: 14, marginTop: 4,
  };
}

function DetailsForm({ venue, venueToken, onSaved, onClose }) {
  const [form, setForm] = useState(() => {
    const init = {};
    for (const f of DETAIL_FIELDS) init[f.key] = (venue && venue[f.key]) || "";
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = useCallback(async () => {
    if (!String(form.name || "").trim()) { setErr("Venue name is required."); return; }
    setSaving(true); setErr(null);
    try {
      await venueUpdateDetails(venueToken, form);
      if (onSaved) await onSaved();
      onClose();
    } catch (e) {
      console.error("[setup] details save failed", e);
      setErr("Couldn’t save — please try again.");
      setSaving(false);
    }
  }, [form, venueToken, onSaved, onClose]);

  return (
    <Modal open onClose={onClose} title="Venue details & branding"
      footer={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
      </>}>
      {err && <div className="text-mute" style={{ color: "var(--accent)", marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {DETAIL_FIELDS.map((f) => (
          <label key={f.key} style={{ fontSize: 12, color: "var(--ink-2)", gridColumn: f.key === "address" ? "1 / -1" : "auto" }}>
            {f.label}{f.required ? " *" : ""}
            <input
              type={f.type} value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              style={fieldStyle()}
            />
          </label>
        ))}
      </div>
    </Modal>
  );
}

function HoursEditor({ venue, venueToken, onSaved, onClose }) {
  const [rows, setRows] = useState(() => {
    const existing = Array.isArray(venue && venue.opening_hours) ? venue.opening_hours : [];
    const byDow = {};
    for (const r of existing) byDow[r.day_of_week] = r;
    return DAYS.map((d) => {
      const r = byDow[d.dow] || {};
      return {
        dow: d.dow, label: d.label,
        closed: r.closed === true || (!r.open_time && !r.close_time && !!byDow[d.dow] ? true : (r.closed === true)),
        open_time: r.open_time || "09:00",
        close_time: r.close_time || "22:00",
      };
    });
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = useCallback(async () => {
    setSaving(true); setErr(null);
    const payload = rows.map((r) => ({
      day_of_week: r.dow,
      closed: !!r.closed,
      open_time: r.closed ? null : r.open_time,
      close_time: r.closed ? null : r.close_time,
    }));
    try {
      await venueUpdateHours(venueToken, payload);
      if (onSaved) await onSaved();
      onClose();
    } catch (e) {
      console.error("[setup] hours save failed", e);
      setErr("Couldn’t save — please try again.");
      setSaving(false);
    }
  }, [rows, venueToken, onSaved, onClose]);

  return (
    <Modal open onClose={onClose} title="Opening hours"
      footer={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save hours"}</button>
      </>}>
      <p className="text-mute" style={{ margin: "0 0 12px", fontSize: 13 }}>
        Your venue’s staffed / reception hours — the outer bound customers see. These are
        separate from each pitch’s bookable windows.
      </p>
      {err && <div className="text-mute" style={{ color: "var(--accent)", marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.dow} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 92, fontSize: 13 }}>{r.label}</span>
            <label style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 5 }}>
              <input type="checkbox" checked={r.closed}
                onChange={(e) => setRows((s) => s.map((x, j) => j === i ? { ...x, closed: e.target.checked } : x))} />
              Closed
            </label>
            {!r.closed && (
              <>
                <input type="time" value={r.open_time}
                  onChange={(e) => setRows((s) => s.map((x, j) => j === i ? { ...x, open_time: e.target.value } : x))}
                  style={{ ...fieldStyle(), width: 120, marginTop: 0 }} />
                <span className="text-mute">to</span>
                <input type="time" value={r.close_time}
                  onChange={(e) => setRows((s) => s.map((x, j) => j === i ? { ...x, close_time: e.target.value } : x))}
                  style={{ ...fieldStyle(), width: 120, marginTop: 0 }} />
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Meter({ label, done, total, tone }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="setup-meter">
      <div className="setup-meter-head">
        <span>{label}</span>
        <span className="setup-meter-count">{done}/{total}</span>
      </div>
      <div className="setup-meter-track">
        <div className="setup-meter-fill" style={{ width: pct + "%", background: tone === "primary" ? "var(--accent)" : "var(--ink-3)" }} />
      </div>
    </div>
  );
}

export default function SetupHub({ state, venueToken, features, onView, onRefresh, onRefreshFeatures }) {
  const venue = state?.venue ?? {};
  const [spacesCount, setSpacesCount] = useState(null);
  const [adminsCount, setAdminsCount] = useState(null);
  const [hasStripe, setHasStripe] = useState(false);
  const [openerBusy, setOpenerBusy] = useState(null);
  const [openerOpen, setOpenerOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [skipBusy, setSkipBusy] = useState(null);

  const loadSignals = useCallback(async () => {
    try {
      const [spaces, admins, billing] = await Promise.all([
        venueListSpaces(venueToken).catch(() => []),
        venueListAdmins(venueToken).catch(() => []),
        venueGetBillingStatus(venueToken).catch(() => null),
      ]);
      setSpacesCount(Array.isArray(spaces) ? spaces.length : 0);
      setAdminsCount(Array.isArray(admins) ? admins.length : 0);
      setHasStripe(!!billing?.stripe?.config?.charges_enabled);
    } catch (err) {
      console.error("[setup] signal load failed", err);
    }
  }, [venueToken]);

  useEffect(() => { loadSignals(); }, [loadSignals]);

  const ctx = useMemo(() => ({
    venue,
    pitchesCount: state?.pitches?.length ?? 0,
    spacesCount: spacesCount ?? 0,
    leaguesCount: state?.leagues?.length ?? 0,
    seasonsCount: state?.seasons?.length ?? 0,
    adminsCount: adminsCount ?? 0,
    hasStripe,
    dismissed: venue?.setup_dismissed_steps ?? [],
  }), [venue, state, spacesCount, adminsCount, hasStripe]);

  const setup = useMemo(() => computeSetupState(ctx, features), [ctx, features]);
  const vstatus = venueVerification(venue);

  const toggleOffer = useCallback(async (feature, next) => {
    setOpenerBusy(feature);
    try {
      await venueSetVenueFeature(venueToken, feature, next);
      if (onRefreshFeatures) await onRefreshFeatures();
    } catch (err) {
      console.error("[setup] toggle offer failed", err);
    } finally {
      setOpenerBusy(null);
    }
  }, [venueToken, onRefreshFeatures]);

  const toggleSkip = useCallback(async (stepId, dismissed) => {
    setSkipBusy(stepId);
    try {
      await venueSetSetupDismissed(venueToken, stepId, dismissed);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error("[setup] skip toggle failed", err);
    } finally {
      setSkipBusy(null);
    }
  }, [venueToken, onRefresh]);

  const handleCard = useCallback((step) => {
    if (COMING_SOON[step.id]) return;
    if (step.id === "details") { setDetailsOpen(true); return; }
    if (step.id === "hours") { setHoursOpen(true); return; }
    onView?.(step.view);
  }, [onView]);

  const cards = setup.visibleSteps;

  return (
    <div className="setup-hub">
      <header className="setup-hero">
        <div className="setup-hero-main">
          <h1>{setup.goLive.ready ? "Your venue is live-ready" : "Set up your venue"}</h1>
          <p className="text-mute">
            {setup.goLive.ready
              ? "The essentials are done. Add anything else below whenever you like — nothing here is required."
              : "A few quick steps to get your venue ready to go live. Pick up where you left off — everything saves as you go."}
          </p>
        </div>
        <div className="setup-hero-meters">
          <Meter label="Go-live progress" done={setup.goLive.done} total={setup.goLive.total} tone="primary" />
          <Meter label="Setup completeness" done={setup.completeness.done} total={setup.completeness.total} tone="soft" />
        </div>
      </header>

      <section className="setup-opener">
        <button className="setup-opener-head" onClick={() => setOpenerOpen((v) => !v)}>
          <span><Icon name="settings" size={16} /> What does your venue offer?</span>
          <Icon name={openerOpen ? "chevron_l" : "chevron_r"} size={16} />
        </button>
        {openerOpen && (
          <div className="setup-opener-body">
            <p className="text-mute" style={{ margin: "0 0 10px" }}>
              Turn on what applies — we’ll tailor the steps below. You can change this any time from the Features screen.
            </p>
            <div className="setup-offer-grid">
              {OFFER_OPTIONS.map((opt) => {
                const on = featureOn(features, opt.feature);
                return (
                  <button key={opt.id} className={"setup-offer" + (on ? " on" : "")}
                    disabled={openerBusy === opt.feature} onClick={() => toggleOffer(opt.feature, !on)}>
                    <span className="ico"><Icon name={opt.icon} size={18} /></span>
                    <span className="lbl">{opt.label}</span>
                    <span className="tick">{on ? <Icon name="check" size={14} /> : null}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="setup-cards">
        {cards.map((step) => {
          const soon = COMING_SOON[step.id];
          const canSkip = !step.required && !step.complete && !soon;
          return (
            <div key={step.id} className={"setup-card" + (step.complete ? " done" : "") + (soon ? " locked" : "")}>
              <button className="setup-card-hit" onClick={() => handleCard(step)} disabled={!!soon}>
                <span className="setup-card-ico"><Icon name={step.icon} size={20} /></span>
                <span className="setup-card-body">
                  <span className="setup-card-title">
                    {step.label}
                    {step.required ? <em className="setup-tag req">Required</em> : <em className="setup-tag opt">Optional</em>}
                    {step.nudge ? <em className="setup-tag nudge">Recommended</em> : null}
                    {step.dismissed ? <em className="setup-tag opt">Skipped</em> : null}
                  </span>
                  <span className="setup-card-blurb">{step.blurb}</span>
                </span>
                <span className="setup-card-state">
                  {step.complete
                    ? <span className="setup-state done"><Icon name="check" size={16} /> Done</span>
                    : soon
                      ? <span className="setup-state soon">Coming soon</span>
                      : <span className="setup-state go"><Icon name="arrow_r" size={16} /></span>}
                </span>
              </button>
              {canSkip && (
                <button className="setup-skip" disabled={skipBusy === step.id}
                  onClick={() => toggleSkip(step.id, !step.dismissed)}>
                  {step.dismissed ? "Undo skip" : "Skip for now"}
                </button>
              )}
            </div>
          );
        })}
      </section>

      <section className="setup-golive">
        <div className={"setup-golive-tile" + (setup.goLive.ready ? " ready" : "")}>
          <div className="setup-golive-copy">
            <strong>Go live</strong>
            <span className="text-mute">
              {setup.goLive.ready
                ? "You’ve done everything needed — going live turns on automatically (coming soon)."
                : `Complete the ${setup.goLive.total} required step${setup.goLive.total === 1 ? "" : "s"} to go live.`}
            </span>
          </div>
          <span className="setup-state soon">Coming soon</span>
        </div>
        {vstatus === "pending" && (
          <p className="text-mute" style={{ fontSize: 12, marginTop: 8 }}>
            This venue isn’t publicly listed yet — it goes live once the required steps are complete.
          </p>
        )}
      </section>

      {detailsOpen && (
        <DetailsForm venue={venue} venueToken={venueToken} onSaved={onRefresh} onClose={() => setDetailsOpen(false)} />
      )}
      {hoursOpen && (
        <HoursEditor venue={venue} venueToken={venueToken} onSaved={onRefresh} onClose={() => setHoursOpen(false)} />
      )}
    </div>
  );
}
