import React, { useEffect, useState } from "react";
import ClubNavBar from "../components/ui/ClubNavBar.jsx";
import ClassesTimetable from "./ClassesTimetable.jsx";
import { memberGetSelf } from "@platform/core/storage/supabase.js";
import { getDisciplineLabels } from "../lib/disciplineLabels.js";

// ClassesScreen — member-facing club Classes timetable (Gym/Boxing vertical, Phase 1,
// mig 356). The /classes route for the selected club: reuses ClassesTimetable (the same
// component the public venue landing uses) for the club's venue, so booking In/Out on a
// sparring night or a class reuses the class-session model wholesale.
//
// Auth-gated by App.jsx before mount. Zero-footprint when the member has no profile or no
// active club memberships. Club selection mirrors SessionsScreen: ?club=<id> deep-link →
// single-club auto-select → multi-club picker. Where a club spans more than one venue, a
// venue picker appears (the s144 sports-centre model — a club has one discipline but can
// run at several venues).

export default function ClassesScreen({ authUser, memberProfile: memberProfileProp }) {
  const [memberProfile, setMemberProfile] = useState(memberProfileProp ?? undefined);
  const [loading, setLoading] = useState(!memberProfileProp);
  const [selectedClubId, setSelectedClubId] = useState(null);
  const [selectedVenueId, setSelectedVenueId] = useState(null);

  // Honour a ?club=<id> deep-link (from the bottom nav / switcher) so multi-club members
  // land on the club they chose, not always the first. Falls back to single-club select.
  const pickClub = (clubs) => {
    const urlClub = (typeof window !== "undefined")
      ? new URLSearchParams(window.location.search).get("club") : null;
    if (urlClub && clubs.some((c) => c.club_id === urlClub)) return urlClub;
    if (clubs.length === 1) return clubs[0].club_id;
    return null;
  };

  useEffect(() => {
    if (memberProfileProp) {
      const sel = pickClub(memberProfileProp.active_clubs ?? []);
      if (sel) setSelectedClubId(sel);
      return;
    }
    let alive = true;
    memberGetSelf()
      .then((profile) => {
        if (!alive) return;
        const p = profile?.found ? profile : null;
        setMemberProfile(p);
        if (p) {
          const sel = pickClub(p.active_clubs ?? []);
          if (sel) setSelectedClubId(sel);
        }
      })
      .catch((e) => { console.error("[classes] profile load failed", e); if (alive) setMemberProfile(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeClubs = memberProfile?.active_clubs ?? [];
  const selectedClub = activeClubs.find((c) => c.club_id === selectedClubId) ?? null;
  const venues = selectedClub?.venues ?? [];

  // Default the venue when a club resolves (or its venue list changes).
  useEffect(() => {
    if (venues.length > 0) {
      setSelectedVenueId((cur) => (cur && venues.some((v) => v.venue_id === cur)) ? cur : venues[0].venue_id);
    } else {
      setSelectedVenueId(null);
    }
  }, [selectedClubId, venues.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Route is auth-gated, so the member is already signed in — requireAuth just runs the action.
  const requireAuth = (cb) => cb();

  // ── Zero-footprint gates ────────────────────────────────────────────────────
  if (loading) return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
        <p style={{ color: "var(--t2)", fontFamily: "var(--font-body)" }}>Loading…</p>
      </div>
    </div>
  );
  if (!memberProfile || activeClubs.length === 0) return null;

  const labels = getDisciplineLabels(selectedClub?.discipline);

  return (
    <div style={wrap}>
      {/* Header */}
      <div style={{ background: "var(--b2)", borderBottom: "1px solid var(--border-subtle)", padding: "20px 20px 16px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1 }}>
          {labels.classesTab}
        </div>

        {/* Club picker — only when the member has more than one club */}
        {activeClubs.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {activeClubs.map((club) => {
              const active = club.club_id === selectedClubId;
              return (
                <button
                  key={`${club.club_id}:${club.cohort_id}`}
                  onClick={() => setSelectedClubId(club.club_id)}
                  style={{
                    padding: "6px 14px", borderRadius: 20,
                    border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                    background: active ? "var(--amber)" : "transparent",
                    color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                    fontSize: 13, fontFamily: "var(--font-body)", cursor: "pointer", fontWeight: active ? 700 : 400,
                  }}
                >
                  {club.club_name}{club.cohort_name ? ` · ${club.cohort_name}` : ""}
                </button>
              );
            })}
          </div>
        )}

        {/* Venue picker — only when the selected club runs at more than one venue */}
        {venues.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {venues.map((v) => {
              const active = v.venue_id === selectedVenueId;
              return (
                <button
                  key={v.venue_id}
                  onClick={() => setSelectedVenueId(v.venue_id)}
                  style={{
                    padding: "5px 12px", borderRadius: 20,
                    border: `1px solid ${active ? "var(--t1)" : "var(--border)"}`,
                    background: active ? "rgba(255,255,255,0.08)" : "transparent",
                    color: active ? "var(--t1)" : "var(--t2)",
                    fontSize: 12, fontFamily: "var(--font-body)", cursor: "pointer", fontWeight: active ? 700 : 400,
                  }}
                >
                  {v.venue_name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Timetable — reused ClassesTimetable, zero-footprint when the venue has no classes.
          Distinguish the no-club-selected state (multi-club member, no ?club= param — the
          chips above are the selector) from a selected club that genuinely has no venue. */}
      <div style={{ flex: 1, padding: "0 20px 20px" }}>
        {!selectedClubId
          ? <p style={{ color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 24 }}>Select a club above to see its class timetable.</p>
          : selectedVenueId
            ? <ClassesTimetable key={selectedVenueId} venueId={selectedVenueId} requireAuth={requireAuth} />
            : <p style={{ color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 24 }}>No venue linked to this club yet.</p>}
      </div>

      <ClubNavBar active="classes" passToken={selectedClub?.pass_token ?? null} clubEntry={selectedClub} />
    </div>
  );
}

const wrap = {
  minHeight: "100dvh",
  background: "var(--bg)",
  color: "var(--t1)",
  fontFamily: "var(--font-body)",
  display: "flex",
  flexDirection: "column",
  // room for the fixed ClubNavBar (multi-context nav, Phase 1)
  paddingBottom: "calc(80px + env(safe-area-inset-bottom,0))",
};
