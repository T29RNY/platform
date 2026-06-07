import React from "react";
import { teamColour, teamInitials, contrastInk } from "../lib/format.js";

// Generated monogram crest — a broadcast-style roundel built from the team's
// own colours + initials. No uploaded logos exist in the data layer, so this is
// the consistent stand-in: a two-tone radial fill, a bright rim in the team's
// secondary colour, and the monogram in Bebas. Pure SVG so it stays razor-sharp
// at any TV size. `size` is in rem.
export default function Crest({ name, primary, secondary, size = 2.4 }) {
  const p = teamColour(primary, name);
  const s = teamColour(secondary || primary, (name || "") + "·2");
  const ink = contrastInk(p);
  const initials = teamInitials(name);
  // unique gradient id per render so multiple crests don't collide
  const gid = React.useId();
  return (
    <svg
      className="crest"
      width={`${size}rem`}
      height={`${size}rem`}
      viewBox="0 0 100 100"
      role="img"
      aria-label={name || "team"}
      style={{ flex: "none" }}
    >
      <defs>
        <radialGradient id={`g${gid}`} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor={p} stopOpacity="1" />
          <stop offset="100%" stopColor={s} stopOpacity="1" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#g${gid})`} stroke={s} strokeWidth="5" />
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      {/* gloss arc */}
      <path d="M14 38 A46 46 0 0 1 86 38" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" strokeLinecap="round" />
      <text
        x="50" y="50" dy="0.36em" textAnchor="middle"
        fontFamily="'Bebas Neue','Arial Narrow',sans-serif"
        fontSize="52" letterSpacing="1" fill={ink}
      >
        {initials}
      </text>
    </svg>
  );
}
