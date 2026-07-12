// TeamManagerLeague.jsx — Team-manager track, first real screen (/hub, tab "league").
//
// Modular Epic C / C3 Part 1: "Fixtures & availability". The manager sees each team
// they actively manage — upcoming fixtures with the squad's availability (counts +
// per-player roster) and recent results. Source-agnostic: FA-imported auto-opened
// fixtures (source='fa_import') surface here automatically alongside manual ones =
// the C3 payoff.
//
// Read-only in this first cut (the manager observes who's in/out; setting availability
// on a player's behalf is a later screen). Data: club_manager_list_team_fixtures()
// (mig 451) — param-less, derives the manager's active teams server-side. Renders
// inside the scoped [data-surface="mobile"] tree → shell amber tokens only.

import { useState, useEffect, useCallback } from "react";
import { clubManagerListTeamFixtures } from "@platform/core";
import MIcon from "../icons.jsx";
import TeamManagerMatchday from "./TeamManagerMatchday.jsx";
import TeamManagerFixtureEdit from "./TeamManagerFixtureEdit.jsx";
import CoachMemberDetailSheet from "./CoachMemberDetailSheet.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "2026-07-05" → { day:"Sat", dm:"5 Jul" }. Local date parts (no TZ shift).
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

// Deterministic crest tint from the opponent's free-text name (no brand colour stored).
// HSL (not hex) so it stays inside the no-hardcoded-hex rule.
function hueFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function Crest({ name, size = 38, r = 11 }) {
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

// Status → token pair for availability chips/pills.
const AVAIL = {
  in:      { soft: "var(--ok-soft)",   ink: "var(--ok-ink)",   label: "In" },
  out:     { soft: "var(--live-soft)", ink: "var(--live-ink)", label: "Out" },
  maybe:   { soft: "var(--amber-soft)", ink: "var(--amber)",   label: "Maybe" },
  pending: { soft: "var(--s3)",        ink: "var(--ink3)",     label: "No reply" },
};

export default function TeamManagerLeague({ toast }) {
  const [state, setState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [openFixture, setOpenFixture] = useState(null);  // drill-in matchday detail
  const [editFixture, setEditFixture] = useState(null);  // { id, opponent } — home-fixture edit sheet
  const [detailFor, setDetailFor] = useState(null);      // roster row tap → { member_profile_id, name } (mig 526)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await clubManagerListTeamFixtures();
      setState({ loading: false, error: false, teams: res?.teams || [] });
    } catch {
      setState({ loading: false, error: true, teams: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // matchday drill-in (tap a fixture) — additive, keeps this screen the list
  if (openFixture) {
    return (
      <TeamManagerMatchday
        fixtureId={openFixture}
        toast={toast}
        onBack={() => { setOpenFixture(null); load(); }}
      />
    );
  }

  const { loading, error, teams } = state;
  const team = teams[teamIdx] || teams[0] || null;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">League</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading your fixtures…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">League</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load fixtures right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">League</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>No teams to manage yet.</p>
      </div>
    );
  }

  const upcoming = team.upcoming || [];
  const recent = team.recent || [];

  return (
    <div>
      {/* team switcher — only when the manager runs 2+ teams */}
      {teams.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 2px 4px" }}>
          {teams.map((t, i) => {
            const on = i === teamIdx;
            return (
              <button
                key={t.team_id}
                onClick={() => setTeamIdx(i)}
                style={{
                  height: 32, padding: "0 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
                  fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700, border: "1px solid",
                  background: on ? "var(--amber-soft)" : "transparent",
                  color: on ? "var(--amber)" : "var(--ink3)",
                  borderColor: on ? "var(--amber-glow)" : "var(--hair2)",
                }}
              >{t.team_name}</button>
            );
          })}
        </div>
      )}

      {/* UPCOMING + availability */}
      <SecHead title="Up next" meta={team.team_name} />
      {upcoming.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>
          No upcoming fixtures.
        </div>
      )}
      {upcoming.map((f) => (
        <FixtureCard
          key={f.fixture_id}
          f={f}
          onOpen={() => setOpenFixture(f.fixture_id)}
          onEdit={() => setEditFixture({ id: f.fixture_id, opponent: f.opponent_name })}
          onTapPlayer={setDetailFor}
        />
      ))}

      {/* RECENT RESULTS */}
      <SecHead title="Recent results" meta={recent.length ? `last ${recent.length}` : ""} />
      {recent.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>
          No results yet.
        </div>
      )}
      {recent.map((r) => {
        const us = r.is_home ? r.home_score : r.away_score;
        const them = r.is_home ? r.away_score : r.home_score;
        const hasScore = us != null && them != null;
        const res = hasScore ? resultOf(us, them) : null;
        const d = fmtDate(r.scheduled_date);
        const col = res === "W" ? "var(--ok-ink)" : res === "L" ? "var(--live-ink)" : "var(--ink2)";
        const bg = res === "W" ? "var(--ok-soft)" : res === "L" ? "var(--live-soft)" : "var(--s3)";
        return (
          <div key={r.fixture_id} className="m-card" onClick={() => setOpenFixture(r.fixture_id)}
            style={{ padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <span style={{
              width: 30, height: 30, borderRadius: 9, flex: "none", display: "flex", alignItems: "center",
              justifyContent: "center", background: bg, color: col, fontSize: 13, fontWeight: 800,
            }}>{res || "–"}</span>
            <Crest name={r.opponent_name} size={34} r={9} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.opponent_name} <span style={{ color: "var(--ink4)", fontWeight: 500 }}>({r.is_home ? "H" : "A"})</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {d.day} {d.dm}{(r.location || r.venue_name) ? " · " + (r.location || r.venue_name) : ""}
              </div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", flex: "none", color: "var(--ink)" }}>
              {hasScore ? <>{us}<span style={{ color: "var(--ink4)", margin: "0 3px" }}>–</span>{them}</> : <span style={{ color: "var(--ink4)", fontSize: 13, fontWeight: 600 }}>result TBC</span>}
            </div>
          </div>
        );
      })}

      {editFixture && (
        <TeamManagerFixtureEdit
          fixtureId={editFixture.id}
          opponentName={editFixture.opponent}
          toast={toast}
          onClose={() => setEditFixture(null)}
          onSaved={load}
        />
      )}

      {detailFor && (
        <CoachMemberDetailSheet
          memberProfileId={detailFor.member_profile_id}
          name={detailFor.name}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

// One upcoming fixture: header (date · opponent · home/away · location) + an availability
// summary (counts pills) that expands to the per-player roster.
function FixtureCard({ f, onOpen, onEdit, onTapPlayer }) {
  const [open, setOpen] = useState(false);
  const d = fmtDate(f.scheduled_date);
  const c = f.counts || { in: 0, out: 0, maybe: 0, pending: 0, total: 0 };
  const roster = f.roster || [];
  const where = f.location || f.pitch_name || f.venue_name || f.league_name || "";
  return (
    <div className="m-card" style={{ padding: "13px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 50, flex: "none", textAlign: "center" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>{d.day} {d.dm.split(" ")[0]}</div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 1 }}>{f.kickoff_time || "TBC"}</div>
        </div>
        <Crest name={f.opponent_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.opponent_name}</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span style={{
              height: 18, fontSize: 10, padding: "0 7px", flex: "none", borderRadius: "var(--r-pill)",
              display: "inline-flex", alignItems: "center", background: "var(--s3)", color: "var(--ink2)", fontWeight: 700,
            }}>{f.is_home ? "Home" : "Away"}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{where}</span>
          </div>
        </div>
      </div>

      {/* availability summary — tap to expand the roster */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--hair)",
          display: "flex", alignItems: "center", gap: 7, background: "transparent", border: "none",
          cursor: "pointer", fontFamily: "var(--m-font)", textAlign: "left",
        }}
      >
        <CountPill status="in" n={c.in} />
        <CountPill status="out" n={c.out} />
        <CountPill status="maybe" n={c.maybe} />
        <CountPill status="pending" n={c.pending} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{open ? "Hide" : "Squad"}</span>
        <MIcon name="chevron" size={15} color="var(--ink3)" style={{ transform: open ? "rotate(90deg)" : "none" }} />
      </button>

      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          {roster.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "4px 2px" }}>No squad members yet.</div>
          )}
          {roster.map((p, i) => {
            const a = AVAIL[p.status] || AVAIL.pending;
            const tappable = !!(p.member_profile_id && onTapPlayer);
            return (
              <button
                key={(p.member_profile_id || p.name) + "·" + i}
                onClick={tappable ? () => onTapPlayer({ member_profile_id: p.member_profile_id, name: p.name }) : undefined}
                style={{
                  width: "100%", textAlign: "left", font: "inherit", color: "inherit",
                  background: "transparent", border: "none", cursor: tappable ? "pointer" : "default",
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 2px",
                }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 8, flex: "none", display: "flex", alignItems: "center",
                  justifyContent: "center", background: "var(--s4)", color: "var(--ink3)", fontSize: 10.5, fontWeight: 800,
                }}>{initials(p.name)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                <span style={{
                  height: 22, padding: "0 10px", borderRadius: "var(--r-pill)", flex: "none",
                  display: "inline-flex", alignItems: "center", fontSize: 11.5, fontWeight: 700,
                  background: a.soft, color: a.ink,
                }}>{a.label}</span>
                {tappable && <MIcon name="chevron" size={13} color="var(--ink4)" />}
              </button>
            );
          })}
        </div>
      )}

      {/* actions: matchday drill-in (pick XI + result) + edit details for home fixtures */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={onOpen}
          style={{
            flex: 1, padding: "10px", borderRadius: "var(--r-pill)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
            fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
          }}
        >
          Team sheet &amp; result
          <MIcon name="chevron" size={14} color="var(--amber)" />
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            aria-label="Edit fixture details"
            style={{
              flex: "none", padding: "10px 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
              background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--ink2)",
              fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
            }}
          >
            <MIcon name="cog" size={14} color="var(--ink2)" /> Edit
          </button>
        )}
      </div>
    </div>
  );
}

function CountPill({ status, n }) {
  const a = AVAIL[status];
  return (
    <span style={{
      height: 24, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none",
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
      background: a.soft, color: a.ink,
    }}>{n}<span style={{ fontSize: 10.5, opacity: 0.85, fontWeight: 600 }}>{a.label}</span></span>
  );
}

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}
