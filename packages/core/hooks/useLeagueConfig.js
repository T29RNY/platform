import { useEffect, useState } from "react";
import { getLeagueConfig } from "../storage/supabase.js";

// Hard-coded fallback. Mirrors the schema defaults in migration 050 so the
// UI never breaks if the RPC fails or the table is empty.
const FALLBACK = {
  id: null,
  league_id: null,
  sport: "football",
  format: "5-a-side",
  game_label: "Game",
  squad_label: "Squad",
  fixture_label: "Fixture",
  availability_label: "Availability",
  standings_label: "Standings",
  appearances_label: "Appearances",
  potg_label: "Player of the Game",
  match_duration_mins: 40,
  has_halves: false,
  half_duration_mins: null,
  has_sin_bin: false,
  sin_bin_mins: null,
  card_types: ["yellow", "red"],
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  tiebreaker_order: ["goal_difference", "goals_scored", "head_to_head", "playoff"],
  teamsheet_required: false,
};

function shapeReturn(row) {
  const r = row || FALLBACK;
  return {
    sport: r.sport,
    format: r.format,
    labels: {
      game: r.game_label,
      squad: r.squad_label,
      fixture: r.fixture_label,
      availability: r.availability_label,
      standings: r.standings_label,
      appearances: r.appearances_label,
      potg: r.potg_label,
    },
    config: {
      match_duration_mins: r.match_duration_mins,
      has_halves: r.has_halves,
      half_duration_mins: r.half_duration_mins,
      has_sin_bin: r.has_sin_bin,
      sin_bin_mins: r.sin_bin_mins,
      card_types: r.card_types,
      points_win: r.points_win,
      points_draw: r.points_draw,
      points_loss: r.points_loss,
      tiebreaker_order: r.tiebreaker_order,
      teamsheet_required: r.teamsheet_required,
    },
    raw: r,
  };
}

export function useLeagueConfig(leagueId = null) {
  const [state, setState] = useState(() => ({
    ...shapeReturn(null),
    loading: true,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await getLeagueConfig(leagueId);
        if (cancelled) return;
        setState({ ...shapeReturn(row), loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ ...shapeReturn(null), loading: false, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return state;
}
