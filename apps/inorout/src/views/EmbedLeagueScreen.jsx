import { useEffect, useState } from "react";
import { getClubLeaguePublic } from "@platform/core/storage/supabase.js";

// Public, no-login embeddable league widget (mig 397). Keyed on a club_leagues
// embed_code (/embed/league/<code>). Designed to sit in an <iframe> on a club's
// own website — chrome-free, tokens-only, a club's fixtures + results in our look.

function fmtDate(iso) {
  if (!iso) return "TBC";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}

export default function EmbedLeagueScreen({ code }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    getClubLeaguePublic(code)
      .then((r) => { if (!alive) return; if (!r?.ok) setNotFound(true); else setD(r); })
      .catch((e) => { if (alive) { console.error("[embed] fetch failed", e); setNotFound(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code]);

  const wrap = (body) => <div className="el-shell"><style>{STYLES}</style><div className="el-wrap">{body}</div></div>;
  if (loading) return wrap(<div className="el-center">Loading…</div>);
  if (notFound || !d) return wrap(<div className="el-center">Fixtures unavailable.</div>);

  const all = d.fixtures || [];
  const results = all.filter((f) => f.status === "completed" && f.home_score != null && f.away_score != null);
  const upcoming = all.filter((f) => f.status !== "completed");

  const scoreLine = (f) => {
    const us = f.our_team || "Us";
    return f.is_home
      ? `${us} ${f.home_score}–${f.away_score} ${f.opponent}`
      : `${f.opponent} ${f.home_score}–${f.away_score} ${us}`;
  };

  return wrap(
    <>
      <div className="el-head">
        <div className="el-club">{d.club_name}</div>
        <div className="el-league">{d.league_name}{d.season_label ? ` · ${d.season_label}` : ""}</div>
      </div>

      {upcoming.length > 0 && (
        <div className="el-sec">
          <div className="el-sec-h">Fixtures</div>
          {upcoming.map((f, i) => (
            <div className="el-row" key={`u${i}`}>
              <div className="el-date">{fmtDate(f.scheduled_date)}{f.kickoff_time ? ` · ${f.kickoff_time}` : ""}</div>
              <div className="el-match">
                {f.is_home ? `${f.our_team || "Us"} v ${f.opponent}` : `${f.opponent} v ${f.our_team || "Us"}`}
                <span className="el-tag">{f.is_home ? "H" : "A"}</span>
                {f.status === "postponed" && <span className="el-tag el-pp">PP</span>}
              </div>
              {f.is_home && f.pitch_name && <div className="el-pitch">{f.pitch_name}</div>}
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="el-sec">
          <div className="el-sec-h">Results</div>
          {results.map((f, i) => (
            <div className="el-row" key={`r${i}`}>
              <div className="el-date">{fmtDate(f.scheduled_date)}</div>
              <div className="el-match el-result">{scoreLine(f)}</div>
            </div>
          ))}
        </div>
      )}

      {all.length === 0 && <div className="el-center">No fixtures yet.</div>}

      <a className="el-foot" href="https://in-or-out.com" target="_blank" rel="noreferrer">via In or Out</a>
    </>
  );
}

const STYLES = `
.el-shell { background: var(--bg); color: var(--t1); font-family: var(--font-body);
  padding: 14px; min-height: 100dvh; }
.el-wrap { max-width: 560px; margin: 0 auto; }
.el-center { color: var(--t2); text-align: center; padding: 40px 0; }
.el-head { padding-bottom: 10px; border-bottom: 1px solid var(--border-subtle); margin-bottom: 12px; }
.el-club { font-family: var(--font-display); font-size: 26px; line-height: 1; }
.el-league { color: var(--t2); font-size: 13px; margin-top: 4px; }
.el-sec { margin-bottom: 16px; }
.el-sec-h { text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px; color: var(--green); margin-bottom: 8px; }
.el-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); }
.el-date { font-size: 12px; color: var(--t2); min-width: 96px; }
.el-match { font-size: 14px; font-weight: 600; flex: 1; }
.el-result { font-variant-numeric: tabular-nums; }
.el-pitch { font-size: 12px; color: var(--t2); }
.el-tag { display: inline-block; font-size: 10px; font-weight: 700; color: var(--t2); border: 1px solid var(--border-subtle);
  border-radius: var(--r-pill); padding: 1px 6px; margin-left: 6px; }
.el-pp { color: var(--red); border-color: var(--red); }
.el-foot { display: inline-block; margin-top: 8px; font-size: 11px; color: var(--t2); text-decoration: none; }
`;
