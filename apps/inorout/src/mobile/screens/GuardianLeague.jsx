// GuardianLeague.jsx — Guardian track, screen 2 (mounted at /hub, tab "league").
//
// Honest build of design_handoff_guardian_app/m-guardian.jsx GuardianLeague
// (Table / Fixtures / Results). The prototype fabricates a full division table —
// but grassroots club_fixtures record only ONE club's games vs FREE-TEXT opponents,
// so a real computed league table is impossible (audit; mirrors the mig-394/397
// spike NO-GO). Instead, honestly:
//   • Table  : the child's TEAM season form (P/W/D/L/GD/Pts/last-5), clearly the
//              team's own record — NOT a league rank — plus a link to the official
//              FA Full-Time table when the operator has stored one (fa_embed_code /
//              fa_source_url). No raw operator HTML is injected (XSS-safe): we parse
//              out the FA-hosted URL and open it externally.
//   • Fixtures: the team's upcoming league fixtures.
//   • Results : the team's completed league results with W/D/L.
//
// Data: guardian_list_child_leagues(child) (mig 428). Renders inside the scoped
// [data-surface="mobile"] tree, so it uses the shell's amber tokens.

import { useState, useEffect, useCallback } from "react";
import { guardianListChildLeagues } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "2026-07-12" → "JULY 2026" (month-group header). Undated rows fall under "Date TBC".
function monthLabel(dateKey) {
  const [y, m] = String(dateKey || "").split("-").map(Number);
  if (!y || !m) return "Date TBC";
  return `${MONTHS_FULL[m - 1]} ${y}`.toUpperCase();
}

// Group a date-ordered list into consecutive month buckets [{ key, label, items[] }].
function groupByMonth(list) {
  const groups = [];
  for (const it of list) {
    const key = String(it.scheduled_date || "").slice(0, 7) || "tbc";
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, label: monthLabel(it.scheduled_date), items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return groups;
}

function fmtDate(iso) {
  if (!iso) return { day: "", dm: "TBC" };
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return { day: "", dm: "TBC" };
  const dt = new Date(y, m - 1, d);
  return { day: DAYS[dt.getDay()], dm: `${d} ${MONTHS[m - 1]}` };
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Deterministic crest tint from the opponent's free-text name. HSL (not hex) to
// stay inside the no-hardcoded-hex rule.
function hueFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function Crest({ name, size = 28, r = 8 }) {
  const hue = hueFor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, hsl(${hue} 46% 40%) 0 52%, hsl(${hue} 46% 30%) 100%)`,
      color: "white", fontSize: size * 0.36, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(name)}</div>
  );
}

function resultOf(us, them) { return us > them ? "W" : us < them ? "L" : "D"; }

// Pull a safe, FA-hosted URL out of the stored FA Full-Time fields. Never injects
// the operator's raw embed HTML — extracts the iframe src (or uses fa_source_url),
// and only accepts a *.thefa.com URL.
function faTableUrl(league) {
  const direct = (league?.fa_source_url || "").trim();
  let raw = direct;
  if (!raw && league?.fa_embed_code) {
    const m = /src\s*=\s*["']([^"']+)["']/i.exec(league.fa_embed_code);
    if (m) raw = m[1];
  }
  if (!raw) return null;
  try {
    const u = new URL(raw, "https://fulltime-league.thefa.com");
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!/(^|\.)thefa\.com$/i.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

export default function GuardianLeague({ childId, childFirst }) {
  const [state, setState] = useState({ loading: true, error: false, leagues: [] });
  const [leagueIdx, setLeagueIdx] = useState(0);
  const [tab, setTab] = useState("table");
  const [detail, setDetail] = useState(null); // tapped fixture/result → detail sheet

  const load = useCallback(async () => {
    if (!childId) { setState({ loading: false, error: false, leagues: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await guardianListChildLeagues(childId);
      setState({ loading: false, error: false, leagues: res?.leagues || [] });
      setLeagueIdx(0);
    } catch {
      setState({ loading: false, error: true, leagues: [] });
    }
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, leagues } = state;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">League</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {childFirst ? `${childFirst}'s` : "your"} league…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">League</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load the league right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  if (!leagues.length) {
    return (
      <div className="m-card" style={{ marginTop: 8, padding: "16px 15px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>No league yet</div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4, lineHeight: 1.5 }}>
          {childFirst ? `${childFirst}'s` : "Your"} team isn't in a league with fixtures yet. When the club adds league fixtures they'll show here.
        </div>
      </div>
    );
  }

  const league = leagues[leagueIdx] || leagues[0];
  const form = league.form || {};
  const faUrl = faTableUrl(league);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "8px 2px 12px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{league.league_name}</h2>
        <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>
          {[league.season_label, league.club_name].filter(Boolean).join(" · ")}
        </span>
      </div>

      {/* league switcher — only when the child plays in 2+ leagues */}
      {leagues.length > 1 && (
        <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
          {leagues.map((l, i) => {
            const on = i === leagueIdx;
            return (
              <button key={l.league_id} onClick={() => setLeagueIdx(i)} style={{
                flex: "none", height: 32, padding: "0 13px", borderRadius: "var(--r-pill)", cursor: "pointer",
                fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700, border: "1px solid",
                background: on ? "var(--amber-soft)" : "transparent", color: on ? "var(--amber)" : "var(--ink3)",
                borderColor: on ? "var(--amber-glow)" : "var(--hair2)",
              }}>{l.club_team_name}</button>
            );
          })}
        </div>
      )}

      {/* tab switcher */}
      <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--s3)", borderRadius: 14, border: "1px solid var(--hair)" }}>
        {[["table", "Table"], ["fixtures", "Fixtures"], ["results", "Results"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, height: 36, borderRadius: 10, border: "none", cursor: "pointer",
            fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13.5,
            background: tab === id ? "var(--s4)" : "transparent", color: tab === id ? "var(--ink)" : "var(--ink3)",
          }}>{label}</button>
        ))}
      </div>

      {tab === "table" && (
        <div style={{ marginTop: 14 }}>
          {/* season-form card — the team's own record, NOT a league position */}
          <div className="m-card" style={{ padding: "15px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <Crest name={league.club_team_name} size={40} r={12} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{league.club_team_name}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>Season form · your team's record</div>
              </div>
              {Array.isArray(form.last5) && form.last5.length > 0 && (
                <div style={{ display: "flex", gap: 4, flex: "none" }}>
                  {form.last5.map((r, i) => (
                    <span key={i} style={{
                      width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800,
                      background: r === "W" ? "var(--ok-soft)" : r === "L" ? "var(--live-soft)" : "var(--s3)",
                      color: r === "W" ? "var(--ok-ink)" : r === "L" ? "var(--live-ink)" : "var(--ink2)",
                    }}>{r}</span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
              {[["Pl", form.played], ["W", form.won], ["D", form.drawn], ["L", form.lost],
                ["GD", (form.gd > 0 ? "+" : "") + (form.gd ?? 0)], ["Pts", form.points]].map(([k, v], i) => (
                <div key={k} style={{
                  flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 10,
                  background: i === 5 ? "var(--amber-soft)" : "var(--s2)", border: "1px solid var(--hair)",
                }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: i === 5 ? "var(--amber)" : "var(--ink)", letterSpacing: "-0.02em" }}>{v ?? 0}</div>
                  <div style={{ fontSize: 10.5, color: "var(--ink3)", fontWeight: 700, marginTop: 1 }}>{k}</div>
                </div>
              ))}
            </div>
          </div>

          {/* official FA Full-Time table — link out, or honest note */}
          {faUrl ? (
            <a href={faUrl} target="_blank" rel="noopener noreferrer" className="m-card"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", marginTop: 11, textDecoration: "none" }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MIcon name="trophy" size={19} color="var(--ink2)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Full division table</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>Official table on FA Full-Time</div>
              </div>
              <MIcon name="arrow" size={18} color="var(--ink3)" />
            </a>
          ) : (
            <div className="m-card" style={{ padding: "13px 15px", marginTop: 11, fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.5 }}>
              The full division table isn't published for this league yet. Your team's running record is shown above.
            </div>
          )}
        </div>
      )}

      {tab === "fixtures" && (
        <div style={{ marginTop: 14 }}>
          {(!league.fixtures || league.fixtures.length === 0) && (
            <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>No upcoming fixtures.</div>
          )}
          {groupByMonth(league.fixtures || []).map((g) => (
            <div key={g.key} style={{ marginBottom: 4 }}>
              <MonthHead label={g.label} />
              {g.items.map((f) => (
                <LeagueRow key={f.fixture_id} row={f} kind="fixture" onClick={() => setDetail({ ...f, kind: "fixture" })} />
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "results" && (
        <div style={{ marginTop: 14 }}>
          {(!league.results || league.results.length === 0) && (
            <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>No results yet.</div>
          )}
          {groupByMonth(league.results || []).map((g) => (
            <div key={g.key} style={{ marginBottom: 4 }}>
              <MonthHead label={g.label} />
              {g.items.map((r) => (
                <LeagueRow key={r.fixture_id} row={r} kind="result" onClick={() => setDetail({ ...r, kind: "result" })} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* row-tap detail */}
      {detail && <LeagueDetailSheet item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function MonthHead({ label }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em", color: "var(--ink3)", margin: "14px 2px 8px", textTransform: "uppercase" }}>
      {label}
    </div>
  );
}

// One compact, tappable league row (fixture or result).
function LeagueRow({ row, kind, onClick }) {
  const d = fmtDate(row.scheduled_date);
  const isResult = kind === "result";
  const us = row.is_home ? row.home_score : row.away_score;
  const them = row.is_home ? row.away_score : row.home_score;
  const hasScore = us != null && them != null;
  const res = isResult && hasScore ? resultOf(us, them) : null;
  const col = res === "W" ? "var(--ok-ink)" : res === "L" ? "var(--live-ink)" : "var(--ink2)";
  const bg = res === "W" ? "var(--ok-soft)" : res === "L" ? "var(--live-soft)" : "var(--s3)";
  return (
    <button onClick={onClick} className="m-card" style={{
      width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "var(--m-font)", color: "inherit",
      padding: "10px 12px", marginBottom: 7, display: "flex", alignItems: "center", gap: 11,
    }}>
      {isResult ? (
        <span style={{ width: 28, height: 28, borderRadius: 8, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: bg, color: col, fontSize: 12.5, fontWeight: 800 }}>{res || "–"}</span>
      ) : (
        <div style={{ width: 44, flex: "none", textAlign: "center" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink)" }}>{d.dm.split(" ")[0]}</div>
          <div style={{ fontSize: 10, color: "var(--ink3)" }}>{d.day}</div>
        </div>
      )}
      <Crest name={row.opponent_name} size={30} r={9} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.opponent_name} <span style={{ color: "var(--ink4)", fontWeight: 500 }}>({row.is_home ? "H" : "A"})</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {isResult ? `${d.day} ${d.dm}` : `${d.day} ${d.dm}${row.kickoff_time ? " · " + row.kickoff_time : ""}${row.pitch_name ? " · " + row.pitch_name : ""}`}
        </div>
      </div>
      {isResult ? (
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em", flex: "none", color: "var(--ink)" }}>
          {hasScore ? <>{us}<span style={{ color: "var(--ink4)", margin: "0 2px" }}>–</span>{them}</> : <span style={{ color: "var(--ink4)", fontSize: 12, fontWeight: 600 }}>TBC</span>}
        </div>
      ) : (
        <MIcon name="chevron" size={15} color="var(--ink4)" style={{ flex: "none" }} />
      )}
    </button>
  );
}

// Detail sheet for a tapped league fixture/result. Shows fields the reader already returns
// (opponent, H/A, date, kickoff+pitch on fixtures, score+result on results). Venue/referee
// land with the mig-532 field-add (epic Phase 7).
function LeagueDetailSheet({ item, onClose }) {
  const isResult = item.kind === "result";
  const d = fmtDate(item.scheduled_date);
  const us = item.is_home ? item.home_score : item.away_score;
  const them = item.is_home ? item.away_score : item.home_score;
  const hasScore = us != null && them != null;
  const res = isResult && hasScore ? resultOf(us, them) : null;
  const resLabel = res === "W" ? "Win" : res === "L" ? "Loss" : res === "D" ? "Draw" : null;
  return (
    <MobileSheet title={isResult ? "Result" : "Fixture"} onClose={onClose}>
      <div className="m-card" style={{ padding: "15px 15px", background: "var(--s2)", marginTop: 4, display: "flex", alignItems: "center", gap: 13 }}>
        <Crest name={item.opponent_name} size={46} r={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink)" }}>{item.opponent_name}</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 2 }}>{d.day} {d.dm}{item.kickoff_time ? " · " + item.kickoff_time : ""}</div>
        </div>
        {isResult && hasScore && (
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--ink)", flex: "none" }}>{us}<span style={{ color: "var(--ink4)", margin: "0 3px" }}>–</span>{them}</div>
        )}
      </div>
      <div className="m-card" style={{ padding: "4px 15px", marginTop: 11, background: "var(--s2)" }}>
        <KV k="Home / away" v={item.is_home ? "Home" : "Away"} />
        {!isResult && item.kickoff_time && <KV k="Kick-off" v={item.kickoff_time} />}
        {!isResult && item.pitch_name && <KV k="Pitch" v={item.pitch_name} />}
        {isResult && resLabel && <KV k="Result" v={resLabel} />}
        <KV k="Date" v={`${d.day} ${d.dm}`} last />
      </div>
    </MobileSheet>
  );
}

function KV({ k, v, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: last ? "none" : "1px solid var(--hair)" }}>
      <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink3)", fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", textAlign: "right" }}>{v}</span>
    </div>
  );
}
