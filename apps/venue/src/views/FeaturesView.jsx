import React, { useState, useEffect, useCallback } from "react";
import { venueGetFeatureSettings, venueSetVenueFeature, venueSetClubFeature,
         venueSetVenueFeatures, venueSetClubFeatures } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

// FeaturesView — Venue OS nav Phase 2 (A) + Phase 3 (presets): the operator's
// modular-feature control panel. Flips venue_features (facility) + club_features
// (org) on/off via the mig-400 per-flag RPCs, or applies a whole PACKAGE preset at
// once via the mig-402 bulk RPCs. Default-all-on: a feature is "on" until switched off.
//
// Two axes are deliberately separate (DECISIONS s179): this screen owns the
// PURCHASED axis (what's enabled) and shows every feature. The DISCIPLINE axis
// (relevance) only declutters the rail — so a feature toggled on here still won't
// appear in the rail if it's irrelevant to the club's sport (note shown below).
//
// Dependency graph (B) is enforced server-side; the UI reflects it: enabling
// Coaching auto-enables Memberships, and Memberships can't be switched off while
// Coaching is on (its toggle is locked with a reason rather than erroring).
//
// PACKAGES (Phase 3) are pure shortcuts — named flag-sets that live HERE in code
// (flags stay the source of truth; the commercial tier/pricing decision is deferred,
// DECISIONS s180). Editing a bundle or adding a preset is a one-line change, no migration.

const VENUE_FEATURES = [
  { key: "bookings",  label: "Bookings",  hint: "pitch & slot booking" },
  { key: "spaces",    label: "Spaces",    hint: "bookable rooms & areas" },
  { key: "room_hire", label: "Room hire", hint: "hireable rooms" },
  { key: "equipment", label: "Equipment", hint: "kit & equipment hire" },
];

const CLUB_FEATURES = [
  { key: "memberships",  label: "Memberships",     hint: "plans, fees & member management" },
  { key: "competition",  label: "Internal League", hint: "your own teams' league, seasons & standings" },
  { key: "club_leagues", label: "Club Leagues",    hint: "fixtures vs outside clubs + matchday links" },
  { key: "coaching",     label: "Coaching",        hint: "club sessions, classes & trainers" },
  { key: "tournaments",  label: "Tournaments",     hint: "Event OS cups & brackets" },
  { key: "public_web",   label: "Public web",      hint: "public club page" },
];

// Preset bundles. Descriptive (not commercial tiers) — easy to re-bundle/rename.
const VENUE_PACKAGES = [
  { key: "full",          label: "Full facility", flags: { bookings: true, spaces: true,  room_hire: true,  equipment: true } },
  { key: "bookings_only", label: "Bookings only", flags: { bookings: true, spaces: false, room_hire: false, equipment: false } },
];

const CLUB_PACKAGES = [
  { key: "full",     label: "Full club",              flags: { memberships: true,  competition: true,  club_leagues: true,  coaching: true,  tournaments: true,  public_web: true } },
  { key: "league",   label: "League club",            flags: { memberships: true,  competition: true,  club_leagues: true,  coaching: false, tournaments: false, public_web: false } },
  { key: "coaching", label: "Memberships & coaching", flags: { memberships: true,  competition: false, club_leagues: false, coaching: true,  tournaments: false, public_web: false } },
  { key: "matchday", label: "Match-day only",         flags: { memberships: false, competition: false, club_leagues: false, coaching: false, tournaments: false, public_web: false } },
];

// Which preset (if any) exactly matches the current effective flags — for highlighting.
function matchedPackage(state, features, packages) {
  return packages.find((p) =>
    features.every((f) => (state[f.key] !== false) === (p.flags[f.key] !== false))
  )?.key ?? null;
}

const DISCIPLINE_LABEL = {
  football: "Football", gym: "Gym", boxing: "Boxing", martial_arts: "Martial arts",
  yoga: "Yoga", dance: "Dance", fitness: "Fitness", other: "Other",
};

function humanErr(e) {
  const m = e?.message || "";
  if (m.includes("dependency_required")) return "Turn Coaching off first — it needs Memberships.";
  if (m.includes("insufficient_role")) return "You don’t have permission to change features.";
  if (m.includes("club_not_in_venue")) return "That club isn’t linked to this venue.";
  return "Couldn’t save that change — try again.";
}

// A single on/off row. `locked` renders it disabled with a reason (dependency).
function Toggle({ checked, busy, locked, lockReason, onChange, label, hint }) {
  const disabled = busy || !!locked;
  return (
    <label
      className="row-check"
      style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", cursor: disabled ? "default" : "pointer", opacity: locked ? 0.65 : 1 }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span className="text-mute" style={{ display: "block", fontSize: 13 }}>
          {locked ? lockReason : hint}
        </span>
      </span>
    </label>
  );
}

// A row of preset buttons. The preset matching the current state is highlighted.
function PackageRow({ packages, activeKey, busy, onApply }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 12px" }}>
      <span className="text-mute" style={{ fontSize: 12, alignSelf: "center", marginRight: 2 }}>Quick setup:</span>
      {packages.map((p) => (
        <button
          key={p.key}
          className={"btn btn-xs" + (activeKey === p.key ? " btn-accent" : "")}
          disabled={busy}
          aria-pressed={activeKey === p.key}
          onClick={() => onApply(p.flags)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export default function FeaturesView({ venueToken, features = null, onChanged }) {
  const [settings, setSettings] = useState(null);   // { venue:{...}, clubs:[...] }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);           // "venue:bookings" | "<clubId>:coaching"
  const [flash, setFlash] = useState(null);         // transient inline error

  const load = useCallback(async () => {
    setError(null);
    try {
      setSettings(await venueGetFeatureSettings(venueToken));
    } catch (e) {
      setError(humanErr(e));
    }
  }, [venueToken]);

  useEffect(() => { load(); }, [load]);

  // Optimistic-free: the server may auto-enable/lock other flags, so we re-read
  // the authoritative settings after every change (and refresh the rail flags).
  const setVenueFeature = async (feature, enabled) => {
    const id = `venue:${feature}`;
    setBusy(id); setFlash(null);
    try {
      await venueSetVenueFeature(venueToken, feature, enabled);
      await load();
      onChanged?.();
    } catch (e) {
      setFlash(humanErr(e));
    } finally {
      setBusy(null);
    }
  };

  const setClubFeature = async (clubId, feature, enabled) => {
    const id = `${clubId}:${feature}`;
    setBusy(id); setFlash(null);
    try {
      await venueSetClubFeature(venueToken, clubId, feature, enabled);
      await load();
      onChanged?.();
    } catch (e) {
      setFlash(humanErr(e));
    } finally {
      setBusy(null);
    }
  };

  // Phase 3 — apply a whole preset bundle in one atomic, audited call.
  const applyVenuePackage = async (flags) => {
    setBusy("venue:pkg"); setFlash(null);
    try {
      await venueSetVenueFeatures(venueToken, flags);
      await load();
      onChanged?.();
    } catch (e) {
      setFlash(humanErr(e));
    } finally {
      setBusy(null);
    }
  };

  const applyClubPackage = async (clubId, flags) => {
    setBusy(`${clubId}:pkg`); setFlash(null);
    try {
      await venueSetClubFeatures(venueToken, clubId, flags);
      await load();
      onChanged?.();
    } catch (e) {
      setFlash(humanErr(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <EmptyState title="Couldn’t load features" body={error} />;
  if (!settings) return <div className="text-mute" style={{ padding: 24 }}>Loading…</div>;

  const venue = settings.venue || {};
  const clubs = settings.clubs || [];

  return (
    <div style={{ maxWidth: 640 }}>
      <p className="text-mute" style={{ margin: "0 0 16px", fontSize: 13 }}>
        Switch features on or off for this venue, or use a Quick setup preset to apply
        a whole bundle at once. Everything is on by default — turn something off to hide
        it from the rail and block its actions. Some features only appear in the rail
        when they’re relevant to a club’s sport.
      </p>

      {flash && (
        <div className="banner banner-warn" style={{ marginBottom: 12 }}>{flash}</div>
      )}

      <section style={{ marginBottom: 28 }}>
        <SectionHead label="Facility features" />
        <p className="text-mute" style={{ margin: "2px 0 8px", fontSize: 12 }}>This venue</p>
        <PackageRow
          packages={VENUE_PACKAGES}
          activeKey={matchedPackage(venue, VENUE_FEATURES, VENUE_PACKAGES)}
          busy={busy === "venue:pkg"}
          onApply={applyVenuePackage}
        />
        {VENUE_FEATURES.map((f) => (
          <Toggle
            key={f.key}
            label={f.label}
            hint={f.hint}
            checked={venue[f.key] !== false}
            busy={busy === `venue:${f.key}`}
            onChange={(v) => setVenueFeature(f.key, v)}
          />
        ))}
      </section>

      {clubs.length === 0 ? (
        <EmptyState title="No clubs yet" body="Club features appear here once a club operates at this venue." />
      ) : (
        clubs.map((club) => {
          const coachingOn = club.coaching !== false;
          return (
            <section key={club.club_id} style={{ marginBottom: 28 }}>
              <SectionHead label={club.name} />
              <p className="text-mute" style={{ margin: "2px 0 8px", fontSize: 12 }}>
                {DISCIPLINE_LABEL[club.discipline] || "Club"}
              </p>
              <PackageRow
                packages={CLUB_PACKAGES}
                activeKey={matchedPackage(club, CLUB_FEATURES, CLUB_PACKAGES)}
                busy={busy === `${club.club_id}:pkg`}
                onApply={(flags) => applyClubPackage(club.club_id, flags)}
              />
              {CLUB_FEATURES.map((f) => {
                // Dependency reflection: lock Memberships off-switch while Coaching is on.
                const locked = f.key === "memberships" && coachingOn;
                return (
                  <Toggle
                    key={f.key}
                    label={f.label}
                    hint={f.hint}
                    checked={club[f.key] !== false}
                    busy={busy === `${club.club_id}:${f.key}`}
                    locked={locked}
                    lockReason="Required by Coaching — turn Coaching off first"
                    onChange={(v) => setClubFeature(club.club_id, f.key, v)}
                  />
                );
              })}
            </section>
          );
        })
      )}
    </div>
  );
}
