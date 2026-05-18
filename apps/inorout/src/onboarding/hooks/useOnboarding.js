import { useState } from "react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";
import { supabase } from "@platform/supabase";


export function useOnboarding({ onComplete }) {
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
  const [adminEmail,      setAdminEmail]      = useState('');

  // Step 2 state
  const [playerNames, setPlayerNames] = useState([""]);
  const [newName,     setNewName]     = useState("");

  // Step 3 state — populated after creation
  const [teamId,      setTeamId]      = useState(null);
  const [adminToken,  setAdminToken]  = useState(null);
  const [players,     setPlayers]     = useState([]);

  // ── Step 1 → validate and advance to player-add step ─────────────────────
  const submitTeam = () => {
    if (!groupName.trim()) { setError("Please enter a team name."); return; }
    setError(null);
    setStep(2);
  };

  // ── Step 2 → Add players ──────────────────────────────────────────────────
  const addPlayer = () => {
    if (!newName.trim()) return;
    setPlayerNames(prev => [...prev, newName.trim()]);
    setNewName("");
  };

  const removePlayer = (idx) => {
    setPlayerNames(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Step 2 → create everything via RPC ───────────────────────────────────
  const submitPlayers = async (skip = false) => {
    setLoading(true); setError(null);

    try {
      const namesToSend = skip ? [] : playerNames.filter(n => n.trim());

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
      setStep(3);
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
    playerNames, newName, setNewName, addPlayer, removePlayer,
    submitPlayers,
    // Step 3
    teamId, adminToken, players,
    onComplete,
  };
}
