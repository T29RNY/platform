import React, { useState, useEffect, useMemo, useCallback } from "react";
import Icon from "./Icon.jsx";
import {
  computeSetupState,
  venueVerification,
  OFFER_OPTIONS,
  featureOn,
  venueListSpaces,
  venueListAdmins,
  venueGetBillingStatus,
  venueSetVenueFeature,
} from "@platform/core";

// Venue Setup Hub (PR-W1) — the web skin of the shared @platform/core setup
// registry. A resumable CHECKLIST HUB (not a linear wizard): reads live venue
// state, ticks done steps from real signals, and deep-links each card into the
// view the console already has. Steps/progress logic live in core; this file only
// renders the dark Broadcast-Gallery cards.
//
// W1 scope: the opener + the 6 core cards. `details` opens the branding modal;
// `spaces`/`leagues`/`staff` deep-link into their existing views; `hours` (PR-W3),
// `payments` (PR-W4) and Go-live (PR-W5) render as locked "coming up" tiles until
// their phases land.
const COMING_SOON = { hours: "PR-W3", payments: "PR-W4" };

function Meter({ label, done, total, tone }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="setup-meter">
      <div className="setup-meter-head">
        <span>{label}</span>
        <span className="setup-meter-count">{done}/{total}</span>
      </div>
      <div className="setup-meter-track">
        <div
          className="setup-meter-fill"
          style={{
            width: pct + "%",
            background: tone === "primary" ? "var(--accent)" : "var(--ink-3)",
          }}
        />
      </div>
    </div>
  );
}

export default function SetupHub({
  state,
  venueToken,
  features,
  onView,
  onOpenDetails,
  onRefreshFeatures,
}) {
  const venue = state?.venue ?? {};
  const [spacesCount, setSpacesCount] = useState(null);
  const [adminsCount, setAdminsCount] = useState(null);
  const [hasStripe, setHasStripe] = useState(false);
  const [openerBusy, setOpenerBusy] = useState(null);
  const [openerOpen, setOpenerOpen] = useState(true);

  // Pull the three signals that aren't in venue_get_state (spaces, admins,
  // billing). Pitches / leagues / seasons come straight off `state`.
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

  const handleCard = useCallback((step) => {
    if (COMING_SOON[step.id]) return;                 // locked tile — no-op in W1
    if (step.id === "details") { onOpenDetails?.(); return; }
    onView?.(step.view);
  }, [onView, onOpenDetails]);

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

      {/* Opener — "what does your venue offer?" (tailors the facility cards) */}
      <section className="setup-opener">
        <button className="setup-opener-head" onClick={() => setOpenerOpen((v) => !v)}>
          <span><Icon name="settings" size={16} /> What does your venue offer?</span>
          <Icon name={openerOpen ? "chevron_l" : "chevron_r"} size={16} />
        </button>
        {openerOpen && (
          <div className="setup-opener-body">
            <p className="text-mute" style={{ margin: "0 0 10px" }}>
              Turn on what applies — we’ll tailor the steps below. You can change this
              any time from the Features screen.
            </p>
            <div className="setup-offer-grid">
              {OFFER_OPTIONS.map((opt) => {
                const on = featureOn(features, opt.feature);
                return (
                  <button
                    key={opt.id}
                    className={"setup-offer" + (on ? " on" : "")}
                    disabled={openerBusy === opt.feature}
                    onClick={() => toggleOffer(opt.feature, !on)}
                  >
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

      {/* Step cards */}
      <section className="setup-cards">
        {cards.map((step) => {
          const soon = COMING_SOON[step.id];
          return (
            <button
              key={step.id}
              className={
                "setup-card" +
                (step.complete ? " done" : "") +
                (soon ? " locked" : "")
              }
              onClick={() => handleCard(step)}
              disabled={!!soon}
            >
              <span className="setup-card-ico"><Icon name={step.icon} size={20} /></span>
              <span className="setup-card-body">
                <span className="setup-card-title">
                  {step.label}
                  {step.required
                    ? <em className="setup-tag req">Required</em>
                    : <em className="setup-tag opt">Optional</em>}
                  {step.nudge ? <em className="setup-tag nudge">Recommended</em> : null}
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
          );
        })}
      </section>

      {/* Go-live tile — locked in W1 (auto-flip is PR-W5) */}
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
    </div>
  );
}
