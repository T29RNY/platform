export default function useIOIntelligence({
  stats,
  gamesPlayed = 0,
  skip = false,
}) {
  const s = (!skip && stats) ? stats : null;
  return {
    stats: s ? {
      matchStats:         s.matchStats         || null,
      reliability:        s.reliability        ?? null,
      winRate:            s.winRate            || null,
      currentRun:         s.currentRun         || null,
      mostPlayedWith:     s.mostPlayedWith     || null,
      mostFacedOpponent:  s.mostFacedOpponent  || null,
      reliabilityRanking: s.reliabilityRanking || null,
      impact:             s.impact             || null,
      nemesis:            s.nemesis            || null,
      bestPartnership:    s.bestPartnership    || null,
      potmVotes:          s.potmVotes          || null,
    } : null,
    loading: false,
    error:   null,
  };
}
