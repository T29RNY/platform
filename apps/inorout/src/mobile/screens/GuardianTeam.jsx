// GuardianTeam.jsx — Guardian track (mounted at /hub, More hub → "Team").
//
// Honest build of design_handoff_guardian_app README "Team": per active team the child
// plays in — a header card (crest, name, league · season, the team's OWN W-D-L record),
// a read-only Coach row (NOT a chat target), the Squad roster (child's row highlighted),
// and a read-only Team broadcasts feed ("one-way" note). All read-only — no message-send.
//
// Backend:
//   • guardian_list_child_team(child)   (mig 436) → teams[] {header, form, coaches, squad}.
//       form.* is the team's real record from completed club_fixtures. league_position is
//       reserved NULL until the future FA-standings scrape — the position pill is hidden
//       while it is null (no fabricated rank). fa_embed_code/fa_source_url → an honest
//       external "official FA table" link when present (same as the League screen).
//   • guardian_list_child_notices(child) (mig 434) → reused, filtered to audience='team',
//       for the read-only broadcasts feed (sender already resolved to the coach/club).
//
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens).

import { useState, useEffect, useCallback } from "react";
import { guardianListChildTeam, guardianListChildNotices } from "@platform/core";
import MIcon from "../icons.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Deterministic crest tint from the team's name. HSL (not hex) to stay inside the
// no-hardcoded-hex rule — grassroots teams store no brand colours.
function hueFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function Crest({ name, size = 52, r = 15 }) {
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

// timestamptz → a friendly when-line in Europe/London.
function fmtWhen(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt)) return "";
  const now = new Date();
  const mins = Math.floor((now - dt) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", day: "numeric", month: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(dt).map((x) => [x.type, x.value])
  );
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.day} ${MONTHS[Number(p.month) - 1]} · ${hh}:${p.minute}`;
}

// Pull a safe, FA-hosted URL out of the stored FA Full-Time fields. Never injects the
// operator's raw embed HTML — extracts the iframe src (or uses fa_source_url), accepts
// only a *.thefa.com URL. (Mirrors GuardianLeague.faTableUrl.)
function faTableUrl(team) {
  const direct = (team?.fa_source_url || "").trim();
  let raw = direct;
  if (!raw && team?.fa_embed_code) {
    const m = /src\s*=\s*["']([^"']+)["']/i.exec(team.fa_embed_code);
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

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function GuardianTeam({ childId, childFirst, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, teams: [] });
  const [casts, setCasts] = useState([]); // team-audience broadcasts (read-only)

  const load = useCallback(async () => {
    if (!childId) { setState({ loading: false, error: false, teams: [] }); setCasts([]); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Team profile is required; broadcasts are best-effort (never block the screen).
      const [teamRes, noticeRes] = await Promise.all([
        guardianListChildTeam(childId),
        guardianListChildNotices(childId).catch(() => null),
      ]);
      setState({ loading: false, error: false, teams: teamRes?.teams || [] });
      setCasts((noticeRes?.notices || []).filter((n) => n.audience === "team"));
    } catch {
      setState({ loading: false, error: true, teams: [] });
      setCasts([]);
    }
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, teams } = state;

  if (loading) return <Frame onBack={onBack}><Note>Loading {childFirst ? `${childFirst}'s` : "your"} team…</Note></Frame>;
  if (error) {
    return (
      <Frame onBack={onBack}>
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 14, margin: 0 }}>Couldn't load the team right now.</p>
          <button onClick={load} style={pillBtn}>Try again</button>
        </div>
      </Frame>
    );
  }
  if (!teams.length) {
    return (
      <Frame onBack={onBack}>
        <Note>{childFirst ? `${childFirst} isn't` : "Your child isn't"} on a club team yet. Once a coach adds them to a squad, it'll show here.</Note>
      </Frame>
    );
  }

  return (
    <Frame onBack={onBack}>
      {teams.map((t) => (
        <TeamBlock key={t.club_team_id} team={t} childFirst={childFirst} />
      ))}

      {/* Team broadcasts — one-way feed from the coach / club */}
      <div className="m-eyebrow" style={{ margin: "22px 2px 10px" }}>Team broadcasts</div>
      {casts.length === 0 ? (
        <Note>No broadcasts yet. Updates from your coach and club appear here.</Note>
      ) : (
        casts.map((m) => (
          <div key={m.id} className="m-card" style={{ padding: "13px 15px", marginBottom: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 9, flex: "none",
                background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <MIcon name="whistle" size={16} color="var(--amber)" />
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.sender_label || "Coach"}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink4)", fontWeight: 600, flex: "none" }}>{fmtWhen(m.created_at)}</span>
            </div>
            {m.title && <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>{m.title}</div>}
            <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{m.body}</div>
          </div>
        ))
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--ink4)", margin: "8px 2px 4px", lineHeight: 1.45 }}>
        <MIcon name="info" size={14} style={{ flex: "none" }} />
        Broadcasts are one-way — only your coach and club admins can post here.
      </div>
    </Frame>
  );
}

function TeamBlock({ team, childFirst }) {
  const f = team.form || {};
  const coaches = team.coaches || [];
  const squad = team.squad || [];
  const faUrl = faTableUrl(team);
  const hasPos = team.league_position != null;
  const sub = [team.league_name, team.season_label].filter(Boolean).join(" · ");

  return (
    <div style={{ marginBottom: 6 }}>
      {/* team header */}
      <div className="m-card" style={{ padding: "16px 16px", marginTop: 6, display: "flex", alignItems: "center", gap: 14, overflow: "hidden", position: "relative" }}>
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: `hsl(${hueFor(team.club_team_name)} 46% 42%)` }} />
        <Crest name={team.club_team_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.club_team_name}</div>
          {(sub || team.club_name) && (
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {sub || team.club_name}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
            {hasPos && (
              <span style={pill("warn")}>{ordinal(team.league_position)}</span>
            )}
            <span style={pill("mut")}>
              {(f.played || 0)} played · {(f.won || 0)}W {(f.drawn || 0)}D {(f.lost || 0)}L
            </span>
          </div>
        </div>
      </div>

      {/* official FA table link — only when the league publishes an FA Full-Time widget */}
      {faUrl && (
        <a href={faUrl} target="_blank" rel="noopener noreferrer" className="m-card"
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", marginTop: 9,
            textDecoration: "none", color: "inherit", fontFamily: "var(--m-font)",
          }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "var(--info-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name="list" size={16} color="var(--info-ink)" />
          </div>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>Official league table on FA Full-Time</span>
          <MIcon name="arrow" size={16} color="var(--ink4)" />
        </a>
      )}

      {/* coach(es) */}
      <div className="m-eyebrow" style={{ margin: "20px 2px 10px" }}>{coaches.length > 1 ? "Coaches" : "Coach"}</div>
      {coaches.length === 0 ? (
        <Note>No coach listed for this team yet.</Note>
      ) : (
        coaches.map((co, i) => (
          <div key={i} className="m-card" style={{ padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MIcon name="whistle" size={18} color="var(--ink2)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{co.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>
                {capRole(co.role)} · sends your team's updates
              </div>
            </div>
          </div>
        ))
      )}

      {/* squad */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 2px 10px" }}>
        <div className="m-eyebrow" style={{ flex: 1 }}>Squad</div>
        <span style={{ fontSize: 11.5, color: "var(--ink4)", fontWeight: 600 }}>{squad.length} player{squad.length === 1 ? "" : "s"}</span>
      </div>
      {squad.length === 0 ? (
        <Note>No squad members listed yet.</Note>
      ) : (
        <div className="m-card" style={{ overflow: "hidden", padding: 0 }}>
          {squad.map((p, i) => {
            const mine = p.is_child;
            return (
              <div key={p.member_profile_id} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                borderBottom: i < squad.length - 1 ? "1px solid var(--hair)" : "none",
                background: mine ? "var(--amber-soft)" : "transparent",
              }}>
                <Crest name={p.name} size={30} r={9} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: mine ? 800 : 600, color: mine ? "var(--amber)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.name}
                </span>
                {mine && <span style={pill("warn")}>Your child</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function capRole(role) {
  if (!role) return "Team coach";
  const r = String(role).replace(/_/g, " ");
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function pill(kind) {
  const base = { height: 21, display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none" };
  if (kind === "warn") return { ...base, background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)" };
  return { ...base, background: "var(--s3)", color: "var(--ink3)" };
}

function Frame({ children, onBack }) {
  return (
    <div className="m-view-enter">
      {onBack && (
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 10, cursor: "pointer",
          background: "transparent", border: "none", color: "var(--ink3)", fontFamily: "var(--m-font)",
          fontWeight: 600, fontSize: 13.5, padding: "2px 0",
        }}>
          <MIcon name="chevleft" size={16} /> More
        </button>
      )}
      {children}
    </div>
  );
}

function Note({ children }) {
  return <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5, lineHeight: 1.5 }}>{children}</div>;
}

const pillBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
};
