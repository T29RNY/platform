import { useState } from "react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";
import { supabase } from "@platform/supabase";

function generateToken(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 18);
}

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

  // Step 2 state
  const [playerNames, setPlayerNames] = useState([""]);
  const [newName,     setNewName]     = useState("");

  // Step 3 state — populated after creation
  const [teamId,      setTeamId]      = useState(null);
  const [adminToken,  setAdminToken]  = useState(null);
  const [players,     setPlayers]     = useState([]);

  // ── Step 1 → Create team ───────────────────────────────────────────────────
  const submitTeam = async () => {
    if (!groupName.trim()) { setError("Please enter a team name."); return; }
    setLoading(true); setError(null);

    try {
      const tId    = "team_" + Math.random().toString(36).slice(2, 10);
      const aToken = generateToken("admin");
      const schId  = "sched_" + tId;
      const setId  = "sett_" + tId;

      // Create team
      const { error: teamErr } = await supabase.from("teams").insert({
        id: tId, name: groupName.trim(), admin_token: aToken,
        onboarding_complete: false,
      });
      if (teamErr) throw teamErr;

      // Create schedule linked to team
      const { error: schedErr } = await supabase.from("schedule").insert({
        id: schId, team_id: tId,
        day_of_week: dayOfWeek, kickoff, venue,
        opens_day: CFG.defaults.opensDay, opens_time: CFG.defaults.opensTime,
        priority_lead_mins: CFG.defaults.priorityLeadMins,
        price_per_player: pricePerPlayer,
        city: city,
        game_is_live: false, squad_size: squadSize,
        game_date_time: null, is_draft: true,
        is_cancelled: false, cancel_reason: "",
      });
      if (schedErr) throw schedErr;

      // Create settings linked to team
      const { error: settErr } = await supabase.from("settings").insert({
        id: setId, team_id: tId, group_name: groupName.trim(),
      });
      if (settErr) throw settErr;

      setTeamId(tId);
      setAdminToken(aToken);
      setStep(2);
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
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

  const submitPlayers = async (skip = false) => {
    setLoading(true); setError(null);

    try {
      const namesToAdd = skip ? [] : playerNames.filter(n => n.trim());
      const created = [];

      for (const name of namesToAdd) {
        const pid   = "p_" + Math.random().toString(36).slice(2, 10);
        const token = generateToken("p");

        const { error: pErr } = await supabase.from("players").insert({
          id: pid, name: name.trim(), type: "regular",
          disabled: false, priority: false, deputy: false,
          status: "none", paid: false, owes: 0,
          goals: 0, motm: 0, attended: 0, total: 0,
          bib_count: 0, team: null, w: 0, l: 0, d: 0,
          pay_count: 0, late_dropouts: 0, note: "", self_paid: false,
          token,
        });
        if (pErr) throw pErr;

        // Link to team
        await supabase.from("team_players").insert({ team_id: teamId, player_id: pid });

        created.push({ id: pid, name: name.trim(), token });
      }

      // Mark onboarding complete
      await supabase.from("teams").update({ onboarding_complete: true }).eq("id", teamId);

      setPlayers(created);
      setStep(3);
    } catch (e) {
      setError(e.message || "Something went wrong adding players.");
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
    submitTeam,
    // Step 2
    playerNames, newName, setNewName, addPlayer, removePlayer,
    submitPlayers,
    // Step 3
    teamId, adminToken, players,
    onComplete,
  };
}
