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
  venueGetBillingStatus,
  getVenueFeatureFlags,
  venueSetVenueFeature,
} from "@platform/core";

// OperatorSetup (PR-W2) — the NATIVE /hub skin of the shared @platform/core setup
// registry. Renders the SAME steps/progress the web SetupHub shows, in the amber
// [data-surface="mobile"] theme. No new backend, no migration — reuses the mobile
// operator auth (venue_id -> venue_get_state Stage-1b, exactly like OperationsTonight)
// and the same read wrappers. Cards route to the native operator screen where one
// exists (staff -> People, spaces -> Bookings); details/hours/leagues native editors
// land in PR-W3; Payments shows the "finish on a computer" nudge (Decision #4 — the
// Stripe hosted redirect is awkward in a WKWebView, web-first by design).

// Registry (web) icon name -> native MIcon name.
const NATIVE_ICON = {
  settings: "cog", spaces: "grid", clock: "clock",
  league: "trophy", staff: "users", pound: "pound",
};
const OFFER_ICON = { pitch: "grid", roomhire: "door", equipment: "box" };

// Native action per step. `nav` jumps to an existing operator tab; `soon` = native
// editor not built yet (do it on the web console for now); `nudge` = Stripe web-first.
const NATIVE_ACTION = {
  staff:    { kind: "nav", tab: "people" },
  spaces:   { kind: "nav", tab: "bookings" },
  payments: { kind: "nudge" },
  details:  { kind: "soon" },
  hours:    { kind: "soon" },
  leagues:  { kind: "soon" },
};

function Meter({ label, done, total, primary }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12,
        color: "var(--ink3)", marginBottom: 5 }}>
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

export default function OperatorSetup({ venueId, venueName, onNavigate, toast }) {
  const [data, setData] = useState({ loading: true, error: false });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!venueId) { setData({ loading: false, error: false }); return; }
    setData((s) => ({ ...s, loading: true, error: false }));
    try {
      const [vstate, spaces, admins, billing, features] = await Promise.all([
        venueGetState(venueId),
        venueListSpaces(venueId).catch(() => []),
        venueListAdmins(venueId).catch(() => []),
        venueGetBillingStatus(venueId).catch(() => null),
        getVenueFeatureFlags(venueId).catch(() => null),
      ]);
      setData({ loading: false, error: false, vstate, spaces, admins, billing, features });
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

  const handleCard = useCallback((step) => {
    const action = NATIVE_ACTION[step.id] || { kind: "soon" };
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
          <button onClick={load} style={{ padding: "9px 14px", borderRadius: "var(--r-sm)",
            background: "var(--amber-soft)", color: "var(--amber)", border: "none",
            fontFamily: "var(--m-font)", fontWeight: 700, cursor: "pointer" }}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="m-view-enter">
      {/* Hero + progress */}
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

      {/* Opener — what does your venue offer? (toggles facility flags) */}
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>What does your venue offer?</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {OFFER_OPTIONS.map((opt) => {
          const on = featureOn(data.features, opt.feature);
          return (
            <button
              key={opt.id}
              disabled={busy === opt.feature}
              onClick={() => toggleOffer(opt.feature, !on)}
              style={{
                display: "flex", alignItems: "center", gap: 7, padding: "9px 12px",
                borderRadius: "var(--r-pill)", cursor: "pointer", fontFamily: "var(--m-font)",
                fontSize: 13, fontWeight: 600,
                border: on ? "1px solid var(--amber)" : "1px solid var(--hair)",
                background: on ? "var(--amber-soft)" : "var(--s2)",
                color: on ? "var(--ink)" : "var(--ink3)",
                opacity: busy === opt.feature ? 0.5 : 1,
              }}
            >
              <MIcon name={OFFER_ICON[opt.icon] || "grid"} size={15} color={on ? "var(--amber)" : "var(--ink3)"} />
              {opt.label}
              {on ? <MIcon name="check" size={13} color="var(--amber)" /> : null}
            </button>
          );
        })}
      </div>

      {/* Step cards */}
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Setup steps</div>
      {setup.visibleSteps.map((step) => {
        const action = NATIVE_ACTION[step.id] || { kind: "soon" };
        const trailing =
          step.complete ? <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--amber)", fontSize: 13 }}><MIcon name="check" size={15} color="var(--amber)" /> Done</span>
          : action.kind === "nudge" ? <span style={{ color: "var(--ink3)", fontSize: 12 }}>On a computer</span>
          : action.kind === "soon" ? <span style={{ color: "var(--ink3)", fontSize: 12 }}>On the web</span>
          : <MIcon name="chevron" size={16} color="var(--ink4)" />;
        return (
          <button
            key={step.id}
            onClick={() => handleCard(step)}
            className="m-card"
            style={{
              width: "100%", textAlign: "left", cursor: "pointer", padding: "13px 14px",
              marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
              fontFamily: "var(--m-font)", color: "inherit",
            }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none",
              background: step.complete ? "var(--amber-soft)" : "var(--s4)",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MIcon name={NATIVE_ICON[step.icon] || "cog"} size={18}
                color={step.complete ? "var(--amber)" : "var(--ink3)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{step.label}</span>
                <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em",
                  padding: "2px 6px", borderRadius: "var(--r-pill)",
                  background: step.required ? "var(--amber-soft)" : "var(--s4)",
                  color: step.required ? "var(--amber)" : "var(--ink3)" }}>
                  {step.required ? "Required" : "Optional"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{step.blurb}</div>
            </div>
            <div style={{ flex: "none" }}>{trailing}</div>
          </button>
        );
      })}

      {/* Go-live tile — auto-flip is PR-W5 */}
      <div className="m-card" style={{ padding: 14, marginTop: 6, display: "flex",
        alignItems: "center", justifyContent: "space-between", gap: 12,
        border: setup.goLive.ready ? "1px solid var(--amber)" : "1px solid var(--hair)",
        background: setup.goLive.ready ? "var(--amber-soft)" : "var(--s1)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>Go live</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>
            {setup.goLive.ready
              ? "Everything needed is done — going live turns on automatically (coming soon)."
              : `Complete the ${setup.goLive.total} required step${setup.goLive.total === 1 ? "" : "s"} to go live.`}
          </div>
        </div>
        <span style={{ color: "var(--ink3)", fontSize: 12, flex: "none" }}>Coming soon</span>
      </div>
      {vstatus === "pending" && (
        <div style={{ fontSize: 12, color: "var(--ink4)", margin: "10px 2px 0" }}>
          This venue isn’t publicly listed yet — it goes live once the required steps are complete.
        </div>
      )}
    </div>
  );
}
