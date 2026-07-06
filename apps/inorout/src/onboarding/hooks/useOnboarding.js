import { useState, useRef } from "react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";
import { createTeam, joinGetLeagueByCode, joinRegisterTeam } from "@platform/core/storage/supabase.js";


export function useOnboarding({ onComplete, authUser }) {
  const loadingStartRef = useRef(null);
  const [step,        setStep]        = useState(1); // 1 = create, 2 = ready (dead path)
  const [vertical,    setVertical]    = useState(null); // subStep-0 chooser: null = chooser, else the picked vertical key
  const [subStep,     setSubStep]     = useState(1); // 1–7 within the create wizard
  const [furthestStep, setFurthestStep] = useState(1);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  // Step 1 state
  const [groupName,       setGroupName]       = useState("");
  const [dayOfWeek,       setDayOfWeek]       = useState(CFG.defaults.dayOfWeek);
  const [kickoff,         setKickoff]         = useState(CFG.defaults.kickoff);
  const [venue,           setVenue]           = useState(CFG.defaults.venue);
  const [city,            setCity]            = useState('');
  const [squadSize,       setSquadSize]       = useState(CFG.defaults.squadSize);
  const [pricePerPlayer,  setPricePerPlayer]  = useState(CFG.defaults.pricePerPlayer);
  const [bibsEnabled,     setBibsEnabled]     = useState(true);
  const [adminEmail,      setAdminEmail]      = useState(authUser?.email || '');

  // Competitive-only: join a league by code (subStep 7 of the competitive path).
  // Backed by the existing anon+auth read RPC join_get_league_by_code and the
  // authenticated write join_register_team — no new backend. Optional: a user can
  // create a competitive team without joining a league yet.
  const [leagueCode,            setLeagueCodeRaw]         = useState('');
  const [resolvedLeague,        setResolvedLeague]        = useState(null);   // { league, venue, competitions_open }
  const [selectedCompetitionId, setSelectedCompetitionId] = useState(null);
  const [leagueStatus,          setLeagueStatus]          = useState('idle'); // idle | loading | found | notfound | error

  // Editing the code after a lookup invalidates the resolved result — reset so a
  // stale league/competition can never be carried into Review or the register call.
  const setLeagueCode = (v) => {
    setLeagueCodeRaw(v);
    if (leagueStatus !== 'idle') {
      setResolvedLeague(null);
      setSelectedCompetitionId(null);
      setLeagueStatus('idle');
    }
  };

  // Look up a league by its code and surface its open competitions to pick from.
  const lookupLeague = async () => {
    const code = leagueCode.trim();
    if (!code) return;
    setLeagueStatus('loading');
    setResolvedLeague(null);
    setSelectedCompetitionId(null);
    try {
      const r = await joinGetLeagueByCode(code);
      if (!r || !r.league) { setLeagueStatus('notfound'); return; }
      setResolvedLeague(r);
      const opens = r.competitions_open ?? [];
      if (opens.length === 1) setSelectedCompetitionId(opens[0].id); // auto-select the only option
      setLeagueStatus('found');
    } catch (e) {
      console.error('lookupLeague failed', e);
      setLeagueStatus(/not_found|not found/i.test(e?.message || '') ? 'notfound' : 'error');
    }
  };

  // Step 2 state — populated after creation
  const [teamId,      setTeamId]      = useState(null);
  const [adminToken,  setAdminToken]  = useState(null);
  const [players,     setPlayers]     = useState([]);
  const [joinCode,         setJoinCode]         = useState(null);
  const [adminPlayerToken, setAdminPlayerToken] = useState(null);

  // ── Submit → create everything via RPC ───────────────────────────────────
  const submitTeam = async () => {
    loadingStartRef.current = Date.now();
    setLoading(true); setError(null);

    try {
      const data = await createTeam({
        adminEmail:    adminEmail || null,
        teamName:      groupName.trim(),
        teamType:      vertical === 'competitive' ? 'competitive' : 'casual',
        dayOfWeek,
        kickoff,
        squadSize,
        venue:         venue || null,
        city:          city || null,
        price:         pricePerPlayer || 0,
        bibsEnabled:   bibsEnabled ?? true,
        playerNames:   [],
      });

      setTeamId(data.team_id);
      setAdminToken(data.admin_token);
      setPlayers(data.players ?? []);
      setJoinCode(data.join_code ?? null);
      setAdminPlayerToken(data.admin_player_token ?? null);

      // Competitive path: if a league competition was picked, register the freshly
      // created team into it (status='pending', awaiting venue approval). Best-effort
      // — the team already exists; a failed register can be retried from Admin later,
      // so we never block the redirect on it.
      if (vertical === 'competitive' && selectedCompetitionId) {
        try {
          await joinRegisterTeam(leagueCode.trim(), selectedCompetitionId, {
            existing_team_id: data.team_id,
            admin_email:      adminEmail || undefined,
          });
        } catch (e) {
          console.error('joinRegisterTeam failed', e);
        }
      }

      const elapsed = Date.now() - loadingStartRef.current;
      const MIN_DISPLAY = 10000;
      const remaining = Math.max(0, MIN_DISPLAY - elapsed);
      if (remaining > 0) {
        await new Promise(r => setTimeout(r, remaining));
      }

      // CRITICAL — iOS PWA install requires the URL to be /admin/<token> at
      // HTML parse time so the inline manifest script in index.html injects
      // the personalised manifest. Cannot install from /create because the
      // inline script runs before adminToken exists. Stash the SquadReady
      // props in sessionStorage and hard-redirect to /admin/<token>; AdminView
      // detects ?just_created=1 and renders SquadReady as a first-time overlay.
      try {
        sessionStorage.setItem('ioo_just_created', JSON.stringify({
          groupName: groupName.trim(),
          joinCode: data.join_code ?? null,
          adminPlayerToken: data.admin_player_token ?? null,
          ts: Date.now(),
        }));
      } catch (e) {}
      window.location.replace(`/admin/${data.admin_token}?just_created=1`);
      return;
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const goNext = () => {
    const next = subStep + 1;
    setSubStep(next);
    setFurthestStep(s => Math.max(s, next));
  };

  const goBack = () => setSubStep(s => Math.max(1, s - 1));

  const goToSubStep = (n) => setSubStep(n);

  // subStep-0 chooser → picks a vertical and drops into that vertical's wizard.
  // PR1: only 'casual' is live (routes into the existing create flow, subStep stays
  // at 1). Other verticals render their own "coming soon" hand-off in the chooser and
  // never call this. PR2 makes 'competitive' live here.
  const pickVertical = (v) => { setVertical(v); setSubStep(1); };

  return {
    // State
    step, loading, error,
    // Vertical chooser (subStep 0)
    vertical, pickVertical,
    // Wizard navigation
    subStep, furthestStep, goNext, goBack, goToSubStep,
    // Step 1
    groupName, setGroupName,
    dayOfWeek, setDayOfWeek,
    kickoff,   setKickoff,
    venue,     setVenue,
    city,      setCity,
    squadSize, setSquadSize,
    pricePerPlayer, setPricePerPlayer,
    bibsEnabled, setBibsEnabled,
    adminEmail, setAdminEmail,
    // Competitive: join a league by code
    leagueCode, setLeagueCode,
    resolvedLeague, selectedCompetitionId, setSelectedCompetitionId,
    leagueStatus, lookupLeague,
    submitTeam,
    // Step 2
    teamId, adminToken, players, joinCode, adminPlayerToken,
    onComplete,
  };
}
