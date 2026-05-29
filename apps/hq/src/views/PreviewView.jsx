import React, { useEffect, useState } from "react";
import { getHqPreviewState } from "@platform/core/storage/supabase.js";

// Public, no-login, watermarked read-only HQ snapshot (/hq/preview/TOKEN). The token is
// the secret; get_hq_preview_state validates + expiry + stamps accessed_at server-side.
export default function PreviewView({ token }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getHqPreviewState(token);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (err) {
    return (
      <div className="center">
        <div className="card">
          <h1>Preview unavailable</h1>
          <p>{err === "expired_or_invalid" ? "This preview link has expired or is invalid. Ask your contact for a fresh link." : err}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="center"><div className="muted">Loading preview…</div></div>;

  const s = data.summary || {};
  const venues = data.venues || [];

  return (
    <div>
      <div className="watermark">PREVIEW — upgrade to the HQ tier for permanent, live access</div>
      <div className="preview-wrap">
        <div className="panel-title">{data.company?.name || "Company"}</div>
        <div className="panel-sub">Read-only snapshot · expires {fmt(data.expires_at)}</div>

        <div className="chips">
          <Chip n={s.venue_count} l="Venues" />
          <Chip n={s.active_leagues} l="Leagues" />
          <Chip n={s.registered_teams} l="Teams" />
          <Chip n={s.fixtures_completed} l="Played" />
        </div>

        <div className="section">
          <h2>Venue health</h2>
          {venues.length === 0 && <div className="empty">No venues.</div>}
          {venues.map((v, i) => (
            <div className="venue-card" key={i} style={{ cursor: "default" }}>
              <div className="vc-top">
                <span className={"dot " + (v.health || "green")} />
                <span className="vc-name">{v.name}</span>
                {v.subscription_status && <span className="badge">{v.subscription_status}</span>}
              </div>
              {v.region && <div className="vc-sub">{v.region}</div>}
              <div className="vc-stats">
                <span>Tonight <b>{v.tonight_fixtures}</b></span>
                <span>Incidents <b>{v.open_incidents}</b></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chip({ n, l }) {
  return <div className="chip"><div className="n">{n ?? 0}</div><div className="l">{l}</div></div>;
}

function fmt(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch (e) { return ts; }
}
