import React, { useCallback, useEffect, useRef, useState } from "react";
import { clubListCohorts, clubListTeams, clubArchiveTeam } from "@platform/core/storage/supabase.js";
import { useToast } from "../shell/toast.jsx";
import CohortModal from "./structure/CohortModal.jsx";
import TeamModal from "./structure/TeamModal.jsx";
import TeamInviteModal from "./structure/TeamInviteModal.jsx";
import SeasonRolloverModal from "./structure/SeasonRolloverModal.jsx";

// Structure — the club's cohort → team org chart, with create/edit/archive and
// team join invites. All venue-token writes (venue_id credential; server gates
// on manage_memberships). Each write re-fetches (optimistic enough for a
// structure screen) and toasts.
export default function Structure({ venueId, clubId }) {
  const t = useToast();
  const [state, setState] = useState({ loading: true, error: false, cohorts: [], teams: [] });
  const [cohortModal, setCohortModal] = useState(null);   // {cohort} | {} (new)
  const [teamModal, setTeamModal] = useState(null);       // {team} | {presetCohortId}
  const [inviteTeam, setInviteTeam] = useState(null);
  const [rollover, setRollover] = useState(false);
  const [archiving, setArchiving] = useState({});
  const archivingRef = useRef(new Set());   // synchronous double-fire guard

  const load = useCallback(async () => {
    if (!venueId || !clubId) { setState({ loading: false, error: false, cohorts: [], teams: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [cohorts, teams] = await Promise.all([
        clubListCohorts(venueId, clubId, true),
        clubListTeams(venueId, clubId, false),
      ]);
      setState({
        loading: false, error: false,
        cohorts: Array.isArray(cohorts) ? cohorts : [],
        teams: Array.isArray(teams) ? teams : [],
      });
    } catch (err) {
      console.error("[clubmanager] structure load failed", err);
      setState({ loading: false, error: true, cohorts: [], teams: [] });
    }
  }, [venueId, clubId]);

  useEffect(() => { load(); }, [load]);

  const archiveTeam = async (team) => {
    if (archivingRef.current.has(team.team_id)) return;   // sync guard (state lags a render)
    archivingRef.current.add(team.team_id);
    setArchiving((a) => ({ ...a, [team.team_id]: true }));
    try {
      await clubArchiveTeam(venueId, team.team_id);
      t.show(`${team.name} archived.`);
      await load();
    } catch (err) {
      console.error("[clubmanager] archive team failed", err);
      t.show("Couldn't archive the team.", "error");
    } finally {
      archivingRef.current.delete(team.team_id);
      setArchiving((a) => ({ ...a, [team.team_id]: false }));
    }
  };

  const { loading, error, cohorts, teams } = state;
  const teamsByCohort = (cid) => teams.filter((tm) => tm.cohort_id === cid);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Structure</h2>
          <p className="sub">Cohorts, teams and join invites.</p>
        </div>
        <div className="page-actions">
          <button className="small" onClick={() => setRollover(true)} disabled={cohorts.length === 0}>Season rollover</button>
          <button className="small" onClick={() => setCohortModal({})}>+ Cohort</button>
          <button className="primary" onClick={() => setTeamModal({})} disabled={cohorts.length === 0}>+ Team</button>
        </div>
      </div>

      {loading && <div className="tile"><div className="state">Loading structure…</div></div>}
      {error && (
        <div className="tile">
          <div className="state err">Couldn't load the club structure.</div>
          <button className="retry" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && cohorts.length === 0 && (
        <div className="tile">
          <div className="state">No cohorts yet. Add your first age group to start building teams.</div>
        </div>
      )}

      {!loading && !error && cohorts.map((c) => {
        const cts = teamsByCohort(c.cohort_id);
        return (
          <div key={c.cohort_id} className="cohort-card">
            <div className="cohort-head">
              <div>
                <span className="cohort-name">{c.name}</span>
                {c.category && <span className="chip">{c.category}</span>}
                {(c.min_age != null || c.max_age != null) && (
                  <span className="chip">{c.min_age ?? "?"}–{c.max_age ?? "?"} yrs</span>
                )}
                {!c.active && <span className="chip chip--muted">archived</span>}
              </div>
              <div className="cohort-ctl">
                <button className="small" onClick={() => setTeamModal({ presetCohortId: c.cohort_id })}>+ Team</button>
                <button className="small" onClick={() => setCohortModal({ cohort: c })}>Edit</button>
              </div>
            </div>
            {cts.length === 0 ? (
              <div className="muted" style={{ padding: "8px 2px", fontSize: 13 }}>No teams in this cohort yet.</div>
            ) : (
              <table className="atable">
                <thead>
                  <tr><th>Team</th><th>Gender</th><th className="num">Players</th><th className="num">Actions</th></tr>
                </thead>
                <tbody>
                  {cts.map((tm) => (
                    <tr key={tm.team_id}>
                      <td>{tm.name}</td>
                      <td style={{ color: "var(--t2)" }}>{tm.gender || "—"}</td>
                      <td className="num">{tm.member_count ?? 0}</td>
                      <td className="num">
                        <button className="small" onClick={() => setInviteTeam(tm)}>Invite</button>{" "}
                        <button className="small" onClick={() => setTeamModal({ team: tm })}>Edit</button>{" "}
                        <button className="small" onClick={() => archiveTeam(tm)} disabled={archiving[tm.team_id]}>
                          {archiving[tm.team_id] ? "…" : "Archive"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {cohortModal && (
        <CohortModal
          venueId={venueId} clubId={clubId} cohort={cohortModal.cohort}
          onClose={() => setCohortModal(null)} onSaved={load}
        />
      )}
      {teamModal && (
        <TeamModal
          venueId={venueId} clubId={clubId} cohorts={cohorts}
          team={teamModal.team} presetCohortId={teamModal.presetCohortId}
          onClose={() => setTeamModal(null)} onSaved={load}
        />
      )}
      {inviteTeam && (
        <TeamInviteModal venueId={venueId} team={inviteTeam} onClose={() => setInviteTeam(null)} />
      )}
      {rollover && (
        <SeasonRolloverModal
          venueId={venueId} cohorts={cohorts} teams={teams}
          onClose={() => setRollover(false)} onDone={load}
        />
      )}
    </>
  );
}
