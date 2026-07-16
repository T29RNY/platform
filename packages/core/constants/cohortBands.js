// Cohort / class age-band contract — shared by apps/venue (desktop) and apps/inorout
// (phone). The two apps have entirely separate styling systems, so the component can't
// be shared; the CONTRACT can, and that's the half that must never drift.
//
// A cohort or class type is banded by SCHOOL YEAR or by AGE — never both. Mig 588's
// _cohort_for_dob / _class_age_eligibility make a school-year band win outright, so a row
// carrying both bands has a dead age half that still renders. Mig 589's RPCs reject that
// (band_conflict); these helpers are how each UI offers it as an either/or.
//
// School years use mig 588's numbering: Reception = 0, Year 1..13 = 1..13, and NEGATIVE =
// not yet at school. DF's pre-school "Tots" class is school_year_max = -1, which ejects a
// child exactly when they start Reception — something an age band cannot express.

export const GROUPING = { SCHOOL_YEAR: "school_year", AGE: "age" };

// -1 covers pre-school as a single option; finer negative bands aren't a real use case.
export const SCHOOL_YEAR_OPTIONS = [
  { value: -1, label: "Pre-school" },
  { value: 0, label: "Reception" },
  ...Array.from({ length: 13 }, (_, i) => ({ value: i + 1, label: `Year ${i + 1}` })),
];

export function schoolYearLabel(n) {
  if (n == null) return null;
  if (n < 0) return "Pre-school";
  if (n === 0) return "Reception";
  return `Year ${n}`;
}

export function schoolYearRangeLabel(min, max) {
  if (min == null && max == null) return null;
  // "up to pre-school" is DF's Tots shape — say what it means, not what it bounds.
  if (min == null && max != null && max < 0) return "Pre-school";
  if (min != null && max != null) {
    if (min === max) return schoolYearLabel(min);
    // "Years 2–6" reads better than "Year 2–Year 6" once both ends are numbered years.
    if (min >= 1) return `Years ${min}–${max}`;
    return `${schoolYearLabel(min)}–${schoolYearLabel(max)}`;
  }
  if (min != null) return `${schoolYearLabel(min)} and up`;
  return `Up to ${schoolYearLabel(max)}`;
}

export function ageRangeLabel(min, max) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `Ages ${min}–${max}`;
  if (min != null) return `Ages ${min}+`;
  return `Up to ${max}`;
}

// Which band a row actually carries. null = no band = "everyone", which mig 588 treats as
// "no check" rather than "nobody".
export function bandGrouping(row) {
  if (row?.school_year_min != null || row?.school_year_max != null) return GROUPING.SCHOOL_YEAR;
  if (row?.min_age != null || row?.max_age != null) return GROUPING.AGE;
  return null;
}

// The one human-readable band string. School year is checked first because that's the
// order the server resolves in — so the label can never claim a band the server ignores.
export function bandLabel(row, { emptyLabel = "All ages" } = {}) {
  return (
    schoolYearRangeLabel(row?.school_year_min, row?.school_year_max) ??
    ageRangeLabel(row?.min_age, row?.max_age) ??
    emptyLabel
  );
}

// Safeguarding: does this cohort contain children?
// Pre-589 this was `category === 'youth' || max_age < 18`, inlined at the two LIVE call
// sites (apps/venue SafeguardingBoard, apps/inorout ClubAdminSafeguarding), both now
// calling this instead. A year-banded cohort has NULL ages, so it failed the second
// clause and was only caught if the operator happened to set category=youth — i.e. the
// DBS warning silently skipped exactly the cohorts 588 introduced. Any school-year band
// is school-age by definition (Reception..Year 13 = ages 4..18), so it counts. Errs
// toward MORE safeguarding.
// ⚠️ apps/clubmanager/src/views/structure/Safeguarding.jsx:61 still carries the old
// inline filter. Deliberately NOT changed — that app is being retired (Club Console
// Consolidation #5) and is not deployed. If it is ever revived, it must switch to this
// helper or it will silently skip the DBS warning on year-banded cohorts.
export function isYouthCohort(c) {
  if (String(c?.category || "").toLowerCase() === "youth") return true;
  if (c?.max_age != null && Number(c.max_age) < 18) return true;
  if (c?.school_year_min != null || c?.school_year_max != null) return true;
  return false;
}

// Mig 589's band error codes, in plain English. The codes are part of the RPC contract,
// so their wording lives with it rather than being retyped per app. Returns null for
// anything else, so a caller can fall through to its own generic handling.
const BAND_ERRORS = {
  band_conflict:    "Pick either school years or ages — a group can't use both.",
  bad_year_band:    "The first school year must come before the last.",
  bad_age_band:     "The minimum age must be below the maximum.",
  invalid_grouping: "That grouping isn't recognised.",
  invalid_category: "Pick Youth, Adult or Mixed.",
  name_required:    "Give the group a name.",
};

export function bandError(e) {
  return BAND_ERRORS[e?.message || String(e || "")] || null;
}

// School-year cohorts roll up on their own: 588's _school_year_for_dob takes a reference
// date defaulting to today, so every child advances a year on 1 Sep with no data change.
// Season rollover must therefore SKIP them — bumping a year band would double-advance it.
export function rollsOverAutomatically(c) {
  return bandGrouping(c) === GROUPING.SCHOOL_YEAR;
}
