import React from "react";
import { pad2, teamInitials } from "../lib/format.js";

// Broadcast header: venue brand · IoO promo banner · status cluster + clock.
export default function DisplayHeader({ venue, clock, liveCount, compLabel }) {
  const dow = clock.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
  const dnum = clock.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-crest">
          {venue?.logo_url ? <img src={venue.logo_url} alt="" /> : teamInitials(venue?.name)}
        </div>
        <div>
          <div className="brand-name">{venue?.name || "Venue"}</div>
          <div className="brand-sub">Matchday Wall · Reception</div>
        </div>
      </div>

      <div className="header-center">
        <div className="ioo-banner">
          <div className="ioo-banner__logo"><span className="ico">i/o</span></div>
          <div className="ioo-banner__wm">
            <div className="ioo-banner__name">
              In <span className="dot" /> Or <span className="dot" /> Out
            </div>
            <div className="ioo-banner__tagline">
              League admin, sorted. <span className="accent">Stats automatic.</span>
            </div>
          </div>
          <div className="ioo-banner__cta">
            Get the app <span className="arrow">→</span>
          </div>
        </div>
      </div>

      <div className="header-right">
        <div className="header-status">
          {liveCount > 0 && (
            <div className="status-pill live"><span className="dot" /> {liveCount} live</div>
          )}
          {compLabel && <div className="status-pill">{compLabel}</div>}
        </div>
        <div>
          <div className="clock">
            {pad2(clock.getHours())}<span className="clock-sep">:</span>{pad2(clock.getMinutes())}
          </div>
          <div className="clock-meta">{dow} · {dnum}</div>
        </div>
      </div>
    </header>
  );
}
