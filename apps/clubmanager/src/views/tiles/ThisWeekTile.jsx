import React from "react";

// "This week" tile — upcoming fixtures across the club's leagues, sourced from
// the get_club_public payload already loaded for branding (prop-driven; the App
// owns the single fetch). Loading/error/empty states mirror the async triad.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function upcomingFixtures(clubPublic) {
  const out = [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(startOfToday.getTime() + 7 * 86400000);
  (clubPublic?.leagues || []).forEach((lg) => {
    (lg.fixtures || []).forEach((f) => {
      if (f.status !== "scheduled" || !f.scheduled_date) return;
      const d = new Date(f.scheduled_date + "T" + (f.kickoff_time || "00:00") + ":00");
      if (isNaN(d.getTime()) || d < startOfToday || d > weekEnd) return;
      out.push({ ...f, when: d });
    });
  });
  return out.sort((a, b) => a.when - b.when);
}

export default function ThisWeekTile({ clubPublic, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="tile">
        <h3>This week</h3>
        <div className="state">Loading fixtures…</div>
      </div>
    );
  }
  // A real load error offers a retry. A club with no published public page
  // (found:false — e.g. fixtures live only behind the admin surface) is NOT an
  // error: degrade to a neutral empty rather than a scary "couldn't load".
  if (error) {
    return (
      <div className="tile">
        <h3>This week</h3>
        <div className="state err">Couldn't load fixtures.</div>
        {onRetry && <button className="retry" onClick={onRetry}>Try again</button>}
      </div>
    );
  }

  const noPublicPage = clubPublic?.found === false;
  const fixtures = noPublicPage ? [] : upcomingFixtures(clubPublic);

  if (fixtures.length === 0) {
    return (
      <div className="tile">
        <h3>This week</h3>
        <div className="stat-row"><span className="stat">0</span><span className="stat-label">fixtures in the next 7 days</span></div>
        <div className="state" style={{ marginTop: 8 }}>
          {noPublicPage ? "No published fixtures yet." : "Nothing scheduled — a quiet week."}
        </div>
      </div>
    );
  }

  return (
    <div className="tile">
      <h3>This week</h3>
      <div className="stat-row">
        <span className="stat">{fixtures.length}</span>
        <span className="stat-label">fixture{fixtures.length === 1 ? "" : "s"} in the next 7 days</span>
      </div>
      <table className="atable" style={{ marginTop: 12 }}>
        <tbody>
          {fixtures.slice(0, 5).map((f, i) => (
            <tr key={i}>
              <td style={{ color: "var(--t2)" }}>
                {DOW[f.when.getDay()]} {f.kickoff_time || ""}
              </td>
              <td>
                {f.our_team || "Our team"} {f.is_home ? "vs" : "@"} {f.opponent || "TBC"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
