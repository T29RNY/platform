import { useState, useRef } from "react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";
import { createTeam } from "@platform/core/storage/supabase.js";


export function useOnboarding({ onComplete, authUser }) {
  const loadingStartRef = useRef(null);
  const [step,        setStep]        = useState(1); // 1 = create, 2 = ready (dead path)
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

  return {
    // State
    step, loading, error,
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
    submitTeam,
    // Step 2
    teamId, adminToken, players, joinCode, adminPlayerToken,
    onComplete,
  };
}
