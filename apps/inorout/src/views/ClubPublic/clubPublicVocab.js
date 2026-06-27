// clubPublicVocab — discipline-aware wording for the PUBLIC club page (/c/<slug>).
//
// Modular Platform Epic B, Phase 4. The member-app vocabulary lives in
// apps/inorout/src/lib/disciplineLabels.js (member-facing tabs/CTAs). This file is
// the PUBLIC-page counterpart proposed in CLUB_PAGE_VOCAB_PROPOSAL.md and locked in
// the build handover §9 vocabulary map. Kept SEPARATE from disciplineLabels.js on
// purpose: the casual member surfaces must stay byte-identical (CLAUDE.md "casual
// flow is sacred"), so the public-page wording never touches that file.
//
// PURE COPY — no data, no DB. A club declares clubs.discipline; this turns it into
// the words the public homepage shows: the participant noun, the standings block
// label, the join CTA, the headline-stat label, and the next/live banner verb.
//
// football is the DEFAULT and renders the exact grassroots wording from the
// Football Baller design. Unknown / null disciplines fall through to DEFAULT_VOCAB.

export const DEFAULT_VOCAB = {
  participant: "Players",      // the people noun
  standings:   "League Table", // the standings/ranking block
  joinCta:     "Play for us",  // the join / get-involved CTA verb
  metric:      "Top scorer",   // headline stat label
  nextLabel:   "Next match",   // hero pre-match banner
  scheduleTab: "Fixtures",     // schedule block label
};

export const PUBLIC_VOCAB_MAPS = {
  football: { ...DEFAULT_VOCAB },
  boxing: {
    participant: "Fighters",
    standings:   "Fight record",
    joinCta:     "First session free",
    metric:      "Most rounds",
    nextLabel:   "Next class",
    scheduleTab: "Timetable",
  },
  gym: {
    participant: "Members",
    standings:   "Leaderboard",
    joinCta:     "First class free",
    metric:      "Most sessions",
    nextLabel:   "Next session",
    scheduleTab: "Timetable",
  },
  martial_arts: {
    participant: "Students",
    standings:   "Grading & belts",
    joinCta:     "Free trial class",
    metric:      "Most sessions",
    nextLabel:   "Next class",
    scheduleTab: "Timetable",
  },
  fitness: {
    participant: "Members",
    standings:   "Leaderboard",
    joinCta:     "First class free",
    metric:      "Most sessions",
    nextLabel:   "Next session",
    scheduleTab: "Timetable",
  },
  yoga: {
    participant: "Members",
    standings:   "Leaderboard",
    joinCta:     "Free trial class",
    metric:      "Most sessions",
    nextLabel:   "Next class",
    scheduleTab: "Timetable",
  },
  dance: {
    participant: "Members",
    standings:   "Leaderboard",
    joinCta:     "Free trial class",
    metric:      "Most sessions",
    nextLabel:   "Next class",
    scheduleTab: "Timetable",
  },
  other: { ...DEFAULT_VOCAB },
};

// Resolve a discipline string to its public-page wording, falling back to
// DEFAULT_VOCAB for null/unknown values so callers read fields without guarding.
export function getPublicVocab(discipline) {
  return PUBLIC_VOCAB_MAPS[discipline] || DEFAULT_VOCAB;
}
