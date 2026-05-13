import { useState, useEffect } from "react";
import {
  getPlayerMatchStats, getWinRate, getCurrentRun, getReliabilityScore,
  getMostPlayedWith, getPlayerImpact, getNemesis, getBestPartnership, getPOTMVoteStats,
} from "@platform/supabase";

export default function useIOIntelligence({ playerId, teamId, gamesPlayed = 0, skip = false }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (skip || !playerId || !teamId) { setLoading(false); return; }

    async function fetchAll() {
      setLoading(true);
      try {
        const queries = [];
        const keys = [];

        if (gamesPlayed >= 1) {
          queries.push(getPlayerMatchStats(playerId, teamId)); keys.push("matchStats");
          queries.push(getReliabilityScore(playerId, teamId)); keys.push("reliability");
        }
        if (gamesPlayed >= 2) {
          queries.push(getWinRate(playerId, teamId)); keys.push("winRate");
        }
        if (gamesPlayed >= 3) {
          queries.push(getCurrentRun(playerId, teamId)); keys.push("currentRun");
        }
        if (gamesPlayed >= 6) {
          queries.push(getMostPlayedWith(playerId, teamId)); keys.push("mostPlayedWith");
        }
        if (gamesPlayed >= 7) {
          queries.push(getPlayerImpact(playerId, teamId)); keys.push("impact");
        }
        if (gamesPlayed >= 8) {
          queries.push(getNemesis(playerId, teamId));       keys.push("nemesis");
          queries.push(getBestPartnership(playerId, teamId)); keys.push("bestPartnership");
          queries.push(getPOTMVoteStats(playerId, teamId)); keys.push("potmVotes");
        }

        const results = await Promise.all(queries);
        const obj = {};
        results.forEach((r, i) => { obj[keys[i]] = r; });
        setStats(obj);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, [playerId, teamId, gamesPlayed, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stats, loading, error };
}
