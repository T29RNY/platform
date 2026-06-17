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
//   • Unknown / 'other' disciplines fall through to DEFAULT_LABELS rather than
//     crashing, which is what keeps the fixed pick-list safely extensible.
//
// Shape:
//   { sessionsTab, classesTab, bookCta, rankWord, hasGrading, hasFightRecord }

export const DEFAULT_LABELS = {
  sessionsTab: "Sessions",
  classesTab: "Classes",
  bookCta: "Book",
  rankWord: null,
  hasGrading: false,
  hasFightRecord: false,
};

export const LABEL_MAPS = {
  football: { ...DEFAULT_LABELS },
  gym: {
    sessionsTab: "Sessions",
    classesTab: "Classes",
    bookCta: "Book",
    rankWord: "Level",
    hasGrading: false,
    hasFightRecord: false,
  },
  boxing: {
    sessionsTab: "Sessions",
    classesTab: "Classes",
    bookCta: "Book",
    rankWord: null,
    hasGrading: false,
    hasFightRecord: true,
  },
  martial_arts: {
    sessionsTab: "Sessions",
    classesTab: "Classes",
    bookCta: "Book",
    rankWord: "Grade",
    hasGrading: true,
    hasFightRecord: false,
  },
  yoga: {
    sessionsTab: "Sessions",
    classesTab: "Classes",
    bookCta: "Book",
    rankWord: "Level",
    hasGrading: false,
    hasFightRecord: false,
  },
  dance: {
    sessionsTab: "Sessions",
    classesTab: "Classes",
    bookCta: "Book",
    rankWord: "Level",
    hasGrading: false,
    hasFightRecord: false,
  },
  fitness: {
    sessionsTab: "Sessions",
    classesTab: "Classes",
    bookCta: "Book",
    rankWord: "Level",
    hasGrading: false,
    hasFightRecord: false,
  },
  other: { ...DEFAULT_LABELS },
};

// Resolve a discipline string to its label set, falling back to DEFAULT_LABELS
// for null/unknown values so callers can read fields without guarding.
export function getDisciplineLabels(discipline) {
  return LABEL_MAPS[discipline] || DEFAULT_LABELS;
}
