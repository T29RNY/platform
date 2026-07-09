import { useState, useEffect, useCallback, useMemo } from "react";
import MIcon from "../icons.jsx";
import {
  computeSetupState,
  venueVerification,
  OFFER_OPTIONS,
  featureOn,
  venueGetState,
  venueListSpaces,
  venueListAdmins,
  venueListMembershipTiers,
  venueListEquipment,
  venueGetBillingStatus,
  getVenueFeatureFlags,
  venueSetVenueFeature,
  venueUpdateDetails,
  venueUpdateHours,
  venueSetSetupDismissed,
  venueFinalizeSetup,
} from "@platform/core";

// OperatorSetup — the NATIVE /hub skin of the shared @platform/core setup registry
// (amber [data-surface="mobile"] theme). Renders the SAME steps/progress the web
// SetupHub shows. W3 adds the native details + opening-hours editors + "skip for
// now"; staff/spaces deep-link to native operator screens; Payments = web-first
// nudge (Decision #4). W5 wires the go-live card to venue_finalize_setup — the
// server-checked objective flip (Decision #5), shown only when the required set is met.

const NATIVE_ICON = {
  settings: "cog", spaces: "grid", clock: "clock",
  league: "trophy", staff: "users", pound: "pound",
  shield: "shield", customers: "card", equipment: "box",
};
const OFFER_ICON = { pitch: "grid", roomhire: "door", equipment: "box" };

// details/hours open a native editor; staff/spaces jump to an operator tab;
// payments = web-first nudge; leagues = web for now (no native league setup).
const NATIVE_ACTION = {
  details:  { kind: "edit", editor: "details" },
  hours:    { kind: "edit", editor: "hours" },
  staff:    { kind: "nav", tab: "people" },
  spaces:   { kind: "nav", tab: "bookings" },
  payments: { kind: "nudge" },
  leagues:  { kind: "soon" },
  // Optional cards 7–9 — no native editor yet; finish on the web console
  // (same web-first treatment as leagues, Decision #4).
  booking_rules: { kind: "soon" },
  memberships:   { kind: "soon" },
  equipment:     { kind: "soon" },
};

const DAYS = [
  { dow: 1, label: "Mon" }, { dow: 2, label: "Tue" }, { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" }, { dow: 5, label: "Fri" }, { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];
const DETAIL_FIELDS = [
  { key: "name", label: "Venue name", required: true },
  { key: "address", label: "Address" },
  { key: "city", label: "Town / city" },
  { key: "postcode", label: "Postcode" },
  { key: "contact_email", label: "Contact email" },
  { key: "contact_phone", label: "Contact phone" },
  { key: "logo_url", label: "Logo URL" },
  { key: "primary_colour", label: "Primary colour (hex)" },
  { key: "secondary_colour", label: "Secondary colour (hex)" },
];

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--r-sm)",
  border: "1px solid var(--hair)", background: "var(--s3)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 14, marginTop: 4,
};
const btnPrimary = {
  padding: "11px 16px", borderRadius: "var(--r-sm)", background: "var(--amber)",
  color: "var(--amber-ink)", border: "none", fontFamily: "var(--m-font)", fontWeight: 700, cursor: "pointer",
};
const btnGhost = {
  padding: "11px 16px", borderRadius: "var(--r-sm)", background: "var(--s3)",
  color: "var(--ink2)", border: "none", fontFamily: "var(--m-font)", fontWeight: 600, cursor: "pointer",
};

function EditorHeader({ title, onBack }) {
  return (
    <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none",
      border: 0, color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
      <MIcon name="chevleft" size={16} color="var(--ink3)" /> {title}
    </button>
  );
}

function DetailsEditor({ venue, venueId, onSaved, onBack, toast }) {
  const [form, setForm] = useState(() => {
    const init = {};
    for (const f of DETAIL_FIELDS) init[f.key] = (venue && venue[f.key]) || "";
    return init;
  });
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!String(form.name || "").trim()) { toast?.("Venue name is required"); return; }
    setSaving(true);
    try {
      await venueUpdateDetails(venueId, form);
      await onSaved();
      onBack();
    } catch {
      toast?.("Couldn’t save — try again");
      setSaving(false);
    }
  }, [form, venueId, onSaved, onBack, toast]);

  return (
    <div className="m-view-enter">
      <EditorHeader title="Venue details" onBack={onBack} />
      {DETAIL_FIELDS.map((f) => (
        <label key={f.key} style={{ display: "block", marginBottom: 12, fontSize: 12, color: "var(--ink3)" }}>
          {f.label}{f.required ? " *" : ""}
          <input value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} style={inputStyle} />
        </label>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button onClick={onBack} disabled={saving} style={btnGhost}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ ...btnPrimary, flex: 1 }}>{saving ? "Saving…" : "Save details"}</button>
      </div>
    </div>
  );
}

function HoursEditor({ venue, venueId, onSaved, onBack, toast }) {
  const [rows, setRows] = useState(() => {
    const existing = Array.isArray(venue && venue.opening_hours) ? venue.opening_hours : [];
    const byDow = {};
    for (const r of existing) byDow[r.day_of_week] = r;
    return DAYS.map((d) => {
      const r = byDow[d.dow] || {};
      return { dow: d.dow, label: d.label, closed: r.closed === true,
        open_time: r.open_time || "09:00", close_time: r.close_time || "22:00" };
    });
  });
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    const payload = rows.map((r) => ({
      day_of_week: r.dow, closed: !!r.closed,
      open_time: r.closed ? null : r.open_time, close_time: r.closed ? null : r.close_time,
    }));
    try {
      await venueUpdateHours(venueId, payload);
      await onSaved();
      onBack();
    } catch {
      toast?.("Couldn’t save — try again");
      setSaving(false);
    }
  }, [rows, venueId, onSaved, onBack, toast]);

  return (
    <div className="m-view-enter">
      <EditorHeader title="Opening hours" onBack={onBack} />
      <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 12 }}>
        Your venue’s staffed hours — separate from each pitch’s bookable windows.
      </div>
      {rows.map((r, i) => (
        <div key={r.dow} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ width: 40, fontSize: 13, color: "var(--ink)" }}>{r.label}</span>
          <button onClick={() => setRows((s) => s.map((x, j) => j === i ? { ...x, closed: !x.closed } : x))}
            style={{ padding: "6px 10px", borderRadius: "var(--r-pill)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--m-font)", border: "1px solid var(--hair)",
              background: r.closed ? "var(--s4)" : "var(--amber-soft)",
              color: r.closed ? "var(--ink3)" : "var(--amber)" }}>
            {r.closed ? "Closed" : "Open"}
          </button>
          {!r.closed && (
            <>
              <input type="time" value={r.open_time}
                onChange={(e) => setRows((s) => s.map((x, j) => j === i ? { ...x, open_time: e.target.value } : x))}
                style={{ ...inputStyle, width: 108, marginTop: 0 }} />
              <input type="time" value={r.close_time}
                onChange={(e) => setRows((s) => s.map((x, j) => j === i ? { ...x, close_time: e.target.value } : x))}
                style={{ ...inputStyle, width: 108, marginTop: 0 }} />
            </>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button onClick={onBack} disabled={saving} style={btnGhost}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ ...btnPrimary, flex: 1 }}>{saving ? "Saving…" : "Save hours"}</button>
      </div>
    </div>
  );
}

function Meter({ label, done, total, primary }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink3)", marginBottom: 5 }}>
        <span>{label}</span>
        <span style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{done}/{total}</span>
      </div>
      <div style={{ height: 7, borderRadius: "var(--r-pill)", background: "var(--s4)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", borderRadius: "var(--r-pill)",
          background: primary ? "var(--amber)" : "var(--ink4)", transition: "width .3s ease" }} />
      </div>
    </div>
  );
}

export default function OperatorSetup({ venueId, venueName, onNavigate, onBack, toast }) {
  const [data, setData] = useState({ loading: true, error: false });
  const [busy, setBusy] = useState(null);
  const [skipBusy, setSkipBusy] = useState(null);
  const [goLiveBusy, setGoLiveBusy] = useState(false);
  const [editor, setEditor] = useState(null); // null | 'details' | 'hours'

  const load = useCallback(async () => {
    if (!venueId) { setData({ loading: false, error: false }); return; }
    setData((s) => ({ ...s, loading: true, error: false }));
    try {
      const [vstate, spaces, admins, billing, features, tiers, equipment] = await Promise.all([
        venueGetState(venueId),
        venueListSpaces(venueId).catch(() => []),
        venueListAdmins(venueId).catch(() => []),
        venueGetBillingStatus(venueId).catch(() => null),
        getVenueFeatureFlags(venueId).catch(() => null),
        venueListMembershipTiers(venueId).catch(() => []),
        venueListEquipment(venueId).catch(() => []),
      ]);
      setData({ loading: false, error: false, vstate, spaces, admins, billing, features, tiers, equipment });
    } catch {
      setData({ loading: false, error: true });
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const ctx = useMemo(() => {
    const v = data.vstate?.venue ?? {};
    return {
      venue: v,
      pitchesCount: data.vstate?.pitches?.length ?? 0,
      spacesCount: Array.isArray(data.spaces) ? data.spaces.length : 0,
      leaguesCount: data.vstate?.leagues?.length ?? 0,
      seasonsCount: data.vstate?.seasons?.length ?? 0,
      adminsCount: Array.isArray(data.admins) ? data.admins.length : 0,
      hasStripe: !!data.billing?.stripe?.config?.charges_enabled,
      membershipTiersCount: Array.isArray(data.tiers) ? data.tiers.length : 0,
      equipmentCount: Array.isArray(data.equipment) ? data.equipment.length : 0,
      dismissed: v?.setup_dismissed_steps ?? [],
    };
  }, [data]);

  const setup = useMemo(() => computeSetupState(ctx, data.features), [ctx, data.features]);
  const vstatus = venueVerification(ctx.venue);

  const toggleOffer = useCallback(async (feature, next) => {
    setBusy(feature);
    try {
      await venueSetVenueFeature(venueId, feature, next);
      await load();
    } catch {
      toast?.("Couldn’t update — try again");
    } finally {
      setBusy(null);
    }
  }, [venueId, load, toast]);

  const toggleSkip = useCallback(async (stepId, dismissed) => {
    setSkipBusy(stepId);
    try {
      await venueSetSetupDismissed(venueId, stepId, dismissed);
      await load();
    } catch {
      toast?.("Couldn’t update — try again");
    } finally {
      setSkipBusy(null);
    }
  }, [venueId, load, toast]);

  const handleGoLive = useCallback(async () => {
    setGoLiveBusy(true);
    try {
      await venueFinalizeSetup(venueId);
      await load();
      toast?.("You’re live 🎉");
    } catch (err) {
      console.error("[setup] go-live failed", err);
      toast?.(
        String(err?.message || "").includes("setup_incomplete")
          ? "Complete the required steps first"
          : "Couldn’t go live — try again"
      );
    } finally {
      setGoLiveBusy(false);
    }
  }, [venueId, load, toast]);

  const handleCard = useCallback((step) => {
    const action = NATIVE_ACTION[step.id] || { kind: "soon" };
    if (action.kind === "edit") { setEditor(action.editor); return; }
    if (action.kind === "nav") { onNavigate?.(action.tab); return; }
    if (action.kind === "nudge") { toast?.("Finish payout setup on a computer"); return; }
    toast?.("Set this up on the web console for now");
  }, [onNavigate, toast]);

  if (data.loading) {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: 16 }}>
          <div className="m-eyebrow">Setup</div>
          <div style={{ color: "var(--ink3)", fontSize: 13, marginTop: 6 }}>Loading…</div>
        </div>
      </div>
    );
  }
  if (data.error) {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: 16 }}>
          <div className="m-eyebrow">Setup</div>
          <div style={{ color: "var(--ink3)", fontSize: 13, margin: "6px 0 12px" }}>Couldn’t load your venue.</div>
          <button onClick={load} style={btnPrimary}>Try again</button>
        </div>
      </div>
    );
  }

  if (editor === "details") {
    return <DetailsEditor venue={ctx.venue} venueId={venueId} onSaved={load} onBack={() => setEditor(null)} toast={toast} />;
  }
  if (editor === "hours") {
    return <HoursEditor venue={ctx.venue} venueId={venueId} onSaved={load} onBack={() => setEditor(null)} toast={toast} />;
  }

  return (
    <div className="m-view-enter">
      {onBack && (
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none",
          border: "none", cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)",
          fontSize: 13, fontWeight: 600, padding: "2px 2px 10px" }}>
          <MIcon name="chevleft" size={16} color="var(--ink3)" /> More
        </button>
      )}
      <div className="m-card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="m-eyebrow">{venueName || "Your venue"}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: "3px 0 4px" }}>
          {setup.goLive.ready ? "Live-ready" : "Set up your venue"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 14 }}>
          {setup.goLive.ready
            ? "The essentials are done. Add anything else below whenever you like."
            : "A few quick steps to get ready to go live. Everything saves as you go."}
        </div>
        <Meter label="Go-live progress" done={setup.goLive.done} total={setup.goLive.total} primary />
        <Meter label="Setup completeness" done={setup.completeness.done} total={setup.completeness.total} />
      </div>

      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>What does your venue offer?</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {OFFER_OPTIONS.map((opt) => {
          const on = featureOn(data.features, opt.feature);
          return (
            <button key={opt.id} disabled={busy === opt.feature} onClick={() => toggleOffer(opt.feature, !on)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 12px",
                borderRadius: "var(--r-pill)", cursor: "pointer", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600,
                border: on ? "1px solid var(--amber)" : "1px solid var(--hair)",
                background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--ink)" : "var(--ink3)",
                opacity: busy === opt.feature ? 0.5 : 1 }}>
              <MIcon name={OFFER_ICON[opt.icon] || "grid"} size={15} color={on ? "var(--amber)" : "var(--ink3)"} />
              {opt.label}
              {on ? <MIcon name="check" size={13} color="var(--amber)" /> : null}
            </button>
          );
        })}
      </div>

      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Setup steps</div>
      {setup.visibleSteps.map((step) => {
        const action = NATIVE_ACTION[step.id] || { kind: "soon" };
        const canSkip = !step.required && !step.complete;
        const trailing =
          step.complete ? <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--amber)", fontSize: 13 }}><MIcon name="check" size={15} color="var(--amber)" /> Done</span>
          : action.kind === "nudge" ? <span style={{ color: "var(--ink3)", fontSize: 12 }}>On a computer</span>
          : action.kind === "soon" ? <span style={{ color: "var(--ink3)", fontSize: 12 }}>On the web</span>
          : <MIcon name="chevron" size={16} color="var(--ink4)" />;
        return (
          <div key={step.id} className="m-card" style={{ marginBottom: 9, overflow: "hidden" }}>
            <button onClick={() => handleCard(step)} style={{ width: "100%", textAlign: "left", cursor: "pointer",
              padding: "13px 14px", display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)",
              color: "inherit", background: "none", border: 0 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none",
                background: step.complete ? "var(--amber-soft)" : "var(--s4)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MIcon name={NATIVE_ICON[step.icon] || "cog"} size={18} color={step.complete ? "var(--amber)" : "var(--ink3)"} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{step.label}</span>
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", padding: "2px 6px",
                    borderRadius: "var(--r-pill)", background: step.required ? "var(--amber-soft)" : "var(--s4)",
                    color: step.required ? "var(--amber)" : "var(--ink3)" }}>
                    {step.required ? "Required" : "Optional"}
                  </span>
                  {step.dismissed ? <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em",
                    padding: "2px 6px", borderRadius: "var(--r-pill)", background: "var(--s4)", color: "var(--ink3)" }}>Skipped</span> : null}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{step.blurb}</div>
              </div>
              <div style={{ flex: "none" }}>{trailing}</div>
            </button>
            {canSkip && (
              <button onClick={() => toggleSkip(step.id, !step.dismissed)} disabled={skipBusy === step.id}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "0 14px 11px 64px",
                  background: "none", border: 0, color: "var(--ink3)", fontSize: 12, cursor: "pointer",
                  textDecoration: "underline", fontFamily: "var(--m-font)" }}>
                {step.dismissed ? "Undo skip" : "Skip for now"}
              </button>
            )}
          </div>
        );
      })}

      <div className="m-card" style={{ padding: 14, marginTop: 6, display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12,
        border: vstatus === "verified" ? "1px solid var(--amber)" : "1px solid var(--hair)",
        background: vstatus === "verified" ? "var(--amber-soft)" : "var(--s1)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>
            {vstatus === "verified" ? "You’re live 🎉" : "Go live"}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>
            {vstatus === "verified"
              ? "Your venue is published and appears in public search."
              : vstatus === "rejected"
                ? "This venue was removed by the platform. Contact support if this is a mistake."
                : setup.goLive.ready
                  ? "Everything needed is done — publish to appear in public search."
                  : `Complete the ${setup.goLive.total} required step${setup.goLive.total === 1 ? "" : "s"} to go live.`}
          </div>
        </div>
        {vstatus === "verified"
          ? <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--amber)", fontSize: 13, flex: "none" }}><MIcon name="check" size={15} color="var(--amber)" /> Live</span>
          : vstatus === "rejected"
            ? <span style={{ color: "var(--ink3)", fontSize: 12, flex: "none" }}>Removed</span>
            : setup.goLive.ready
              ? <button onClick={handleGoLive} disabled={goLiveBusy} style={{ ...btnPrimary, flex: "none" }}>
                  {goLiveBusy ? "Going live…" : "Go live now"}
                </button>
              : <span style={{ color: "var(--ink3)", fontSize: 12, flex: "none", fontVariantNumeric: "tabular-nums" }}>{setup.goLive.done}/{setup.goLive.total}</span>}
      </div>
      {vstatus === "pending" && !setup.goLive.ready && (
        <div style={{ fontSize: 12, color: "var(--ink4)", margin: "10px 2px 0" }}>
          This venue isn’t publicly listed yet — it goes live once the required steps are complete.
        </div>
      )}
    </div>
  );
}
