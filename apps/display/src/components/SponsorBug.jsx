import React from "react";

// Sponsor slot in the bottom bar. Prefers a dedicated sponsor image set by the
// venue (display_config.sponsor_image_url, wired in the venue settings); falls
// back to the venue's own logo as a brand mark. Renders nothing if neither
// exists, so the ticker simply takes the full width.
export default function SponsorBug({ sponsorUrl, sponsorLabel, venueLogo }) {
  const url = sponsorUrl || venueLogo || null;
  if (!url) return null;
  const isSponsor = !!sponsorUrl;
  return (
    <div className="sponsor" aria-label={sponsorLabel || (isSponsor ? "Sponsor" : "Venue")}>
      <span className="sponsor-kicker">{isSponsor ? (sponsorLabel || "Sponsored by") : ""}</span>
      <img className="sponsor-img" src={url} alt={sponsorLabel || ""} />
    </div>
  );
}
