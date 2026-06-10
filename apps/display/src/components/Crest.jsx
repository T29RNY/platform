import React from "react";
import { teamColour, teamInitials } from "../lib/format.js";

// Shield clip-path crest (design spec): primary fill, diagonal secondary
// stripe via ::before, white TLA. mini=true renders the 46×50 variant —
// the CSS class carries the dimensions.
export default function Crest({ name, primary, secondary, mini = false }) {
  const c = teamColour(primary, name || "");
  const c2 = secondary || "rgba(255,255,255,0.4)";
  return (
    <div className={mini ? "mini-crest" : "crest"} style={{ "--c": c, "--c2": c2 }}>
      <div className={mini ? "mini-crest__tla" : "crest__tla"}>{teamInitials(name)}</div>
    </div>
  );
}
