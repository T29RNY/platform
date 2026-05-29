import React from "react";
import { formatClock, formatDateLong } from "../lib/format.js";

export default function DisplayHeader({ venue, clock, liveCount, connected }) {
  const monogram = (venue?.name || "?").trim().charAt(0).toUpperCase();
  return (
    <header className="hdr">
      {venue?.logo_url ? (
        <img className="hdr-logo" src={venue.logo_url} alt="" />
      ) : (
        <div className="hdr-logo hdr-monogram">{monogram}</div>
      )}
      <div className="hdr-titles">
        <div className="hdr-venue">{venue?.name || "Reception Display"}</div>
        <div className="hdr-sub">Live Scores &amp; Standings</div>
      </div>

      <div className="hdr-spacer" />

      {liveCount > 0 ? (
        <span className="livepill"><span className="livedot" /> {liveCount} Live</span>
      ) : !connected ? (
        <span className="pausepill">● Live updates paused</span>
      ) : null}

      <div style={{ textAlign: "right" }}>
        <div className="hdr-clock">{formatClock(clock)}</div>
        <div className="hdr-date">{formatDateLong(clock)}</div>
      </div>
    </header>
  );
}
