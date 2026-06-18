// disciplineLabels — member-facing vocabulary per club discipline.
//
// Gym/Boxing vertical, Phase 0. A club declares a `discipline` (clubs.discipline,
// mig 355: football|gym|boxing|martial_arts|yoga|dance|fitness|other). This map
// turns that into the words the member app shows — tab labels, the booking CTA,
// the word for a rank/level. PURE COPY: no data, no DB. Reporting keys off the
// discipline column server-side; these labels are display dressing only, so they
// live in code where wording is a one-line edit, not a migration.
//
// Design notes (locked s144):
//   • football is the DEFAULT and must stay byte-identical to pre-vertical wording
//     so the casual football experience is untouched.
//   • Boxing has NO grading — its progression is a fight record (hasFightRecord),
//     realised in Phase 4. Belts/grades are a martial-arts thing (hasGrading).
//   • hasPT (Phase 3, mig 358) lights the member-app "Train" tab → /book, the PT /
//     1-on-1 appointment booking surface. PT disciplines = gym, boxing,
//     martial_arts, fitness. football is false so the casual nav is byte-identical.
//   • Unknown / 'other' disciplines fall through to DEFAULT_LABELS rather than
//     crashing, which is what keeps the fixed pick-list safely extensible.
//
// Shape:
//   { sessionsTab, classesTab, trainTab, bookCta, rankWord,
//     hasGrading, hasFightRecord, hasPT }

export const DEFAULT_LABELS = {
  sessionsTab: "Sessions",
  classesTab: "Classes",
  trainTab: "Train",
  bookCta: "Book",
  rankWord: null,
  hasGrading: false,
  hasFightRecord: false,
  hasPT: false,
};

export const LABEL_MAPS = {
  football: { ...DEFAULT_LABELS },
  gym: {
    ...DEFAULT_LABELS,
    rankWord: "Level",
    hasPT: true,
  },
  boxing: {
    ...DEFAULT_LABELS,
    hasFightRecord: true,
    hasPT: true,
  },
  martial_arts: {
    ...DEFAULT_LABELS,
    rankWord: "Grade",
    hasGrading: true,
    hasPT: true,
  },
  yoga: {
    ...DEFAULT_LABELS,
    rankWord: "Level",
  },
  dance: {
    ...DEFAULT_LABELS,
    rankWord: "Level",
  },
  fitness: {
    ...DEFAULT_LABELS,
    rankWord: "Level",
    hasPT: true,
  },
  other: { ...DEFAULT_LABELS },
};

// Resolve a discipline string to its label set, falling back to DEFAULT_LABELS
// for null/unknown values so callers can read fields without guarding.
export function getDisciplineLabels(discipline) {
  return LABEL_MAPS[discipline] || DEFAULT_LABELS;
}
