import { useState } from "react";

export default function useIOIntelligence({
  stats,
  gamesPlayed = 0,
  skip = false,
}) {
  const s = (!skip && stats) ? stats : null;
  return {
    stats: s ? {
      matchStats:      s.matchStats      || null,
      reliability:     s.reliability     ?? null,
      winRate:         s.winRate         || null,
      currentRun:      s.currentRun      || null,
      mostPlayedWith:  null,
      impact:          null,
      nemesis:         null,
      bestPartnership: null,
      potmVotes:       null,
    } : null,
    loading: false,
    error:   null,
  };
}
