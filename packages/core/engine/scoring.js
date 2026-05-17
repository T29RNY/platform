export function hasGoalData(scoreType) {
  return !scoreType || scoreType === 'exact';
}

export function resolveDominantType(matches, opts = {}) {
  if (!matches || matches.length === 0) return 'exact';

  const { window = 20, threshold = 0.7 } = opts;

  const scored = matches
    .filter(m => m.cancelled !== true && m.score_a != null);

  if (scored.length === 0) return 'exact';

  const sorted = [...scored].sort((a, b) =>
    (b.match_date || '') < (a.match_date || '') ? -1 :
    (b.match_date || '') > (a.match_date || '') ?  1 : 0
  );

  const recent = sorted.slice(0, window);
  const counts = {};
  for (const m of recent) {
    const key = m.score_type || 'exact';
    counts[key] = (counts[key] || 0) + 1;
  }

  const total = recent.length;
  for (const [type, count] of Object.entries(counts)) {
    if (count / total >= threshold) return type;
  }

  return 'exact';
}
