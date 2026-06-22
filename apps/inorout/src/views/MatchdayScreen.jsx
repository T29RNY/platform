import { useEffect, useState } from "react";
import { getClubFixtureMatchday } from "@platform/core/storage/supabase.js";

// Public, no-login opposition-coach matchday page (mig 395). Keyed on a
// club_fixtures share_code (/matchday/<code>). Self-contained styling in the
// tournament Info/MatchSheet spirit — tokens only, no app chrome, no auth.

function mapsUrl(m) {
  if (m?.venue_lat != null && m?.venue_lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${m.venue_lat},${m.venue_lng}`;
  }
  const q = [m?.venue_name, m?.venue_address, m?.venue_city, m?.venue_postcode].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch { return iso; }
}

function stateLine(m) {
  if (m.status === "postponed") return "Postponed";
  if (m.status === "void") return "Off";
  if (m.status === "completed") return "Full time";
  return m.kickoff_time ? `Kick-off ${m.kickoff_time}` : "Scheduled";
}

export default function MatchdayScreen({ code, signedIn = false }) {
  const [m, setM] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getClubFixtureMatchday(code)
      .then((d) => { if (!alive) return; if (!d?.ok) setNotFound(true); else setM(d); })
      .catch((e) => { if (alive) { console.error("[matchday] fetch failed", e); setNotFound(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code]);

  if (loading) return <Shell><div className="md-center">Loading…</div></Shell>;
  if (notFound || !m) return (
    <Shell>
      <div className="md-center">
        <div className="md-eyebrow">Matchday</div>
        <h1 className="md-nf">Link not found</h1>
        <p className="md-muted">This matchday link is no longer active.</p>
      </div>
    </Shell>
  );

  const home = m.is_home ? m.our_team : m.opponent;
  const away = m.is_home ? m.opponent : m.our_team;
  const hasScore = m.home_score != null && m.away_score != null;
  const addr = [m.venue_address, m.venue_city, m.venue_postcode].filter(Boolean).join(", ");
  const url = mapsUrl(m);
  const info = m.info || {};
  const infoRows = [["parking", "Parking & arrival"], ["rules", "Ground rules"], ["directions", "Directions"], ["contact", "Matchday contact"]]
    .map(([k, label]) => [label, info[k]]).filter(([, v]) => v && String(v).trim());

  return (
    <Shell>
      <div className="md-hero">
        <div className="md-eyebrow">Matchday</div>
        <div className="md-club">{m.club_name}</div>
        {m.league_name && <div className="md-league">{m.league_name}</div>}
      </div>

      <div className="md-card md-sheet">
        <div className="md-teams">
          <div className="md-team">{home || "TBD"}</div>
          <div className="md-score">{hasScore ? `${m.home_score} – ${m.away_score}` : "v"}</div>
          <div className="md-team">{away || "TBD"}</div>
        </div>
        <div className="md-state">{stateLine(m)}</div>
        <div className="md-pills">
          {m.scheduled_date && <Pill k="Date" v={fmtDate(m.scheduled_date)} />}
          {m.kickoff_time && <Pill k="Kick-off" v={m.kickoff_time} />}
          {m.is_home && m.pitch_name && <Pill k="Pitch" v={m.pitch_name} />}
          {m.referee_name && <Pill k="Referee" v={m.referee_name} />}
        </div>
        {m.notes && <div className="md-note">{m.notes}</div>}
      </div>

      {m.is_home && (m.venue_name || addr) && (
        <div className="md-card">
          {m.venue_name && <div className="md-venue-name">{m.venue_name}</div>}
          {addr && <div className="md-muted md-addr">{addr}</div>}
          <div className="md-actions">
            {url && <a className="md-action" href={url} target="_blank" rel="noreferrer">Directions</a>}
            {m.venue_contact_phone && <a className="md-action" href={`tel:${m.venue_contact_phone}`}>Call</a>}
            {m.venue_contact_email && <a className="md-action" href={`mailto:${m.venue_contact_email}`}>Email</a>}
          </div>
        </div>
      )}

      {m.is_home && infoRows.length > 0 && (
        <div className="md-card">
          {infoRows.map(([label, v], i) => (
            <div className={`md-info-row${i === infoRows.length - 1 ? " last" : ""}`} key={label}>
              <div className="md-info-k">{label}</div>
              <div className="md-info-v">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="md-footer">
        {signedIn
          ? <a href="/" className="md-link">Back to In or Out →</a>
          : <a href="https://in-or-out.com" className="md-link">Powered by In or Out · Get the app →</a>}
      </div>
    </Shell>
  );
}

function Pill({ k, v }) {
  return <div className="md-metapill"><span className="md-metapill-k">{k}</span><span className="md-metapill-v">{v}</span></div>;
}

function Shell({ children }) {
  return (
    <div className="md-shell">
      <style>{STYLES}</style>
      <div className="md-wrap">{children}</div>
    </div>
  );
}

const STYLES = `
.md-shell { min-height: 100dvh; background: var(--bg); color: var(--t1);
  font-family: var(--font-body); padding: 24px 16px 48px; }
.md-wrap { max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.md-center { text-align: center; padding: 80px 0; color: var(--t2); }
.md-nf { font-family: var(--font-display); font-size: 34px; margin: 8px 0; color: var(--t1); }
.md-muted { color: var(--t2); }
.md-hero { text-align: center; padding: 16px 0 4px; }
.md-eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 12px; color: var(--green); margin-bottom: 6px; }
.md-club { font-family: var(--font-display); font-size: 40px; line-height: 1; color: var(--t1); }
.md-league { color: var(--t2); margin-top: 6px; font-size: 14px; }
.md-card { background: var(--s1); border: 1px solid var(--border-subtle); border-radius: var(--r); padding: 18px; }
.md-sheet { text-align: center; }
.md-teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
.md-team { font-weight: 700; font-size: 17px; }
.md-score { font-family: var(--font-display); font-size: 34px; color: var(--green); min-width: 64px; }
.md-state { text-transform: uppercase; letter-spacing: 0.12em; font-size: 12px; color: var(--t2); margin-top: 10px; }
.md-pills { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 14px; }
.md-metapill { display: inline-flex; flex-direction: column; align-items: center; background: var(--s3);
  border-radius: var(--r-pill); padding: 6px 12px; min-width: 64px; }
.md-metapill-k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--t2); }
.md-metapill-v { font-size: 14px; font-weight: 700; color: var(--t1); }
.md-note { margin-top: 12px; font-size: 13px; color: var(--t2); font-style: italic; }
.md-venue-name { font-weight: 700; font-size: 16px; }
.md-addr { margin-top: 4px; font-size: 14px; }
.md-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.md-action { border: 1px solid var(--green); color: var(--green); border-radius: var(--r-button);
  padding: 8px 14px; font-size: 13px; font-weight: 600; text-decoration: none; }
.md-info-row { padding: 10px 0; border-bottom: 1px solid var(--border-subtle); }
.md-info-row.last { border-bottom: none; }
.md-info-k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--green); margin-bottom: 3px; }
.md-info-v { font-size: 14px; color: var(--t1); white-space: pre-wrap; }
.md-footer { text-align: center; padding-top: 12px; }
.md-link { color: var(--t2); font-size: 13px; text-decoration: none; }
`;
