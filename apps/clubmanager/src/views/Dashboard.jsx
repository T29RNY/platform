import React from "react";
import ComplianceTile from "./tiles/ComplianceTile.jsx";
import ThisWeekTile from "./tiles/ThisWeekTile.jsx";
import MoneyTile from "./tiles/MoneyTile.jsx";

// Club admin home — the Monday-morning ops/compliance glance. Composed entirely
// client-side from existing reads (no roll-up RPC), each tile owning its own
// loading / error / empty states so a quiet club renders "all clear", never blank.
export default function Dashboard({ venueId, clubId, clubName, clubPublic, clubLoading, clubError, onRetryClub, world }) {
  return (
    <>
      <h2>{clubName || "Your club"}</h2>
      <p className="sub">Everything that needs you this week, in one place.</p>
      <div className="tiles">
        <ComplianceTile venueId={venueId} clubId={clubId} />
        <ThisWeekTile
          clubPublic={clubPublic}
          loading={clubLoading}
          error={clubError}
          onRetry={onRetryClub}
        />
        <MoneyTile coaching={world?.coaching} />
      </div>
    </>
  );
}
