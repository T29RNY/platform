import React, { useEffect, useRef, useState } from "react";
import ClubNavBar from "../components/ui/ClubNavBar.jsx";
import {
  memberGetSelf, memberListTrainers, memberListTrainerSlots,
  memberBookAppointment, memberCancelAppointment, memberListMyAppointments,
} from "@platform/core/storage/supabase.js";
import { getDisciplineLabels } from "../lib/disciplineLabels.js";

// BookPT — member-facing PT / 1-on-1 appointment booking (Gym/Boxing vertical,
// Phase 3, mig 358). The /book route for the selected club: lists the venue's
// active trainers, expands each to show bookable slots (availability minus booked),
// and books a slot via member_book_appointment (writes a venue_charges 'pt' row,
// door path). My upcoming appointments are listed up top with a cancel control.
//
// Auth-gated by App.jsx before mount. Zero-footprint when the member has no profile
// or no active clubs. Club/venue selection mirrors ClassesScreen exactly (a club
// has one discipline but can run at several venues — the s144 sports-centre model).

const TZ = "Europe/London";

function fmtMoney(pence) {
  if (!pence || pence <= 0) return "Free";
  return `£${(pence / 100).toFixed(2)}`;
}
function fmtDayKey(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

export default function BookPT({ authUser, memberProfile: memberProfileProp }) {
  const [memberProfile, setMemberProfile] = useState(memberProfileProp ?? undefined);
  const [loading, setLoading] = useState(!memberProfileProp);
  const [selectedClubId, setSelectedClubId] = useState(null);
  const [selectedVenueId, setSelectedVenueId] = useState(null);

  const [trainersData, setTrainersData] = useState(null); // { is_member, trainers }
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [slotsByTrainer, setSlotsByTrainer] = useState({});
  const [myAppts, setMyAppts] = useState([]);
  const [msg, setMsg] = useState(null);
  const busy = useRef(false);

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
      .catch((e) => { console.error("[pt] profile load failed", e); if (alive) setMemberProfile(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeClubs = memberProfile?.active_clubs ?? [];
  const selectedClub = activeClubs.find((c) => c.club_id === selectedClubId) ?? null;
  const venues = selectedClub?.venues ?? [];

  useEffect(() => {
    if (venues.length > 0) {
      setSelectedVenueId((cur) => (cur && venues.some((v) => v.venue_id === cur)) ? cur : venues[0].venue_id);
    } else {
      setSelectedVenueId(null);
    }
  }, [selectedClubId, venues.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load trainers + my appointments when the venue resolves/changes.
  const refreshVenue = (venueId) => {
    if (!venueId) { setTrainersData(null); setMyAppts([]); return; }
    setTrainersLoading(true);
    setExpandedId(null);
    setSlotsByTrainer({});
    Promise.all([memberListTrainers(venueId), memberListMyAppointments(venueId)])
      .then(([t, a]) => {
        setTrainersData(t ?? { is_member: false, trainers: [] });
        setMyAppts((a?.appointments ?? []).filter((ap) => ap.status === "confirmed"));
      })
      .catch((e) => { console.error("[pt] venue load failed", e); setTrainersData({ is_member: false, trainers: [] }); })
      .finally(() => setTrainersLoading(false));
  };
  useEffect(() => { refreshVenue(selectedVenueId); }, [selectedVenueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSlots = (trainerId) => {
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    setSlotsByTrainer((cur) => ({ ...cur, [trainerId]: cur[trainerId] ?? "loading" }));
    memberListTrainerSlots(trainerId, { from: today, to })
      .then((r) => setSlotsByTrainer((cur) => ({ ...cur, [trainerId]: r?.slots ?? [] })))
      .catch((e) => { console.error("[pt] slots load failed", e); setSlotsByTrainer((cur) => ({ ...cur, [trainerId]: [] })); });
  };

  const toggleTrainer = (trainerId) => {
    setMsg(null);
    if (expandedId === trainerId) { setExpandedId(null); return; }
    setExpandedId(trainerId);
    if (!slotsByTrainer[trainerId] || slotsByTrainer[trainerId] === "loading") loadSlots(trainerId);
  };

  const book = async (trainerId, startsAt) => {
    if (busy.current) return;
    busy.current = true;
    setMsg(null);
    try {
      const res = await memberBookAppointment(trainerId, startsAt);
      if (res?.ok) {
        setMsg({ kind: "ok", text: "Booked — see you there." });
        loadSlots(trainerId);
        memberListMyAppointments(selectedVenueId).then((a) =>
          setMyAppts((a?.appointments ?? []).filter((ap) => ap.status === "confirmed")));
      } else {
        const reason = res?.reason === "slot_taken" ? "That slot was just taken."
          : res?.reason === "suspended" ? "Booking suspended after repeated no-shows. Speak to the club."
          : "Couldn't book that slot.";
        setMsg({ kind: "err", text: reason });
        if (res?.reason === "slot_taken") loadSlots(trainerId);
      }
    } catch (e) {
      const m = String(e?.message || "");
      setMsg({ kind: "err", text: m.includes("membership_required")
        ? "This trainer is for members only — join the club to book."
        : "Couldn't book that slot." });
    } finally { busy.current = false; }
  };

  const cancel = async (appointmentId, trainerId) => {
    if (busy.current) return;
    busy.current = true;
    setMsg(null);
    try {
      const res = await memberCancelAppointment(appointmentId);
      if (res?.ok) {
        setMsg({ kind: "ok", text: "Appointment cancelled." });
        setMyAppts((cur) => cur.filter((a) => a.appointment_id !== appointmentId));
        if (trainerId && (expandedId === trainerId)) loadSlots(trainerId);
      }
    } catch (e) {
      const m = String(e?.message || "");
      setMsg({ kind: "err", text: m.includes("cutoff_passed")
        ? "Too close to the session to cancel — speak to the club."
        : "Couldn't cancel that appointment." });
    } finally { busy.current = false; }
  };

  if (loading) return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
        <p style={{ color: "var(--t2)", fontFamily: "var(--font-body)" }}>Loading…</p>
      </div>
    </div>
  );
  if (!memberProfile || activeClubs.length === 0) return null;

  const labels = getDisciplineLabels(selectedClub?.discipline);
  const trainers = trainersData?.trainers ?? [];

  return (
    <div style={wrap}>
      <div style={{ background: "var(--b2)", borderBottom: "1px solid var(--border-subtle)", padding: "calc(20px + env(safe-area-inset-top)) 20px 16px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1 }}>{labels.trainTab}</div>

        {activeClubs.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {activeClubs.map((club) => {
              const active = club.club_id === selectedClubId;
              return (
                <button key={`${club.club_id}:${club.cohort_id}`} onClick={() => setSelectedClubId(club.club_id)}
                  style={{ padding: "6px 14px", borderRadius: 20,
                    border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                    background: active ? "var(--amber)" : "transparent",
                    color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                    fontSize: 13, fontFamily: "var(--font-body)", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
                  {club.club_name}{club.cohort_name ? ` · ${club.cohort_name}` : ""}
                </button>
              );
            })}
          </div>
        )}

        {venues.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {venues.map((v) => {
              const active = v.venue_id === selectedVenueId;
              return (
                <button key={v.venue_id} onClick={() => setSelectedVenueId(v.venue_id)}
                  style={{ padding: "5px 12px", borderRadius: 20,
                    border: `1px solid ${active ? "var(--t1)" : "var(--border)"}`,
                    background: active ? "rgba(255,255,255,0.08)" : "transparent",
                    color: active ? "var(--t1)" : "var(--t2)",
                    fontSize: 12, fontFamily: "var(--font-body)", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
                  {v.venue_name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: "16px 20px 20px" }}>
        {msg && (
          <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, fontSize: 13,
            fontFamily: "var(--font-body)",
            background: msg.kind === "ok" ? "rgba(80,200,120,0.12)" : "rgba(255,96,96,0.12)",
            color: msg.kind === "ok" ? "var(--t1)" : "#FF6060",
            border: `1px solid ${msg.kind === "ok" ? "rgba(80,200,120,0.3)" : "rgba(255,96,96,0.3)"}` }}>
            {msg.text}
          </div>
        )}

        {/* My upcoming appointments */}
        {myAppts.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--t2)", marginBottom: 10, letterSpacing: 0.5 }}>
              MY UPCOMING
            </div>
            {myAppts.map((a) => (
              <div key={a.appointment_id} style={card}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{a.trainer_name}</div>
                  <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                    {fmtDayKey(a.starts_at)} · {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)} · {fmtMoney(a.price_pence)}
                    {a.checked_in_at ? " · checked in" : ""}
                  </div>
                </div>
                {!a.checked_in_at && (
                  <button onClick={() => cancel(a.appointment_id, a.trainer_id)} style={cancelBtn}>Cancel</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Trainers */}
        {trainersLoading && <p style={{ color: "var(--t2)", fontFamily: "var(--font-body)" }}>Loading trainers…</p>}
        {!trainersLoading && trainers.length === 0 && (
          <p style={{ color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 8 }}>
            No trainers available to book yet.
          </p>
        )}

        {!trainersLoading && trainers.map((tr) => {
          const slots = slotsByTrainer[tr.trainer_id];
          const open = expandedId === tr.trainer_id;
          const grouped = Array.isArray(slots)
            ? slots.reduce((acc, s) => { const k = fmtDayKey(s.starts_at); (acc[k] = acc[k] || []).push(s); return acc; }, {})
            : null;
          return (
            <div key={tr.trainer_id} style={{ ...card, flexDirection: "column", alignItems: "stretch", marginBottom: 12 }}>
              <button onClick={() => tr.bookable && toggleTrainer(tr.trainer_id)}
                disabled={!tr.bookable}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left",
                  cursor: tr.bookable ? "pointer" : "default", color: "var(--t1)",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{tr.display_name}</div>
                  {tr.bio && <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 3 }}>{tr.bio}</div>}
                  <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 4 }}>
                    {tr.default_session_minutes} min · {fmtMoney(tr.price_pence)}
                  </div>
                </div>
                {!tr.bookable
                  ? <span style={lockBadge}>Members only</span>
                  : <span style={{ fontSize: 22, color: "var(--t2)" }}>{open ? "−" : "+"}</span>}
              </button>

              {open && (
                <div style={{ marginTop: 14 }}>
                  {slots === "loading" || slots === undefined
                    ? <p style={{ color: "var(--t2)", fontSize: 13 }}>Loading times…</p>
                    : (slots.length === 0
                      ? <p style={{ color: "var(--t2)", fontSize: 13 }}>No available times in the next 2 weeks.</p>
                      : Object.entries(grouped).map(([day, daySlots]) => (
                        <div key={day} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 12, color: "var(--t2)", marginBottom: 6 }}>{day}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {daySlots.map((s) => (
                              <button key={s.starts_at} onClick={() => book(tr.trainer_id, s.starts_at)}
                                style={slotBtn}>
                                {fmtTime(s.starts_at)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ClubNavBar active="book" passToken={selectedClub?.pass_token ?? null} clubEntry={selectedClub} />
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
  paddingBottom: "calc(80px + env(safe-area-inset-bottom,0))",
};
const card = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  background: "var(--b2)", border: "1px solid var(--border-subtle)", borderRadius: 12,
  padding: "14px 16px", marginBottom: 10,
};
const cancelBtn = {
  padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,96,96,0.4)",
  background: "transparent", color: "#FF6060", fontSize: 12, fontFamily: "var(--font-body)", cursor: "pointer",
};
const slotBtn = {
  padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.04)", color: "var(--t1)", fontSize: 13,
  fontFamily: "var(--font-body)", cursor: "pointer",
};
const lockBadge = {
  fontSize: 11, color: "var(--t2)", border: "1px solid var(--border)",
  borderRadius: 12, padding: "3px 10px",
};
