import React from "react";

// Section shells for the left-rail IA. PR #1 stands up the navigation + routing;
// each section's real surface lands in a later PR (People/Structure PR #2,
// Schedule PR #3, In/Out PR #4, Comms PR #5, Memberships PR #6, Matchday PR #8,
// Club page PR #10, Safeguarding PR #11). Rendering a themed, honest "coming"
// panel — never a dead route.
export default function Placeholder({ title, pr }) {
  return (
    <>
      <h2>{title}</h2>
      <p className="sub">This section is on the way.</p>
      <div className="tile" style={{ maxWidth: 460 }}>
        <h3>{title}</h3>
        <div className="state">
          The {title.toLowerCase()} workspace lands in {pr}. The navigation, roles and
          theming are wired now so it slots straight in.
        </div>
      </div>
    </>
  );
}
