// TournamentView.jsx — Operator track, the tournament SPECTATOR/FOLLOW screen (amber).
//
// Builds the design_handoff_guardian_app/m-tournament.jsx Tournament() screen in amber over
// the EXISTING get_tournament_public(slug) reader (no backend change). Live scores poll every
// 30s while status='live' (the real, working mechanism — instant realtime is the separate
// shared Live-Match upgrade). Follow-a-team is persisted via tournament_set_team_follow /
// tournament_list_my_follows (mig 439, keyed on auth.uid()). Register-a-team reuses
// tournament_register_team when entries are open.
//
// Reached from the operator Cups index (and, later, a LIVE banner). tournamentId is passed in
// because get_tournament_public doesn't carry the event id (needed for the follow-list read).

import { useEffect, useMemo, useRef, useState } from "react";
import { getTournamentPublic, tournamentSetTeamFollow, tournamentListMyFollows, tournamentRegisterTeam, tournamentReport } from "@platform/core/storage/supabase.js";
import MIcon from "../icons.jsx";

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}
function gbp(pence) { return "£" + Math.round((pence || 0) / 100).toLocaleString("en-GB"); }

// ── small primitives ─────────────────────────────────────────────────────────
function Eyebrow({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 2px 9px" }}>
      <div className="m-eyebrow">{children}</div>
      {right && <span style={{ fontSize: 11.5, color: "var(--ink4)", fontWeight: 600 }}>{right}</span>}
    </div>
  );
}

function FixtureRow({ fx, follow }) {
  const live = fx.status === "in_progress";
  const ft = fx.status === "completed";
  const hasScore = fx.home_score != null && fx.away_score != null;
  const mine = follow.has(fx.home_team_name) || follow.has(fx.away_team_name);
  const statusText = live ? (fx.current_period || "LIVE") : ft ? "FT" : fx.status === "postponed" ? "PP" : (fx.kickoff_time ? fx.kickoff_time.slice(0, 5) : "—");
  return (
    <div className="m-card" style={{
      padding: "10px 13px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10,
      background: mine ? "var(--amber-soft)" : "var(--s2)", borderColor: mine ? "var(--amber-glow)" : undefined,
    }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: ft && hasScore && fx.home_score > fx.away_score ? 800 : 600, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: follow.has(fx.home_team_name) ? "var(--amber)" : "var(--ink)" }}>{fx.home_team_name || "TBD"}</span>
      </div>
      <div style={{ flex: "none", minWidth: 52, textAlign: "center" }}>
        {hasScore
          ? <div style={{ fontSize: 16, fontWeight: 800, color: live ? "var(--ink)" : "var(--ink2)" }}>{fx.home_score}<span style={{ color: "var(--ink4)", margin: "0 3px" }}>:</span>{fx.away_score}</div>
          : <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink3)" }}>{statusText}</span>}
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", marginTop: 1, color: live ? "var(--live-ink)" : "var(--ink4)" }}>
          {live ? (fx.current_period ? "LIVE" : "LIVE") : ft ? (fx.pitch_name || "") : (fx.pitch_name || "")}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: ft && hasScore && fx.away_score > fx.home_score ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: follow.has(fx.away_team_name) ? "var(--amber)" : "var(--ink)" }}>{fx.away_team_name || "TBD"}</span>
      </div>
    </div>
  );
}

function groupFixtures(fixtures) {
  const groups = []; let cur = null;
  for (const fx of fixtures) {
    const label = fx.round_name || (fx.round != null ? `Round ${fx.round}` : (fx.scheduled_date ? fmtDate(fx.scheduled_date) : "Fixtures"));
    if (!cur || cur.label !== label) { cur = { label, items: [] }; groups.push(cur); }
    cur.items.push(fx);
  }
  return groups;
}

// ── register card ──────────────────────────────────────────────────────────
function RegisterCard({ t, slug, toast }) {
  const comps = t.competitions ?? [];
  const [compId, setCompId] = useState(comps[0]?.competition_id || "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast?.({ icon: "alert", text: "Enter a team name" }); return; }
    setBusy(true);
    try {
      await tournamentRegisterTeam(slug, compId || comps[0]?.competition_id, name.trim(), email.trim() || null);
      setDone(true);
    } catch (e) {
      const c = e?.message || "";
      toast?.({ icon: "alert", text: c.includes("team_name_taken") ? "That name's already entered" : c.includes("registration_closed") ? "Entries just closed" : "Couldn't register — try again" });
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="m-card" style={{ padding: "14px 15px", background: "var(--ok-soft)", borderColor: "var(--ok)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MIcon name="check" size={20} color="var(--ok-ink)" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>You're in — pending approval</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{name.trim()} is registered. The organiser will confirm.</div>
          </div>
        </div>
      </div>
    );
  }

  // No competition yet (e.g. a freshly-created draft) — there's nothing to register into,
  // and calling tournamentRegisterTeam with an undefined competition_id 404s silently. Show
  // a clear holding state instead of a form that can only fail.
  if (comps.length === 0) {
    return (
      <div className="m-card" style={{ padding: "14px 15px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>Registration opening soon</div>
        <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 4 }}>The organiser is still setting this tournament up. Check back shortly.</div>
      </div>
    );
  }

  const inputStyle = { width: "100%", background: "var(--s3)", border: "1px solid var(--hair)", borderRadius: "var(--r-md)", padding: "11px 12px", fontSize: 15, color: "var(--ink)", fontFamily: "var(--m-font)", boxSizing: "border-box" };
  return (
    <div className="m-card" style={{ padding: "14px 15px" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>Register your team</div>
      <div style={{ fontSize: 12.5, color: "var(--ink3)", margin: "4px 0 12px" }}>
        {t.entry_fee_pence ? `${gbp(t.entry_fee_pence)} per team. ` : ""}Spots are limited.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {comps.length > 1 && (
          <select value={compId} onChange={(e) => setCompId(e.target.value)} style={inputStyle}>
            {comps.map((c) => <option key={c.competition_id} value={c.competition_id}>{c.name}</option>)}
          </select>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" maxLength={60} style={inputStyle} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Contact email (optional)" type="email" style={inputStyle} />
        <button onClick={submit} disabled={busy}
          style={{ border: "none", borderRadius: "var(--r-md)", padding: "13px", fontSize: 15, fontWeight: 700, color: "var(--amber-ink)", background: "var(--amber)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "var(--m-font)" }}>
          {busy ? "Registering…" : "Register team"}
        </button>
      </div>
    </div>
  );
}

export default function TournamentView({ slug, tournamentId, onBack, toast }) {
  const [t, setT] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | notfound
  const [followIds, setFollowIds] = useState(() => new Set()); // followed competition_team_ids (source of truth)
  const [compIdx, setCompIdx] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const reportBusyRef = useRef(false);
  const pollRef = useRef(null);

  // Public moderation report (mig 495, Apple 1.2) — works signed-out (anon RPC).
  const sendReport = async (reason) => {
    if (reportBusyRef.current || reportSent) return;
    reportBusyRef.current = true;
    try {
      await tournamentReport(slug, reason);
      setReportSent(true); setReportOpen(false);
      toast?.({ icon: "check", text: "Thanks — report sent", sub: "Our team will review it" });
    } catch (e) {
      console.error("[tournament] report failed", e);
      toast?.({ icon: "alert", text: "Couldn't send report", sub: "Please try again" });
    } finally {
      reportBusyRef.current = false;
    }
  };

  const load = (first) => getTournamentPublic(slug)
    .then((d) => { if (!d?.ok) setStatus("notfound"); else { setT(d); setStatus("ok"); } })
    .catch((e) => { console.error("[tournament] public fetch failed", e); if (first) setStatus("notfound"); });

  useEffect(() => { setStatus("loading"); setT(null); load(true); }, [slug]);

  // follow state (per-user) — needs the event id, passed in from the index
  useEffect(() => {
    if (!tournamentId) return;
    tournamentListMyFollows(tournamentId)
      .then((ids) => setFollowIds(new Set(ids || [])))
      .catch((e) => console.error("[tournament] list follows failed", e));
  }, [tournamentId]);

  // live poll
  useEffect(() => {
    if (t?.status !== "live") return;
    pollRef.current = setInterval(() => load(false), 30000);
    return () => clearInterval(pollRef.current);
  }, [t?.status, slug]);

  // A team NAME can carry several competition_team_ids (a group entry + a knockout entry).
  // Follow is conceptually "follow the team", so map each name to ALL its ids and treat the
  // team as followed when ANY of them is followed; toggling follows/unfollows them together.
  const teamIds = useMemo(() => {
    const m = new Map();
    (t?.competitions ?? []).forEach((c) => (c.teams ?? []).forEach((tm) => {
      if (!tm.team_name || !tm.competition_team_id) return;
      const arr = m.get(tm.team_name) || [];
      arr.push(tm.competition_team_id);
      m.set(tm.team_name, arr);
    }));
    return m;
  }, [t]);

  const followNames = useMemo(() => {
    const s = new Set();
    teamIds.forEach((ids, nm) => { if (ids.some((id) => followIds.has(id))) s.add(nm); });
    return s;
  }, [teamIds, followIds]);

  const toggleFollow = async (teamName) => {
    const ids = teamIds.get(teamName) || [];
    if (!ids.length) return;
    const on = ids.some((id) => followIds.has(id));
    const next = new Set(followIds);
    ids.forEach((id) => (on ? next.delete(id) : next.add(id)));
    setFollowIds(next); // optimistic
    try {
      await Promise.all(ids.map((id) => tournamentSetTeamFollow(id, !on)));
      toast?.({ icon: on ? "check" : "star", text: on ? `Unfollowed ${teamName}` : `Following ${teamName}`, sub: on ? "Alerts off" : "Score & result alerts on" });
    } catch (e) {
      console.error("[tournament] follow toggle failed", e);
      setFollowIds(followIds); // revert
      toast?.({ icon: "alert", text: "Couldn't update follow" });
    }
  };

  const Back = onBack ? (
    <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, padding: "2px 2px 10px" }}>
      <MIcon name="chevleft" size={16} color="var(--ink3)" /> Tournaments
    </button>
  ) : null;

  if (status === "loading") {
    return <div className="m-view-enter">{Back}<div className="m-card" style={{ padding: "22px 16px", textAlign: "center" }}><div style={{ fontSize: 13.5, color: "var(--ink3)" }}>Loading…</div></div></div>;
  }
  if (status === "notfound" || !t) {
    return <div className="m-view-enter">{Back}<div className="m-card" style={{ padding: "22px 16px", textAlign: "center" }}><div style={{ fontSize: 13.5, color: "var(--ink3)" }}>Tournament not found.</div></div></div>;
  }

  const isLive = t.status === "live";
  const comps = t.competitions ?? [];
  const activeComp = comps[compIdx] || comps[0] || null;
  // get_tournament_public.fixtures already INCLUDES the knockout fixtures; knockout_fixtures
  // is a subset — so draw live/following from fixtures alone (no concat → no dup keys), and
  // strip knockout ids out of the group-stage section.
  const knockoutIds = new Set((t.knockout_fixtures ?? []).map((f) => f.fixture_id));
  const allFixtures = t.fixtures ?? [];
  const liveFixtures = allFixtures.filter((f) => f.status === "in_progress");
  const followFixtures = allFixtures.filter((f) => followNames.has(f.home_team_name) || followNames.has(f.away_team_name));
  const compFixtures = (activeComp ? allFixtures.filter((f) => f.competition_id === activeComp.competition_id) : allFixtures).filter((f) => !knockoutIds.has(f.fixture_id));
  const compKnockout = activeComp ? (t.knockout_fixtures ?? []).filter((f) => f.competition_id === activeComp.competition_id) : (t.knockout_fixtures ?? []);
  const standingsBlock = activeComp ? (t.standings ?? []).find((s) => s.competition_id === activeComp.competition_id) : (t.standings ?? [])[0];
  const rows = standingsBlock?.rows ?? [];
  const rowsByGroup = {};
  rows.forEach((r) => { const g = r.group_label || "_"; (rowsByGroup[g] ||= []).push(r); });
  const groupKeys = Object.keys(rowsByGroup);

  const statusPill = {
    live: { label: "LIVE", bg: "var(--live-soft)", fg: "var(--live-ink)", dot: true },
    open: { label: "Entries open", bg: "var(--ok-soft)", fg: "var(--ok-ink)" },
    closed: { label: "Entries closed", bg: "var(--s3)", fg: "var(--ink3)" },
    completed: { label: "Finished", bg: "var(--s3)", fg: "var(--ink3)" },
    draft: { label: "Draft", bg: "var(--s3)", fg: "var(--ink3)" },
  }[t.status] || { label: t.status, bg: "var(--s3)", fg: "var(--ink3)" };

  return (
    <div className="m-view-enter">
      {Back}

      {/* hero */}
      <div className="m-card" style={{ padding: "15px 16px", background: "linear-gradient(135deg, var(--s2), var(--s1))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, flex: "none", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name="cup" size={24} color="var(--amber)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--ink)" }}>{t.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>
              {fmtDate(t.event_date)}{t.event_end_date && t.event_end_date !== t.event_date ? ` – ${fmtDate(t.event_end_date)}` : ""}{t.venue_name ? ` · ${t.venue_name}` : ""}
            </div>
          </div>
          <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: "var(--r-pill)", background: statusPill.bg, color: statusPill.fg }}>
            {statusPill.dot && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--live)" }} />}{statusPill.label}
          </span>
        </div>
      </div>

      {/* register (entries open) */}
      {t.registration_open && <div style={{ marginTop: 12 }}><RegisterCard t={t} slug={slug} toast={toast} /></div>}

      {/* following */}
      {followFixtures.length > 0 && (
        <>
          <Eyebrow right={`${followNames.size} team${followNames.size === 1 ? "" : "s"}`}>Following</Eyebrow>
          {followFixtures.map((fx) => <FixtureRow key={"f" + fx.fixture_id} fx={fx} follow={followNames} />)}
        </>
      )}

      {/* live now */}
      {liveFixtures.length > 0 && (
        <>
          <Eyebrow right={`${liveFixtures.length} on pitch`}>Live now</Eyebrow>
          {liveFixtures.map((fx) => <FixtureRow key={"l" + fx.fixture_id} fx={fx} follow={followNames} />)}
        </>
      )}

      {/* competition selector */}
      {comps.length > 1 && (
        <div style={{ display: "flex", gap: 4, padding: 5, background: "var(--s2)", borderRadius: "var(--r-lg)", border: "1px solid var(--hair)", marginTop: 18 }}>
          {comps.map((c, i) => (
            <button key={c.competition_id} onClick={() => setCompIdx(i)}
              style={{ flex: 1, minWidth: 0, height: 34, borderRadius: "var(--r-md)", border: "none", cursor: "pointer", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                background: compIdx === i ? "var(--s4)" : "transparent", color: compIdx === i ? "var(--ink)" : "var(--ink3)" }}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* standings */}
      {rows.length > 0 && (
        <>
          <Eyebrow right={comps.length > 1 ? activeComp?.name : null}>Table</Eyebrow>
          {groupKeys.map((g) => (
            <div key={g} className="m-card" style={{ overflow: "hidden", marginBottom: 10, padding: 0 }}>
              {groupKeys.length > 1 && g !== "_" && <div className="m-eyebrow" style={{ padding: "10px 13px 4px" }}>Group {g}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "22px 1fr 24px 24px 30px 28px 24px", padding: "8px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--ink3)", borderBottom: "1px solid var(--hair)" }}>
                <span>#</span><span>Team</span><span style={{ textAlign: "center" }}>P</span><span style={{ textAlign: "center" }}>W</span><span style={{ textAlign: "center" }}>GD</span><span style={{ textAlign: "center", color: "var(--ink2)" }}>Pts</span><span />
              </div>
              {rowsByGroup[g].map((r, i) => {
                const on = followNames.has(r.team_name);
                const adv = standingsBlock?.knockout_seeded && r.group_rank != null && r.group_rank <= 2;
                return (
                  <div key={r.team_id} style={{ display: "grid", gridTemplateColumns: "22px 1fr 24px 24px 30px 28px 24px", alignItems: "center", padding: "9px 12px", fontSize: 12.5,
                    borderBottom: i < rowsByGroup[g].length - 1 ? "1px solid var(--hair)" : "none", background: on ? "var(--amber-soft)" : "transparent" }}>
                    <span style={{ fontWeight: 700, color: adv ? "var(--ok-ink)" : "var(--ink4)" }}>{i + 1}</span>
                    <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? "var(--amber)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.team_name}</span>
                    <span style={{ textAlign: "center", color: "var(--ink3)" }}>{r.played}</span>
                    <span style={{ textAlign: "center", color: "var(--ink2)" }}>{r.won}</span>
                    <span style={{ textAlign: "center", color: r.gd > 0 ? "var(--ok-ink)" : r.gd < 0 ? "var(--live-ink)" : "var(--ink3)" }}>{r.gd > 0 ? "+" : ""}{r.gd}</span>
                    <span style={{ textAlign: "center", fontWeight: 800, color: "var(--ink)" }}>{r.pts}</span>
                    <button onClick={() => toggleFollow(r.team_name)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", justifyContent: "center" }} aria-label={on ? "Unfollow" : "Follow"}>
                      <MIcon name="star" size={15} color={on ? "var(--amber)" : "var(--ink4)"} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          {standingsBlock?.knockout_seeded && (
            <div style={{ fontSize: 11, color: "var(--ink4)", margin: "2px 2px 0", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--ok)", flex: "none" }} />Top two advance to the knockout
            </div>
          )}
        </>
      )}

      {/* fixtures */}
      {compFixtures.length > 0 && (
        <>
          <Eyebrow>Fixtures</Eyebrow>
          {groupFixtures(compFixtures).map((grp, gi) => (
            <div key={grp.label + gi}>
              {grp.label && <div className="m-eyebrow" style={{ margin: "6px 2px 8px", color: "var(--ink4)" }}>{grp.label}</div>}
              {grp.items.map((fx) => <FixtureRow key={fx.fixture_id} fx={fx} follow={followNames} />)}
            </div>
          ))}
        </>
      )}

      {/* knockout */}
      {compKnockout.length > 0 && (
        <>
          <Eyebrow>Knockout</Eyebrow>
          {compKnockout.map((fx) => <FixtureRow key={"k" + fx.fixture_id} fx={fx} follow={followNames} />)}
        </>
      )}

      {/* public link */}
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", marginTop: 18 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--info-soft)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <MIcon name="globe" size={18} color="var(--info-ink)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 600 }}>PUBLIC RESULTS PAGE</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{`in-or-out.com/tournament/${slug}`}</div>
        </div>
        <button className="m-icon-btn" style={{ width: 34, height: 34 }} aria-label="Copy link"
          onClick={() => {
            const url = `${window.location.origin}/tournament/${slug}`;
            try { navigator.clipboard?.writeText(url); } catch { /* noop */ }
            toast?.({ icon: "check", text: "Link copied", sub: "Live results · no login needed" });
          }}>
          <MIcon name="qr" size={17} />
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "9px 2px 4px", lineHeight: 1.4 }}>
        Referees update scores pitch-side — tables and brackets recalculate. {isLive ? "Live · refreshing every 30s." : ""}
      </div>

      {/* report / moderation affordance (Apple 1.2) */}
      {!reportSent ? (
        !reportOpen ? (
          <button type="button" onClick={() => setReportOpen(true)}
            style={{ background: "none", border: "none", padding: "6px 2px", cursor: "pointer",
              fontSize: 11.5, color: "var(--ink4)", textDecoration: "underline" }}>
            Report this tournament
          </button>
        ) : (
          <div className="m-card" style={{ padding: "12px 14px", marginTop: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>Why are you reporting this?</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {[
                ["offensive", "Offensive"],
                ["inappropriate", "Inappropriate"],
                ["spam", "Spam"],
                ["impersonation", "Impersonation"],
                ["other", "Other"],
              ].map(([code, label]) => (
                <button key={code} type="button" onClick={() => sendReport(code)}
                  style={{ background: "var(--amber-soft)", border: "none", borderRadius: 999,
                    padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setReportOpen(false)}
              style={{ background: "none", border: "none", padding: "8px 2px 0", cursor: "pointer", fontSize: 11.5, color: "var(--ink4)" }}>
              Never mind
            </button>
          </div>
        )
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "6px 2px", lineHeight: 1.4 }}>
          Thanks — you've reported this tournament. Our team will review it.
        </div>
      )}
    </div>
  );
}
