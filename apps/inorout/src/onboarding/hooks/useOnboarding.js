import { useState, useRef } from "react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";
import { supabase } from "@platform/core/storage/supabase.js";


export function useOnboarding({ onComplete, authUser }) {
  const loadingStartRef = useRef(null);
  const [step,      setStep]      = useState(1); // 1, 2, 3
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

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
      const namesToSend = [];

      const { data, error } = await supabase.rpc('create_team', {
        p_admin_email:        adminEmail || null,
        p_team_name:          groupName.trim(),
        p_day_of_week:        dayOfWeek,
        p_kickoff:            kickoff,
        p_squad_size:         squadSize,
        p_venue:              venue || null,
        p_city:               city || null,
        p_price:              pricePerPlayer || 0,
        p_bibs_enabled:       bibsEnabled ?? true,
        p_player_names:       namesToSend,
        p_opens_day:          null,
        p_opens_time:         null,
        p_priority_lead_mins: null,
      });
      if (error) throw error;

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

      setStep(2);
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return {
    // State
    step, loading, error,
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
