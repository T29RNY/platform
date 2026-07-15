# DF Sports — personalised demo roster (turnkey recipe)

Goal: stand DF Sports up **already populated** so when Danny (the owner) first logs
in, his academy is alive — kids auto-banded into age groups, parents linked, memberships
showing. This is the sales close ("we set your whole academy up in five minutes").

Powered by **`superadmin_import_club_roster`** (mig 581, DF Sports PR #4). The roster
below is **fictional** (all `@example.com`) — swap for a real roster only behind the
operator sign-off + DPIA gate (real minors' data).

> Everything here runs **after** mig 581 is applied (tier-3 sign-off). Nothing charges a
> card — DF's memberships are cash/bank-transfer (all Stripe fields NULL) until you sign
> Stripe-live. The import is safe to re-run: it upserts by natural key, never duplicates.

---

## The recipe (4 steps)

1. **Mint DF Sports** — `superadmin_create_club` (PR #1): name "DF Sports", owner email =
   Danny's email → a `self_serve` shell venue + club + a pending owner invite Danny claims
   on his first sign-in (lands him on the club-admin hat).
2. **Create the age-band cohorts** on the club — e.g. **Under 6s (4–6)**, **Under 8s (7–8)**,
   **Under 10s (9–10)**, **Under 12s (11–12)** (`min_age`/`max_age` set — this is what
   `_cohort_for_dob` reads to auto-place each child).
3. **Create one membership tier + price** — e.g. tier "Term Membership" (`audience='junior'`)
   with a **`standard`** `venue_tier_prices` row for the period you'll import
   (e.g. `season` @ £80 = `8000` pence). The importer reads the price from here — no
   fabricated amounts.
4. **Run the import** with the sample roster below (`period='season'`, `status='active'`).
   It creates each child (unclaimed, no consent set), links parents (siblings share one
   parent record), auto-places each child into the right cohort by DOB, and creates an
   active cash membership per child.

The import returns a summary you can read to Danny:
`"5 children created, 4 parents linked, 5 memberships, 5 auto-placed into age groups."`

---

## Sample roster (fictional — safe for a demo)

`rows` payload for `superadminImportClubRoster({ venueId, tierId, period: 'season', rows, status: 'active' })`.
DOBs are examples — set them so ages land in your cohort bands. Twins share a parent;
one child carries an allergy to show the medical surface; one shows an older sibling in a
higher band.

```json
[
  { "first_name": "Leo",  "last_name": "Bennett", "dob": "2019-05-14", "gender": "male",
    "guardians": [ { "first_name": "Claire", "last_name": "Bennett", "email": "claire.bennett@example.com", "phone": "07700900001", "relationship": "parent", "is_primary": true } ] },
  { "first_name": "Mia",  "last_name": "Bennett", "dob": "2021-02-03", "gender": "female",
    "guardians": [ { "first_name": "Claire", "last_name": "Bennett", "email": "claire.bennett@example.com", "relationship": "parent" } ] },
  { "first_name": "Sam",  "last_name": "Taylor",  "dob": "2016-09-22", "gender": "male", "allergies": "Peanuts",
    "guardians": [ { "first_name": "Dan", "last_name": "Taylor", "email": "dan.taylor@example.com", "phone": "07700900002", "relationship": "parent", "is_primary": true } ] },
  { "first_name": "Ava",  "last_name": "Okafor",  "dob": "2018-11-30", "gender": "female",
    "guardians": [ { "first_name": "Grace", "last_name": "Okafor", "email": "grace.okafor@example.com", "relationship": "parent", "is_primary": true } ] },
  { "first_name": "Noah", "last_name": "Okafor",  "dob": "2015-04-08", "gender": "male",
    "guardians": [ { "first_name": "Grace", "last_name": "Okafor", "email": "grace.okafor@example.com", "relationship": "parent" } ] }
]
```

- **Bennett** = twins-ish siblings (Leo + Mia) sharing one parent record (Claire).
- **Okafor** = two siblings (Ava younger, Noah older) → land in different age bands, one parent (Grace).
- **Sam Taylor** = carries an allergy, so Danny's coaches see the medical/allergy surface.

---

## Safety notes (why this is safe to demo now)

- **Fictional data** → no real minor PII, so the DPIA / real-roster sign-off gate is not
  tripped by the demo. Swapping in a real roster later **is** tier-3 and needs that sign-off.
- **No consent assumed** — every child is an unclaimed profile with all consent/safeguarding
  boxes at their safe default; parents set consent themselves later.
- **No money moves** — memberships are cash (all Stripe/GoCardless fields NULL); no card is
  charged until Stripe-live is signed.
- **Re-runnable** — fix a name or DOB and re-run the same roster; it updates existing rows
  by natural key rather than duplicating.

Related: `DF_SPORTS_ONBOARDING_HANDOFF.md` (the epic), `RPCS.md` (`superadmin_import_club_roster`).
