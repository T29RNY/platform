// ClubAdminCampCreate.jsx — Club-admin track, the /hub's FIRST create surface.
// Phone twin of the desktop venue CampModal (apps/venue/src/views/ClassesView.jsx),
// scoped to the ONE club whose shell venue the caller owns. Holiday Camps P9.5.
//
// A camp = an is_camp flavour of a class type + its dated sessions, so this does the
// SAME two RPC calls as the desktop: venueCreateClassType (camp fields + audience/target)
// then venueCreateCamp (emits the dated sessions — per_day = one/day, block = one spanning).
// typeIdRef caches step-1's class_type_id so a retry after a step-2 space clash reuses the
// type (no duplicate orphan) — matches the desktop fix.
//
// AUTH: a club admin passes their shell venue_id as the credential (role.entityId → venueToken).
// Every RPC authenticates via resolve_venue_caller against venue_admins (auth.uid()). No new
// backend — reuses the existing venue-token wrappers only (mobile reuses the desktop contract).
//   venueListSpaces(venueToken)   → [{ id, name, is_active, ... }]   (filter is_active)
//   venueListAdmins(venueToken)   → { admins:[{ id, email, status }] } (filter status='active')
//   clubListTeams(venueToken, clubId) → [{ team_id, name, cohort_name, ... }]  (club-scoped)
//   venueCreateClassType(venueToken, { name, spaceId, durationMinutes, defaultCapacity,
//     category:'other', isCamp:true, bookingMode, audience, targetTeamId, campInfo, campDietary,
//     pickupTime, dropoffTime, pickupLocation, dropoffLocation }) → { ok, class_type_id }
//   venueCreateCamp(venueToken, { classTypeId, instructorId, dateFrom, dateTo, dailyStartTime,
//     pricePence, paymentMode }) → { ok, class_type_id, booking_mode, sessions_created, sessions_skipped }

import { useState, useEffect, useRef } from "react";
import { venueListSpaces, venueListAdmins, clubListTeams, venueCreateClassType, venueCreateCamp } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const poundsToPence = (v) => Math.round(parseFloat(v || "0") * 100);

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--r-sm)",
  border: "1px solid var(--hair)", background: "var(--s3)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 14, marginTop: 4,
};
const labelStyle = { display: "block", marginBottom: 12, fontSize: 12, color: "var(--ink3)" };
const btnPrimary = {
  width: "100%", padding: "13px 16px", borderRadius: "var(--r-sm)", background: "var(--amber)",
  color: "var(--amber-ink)", border: "none", fontFamily: "var(--m-font)", fontWeight: 700, cursor: "pointer",
  fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
};

// Two-option pill toggle (matches the ClubAdminComms audience buttons).
function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" onClick={() => !o.disabled && onChange(o.key)} disabled={o.disabled} style={{
            flex: 1, padding: "11px 12px", borderRadius: "var(--r-pill)", cursor: o.disabled ? "default" : "pointer",
            fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700, opacity: o.disabled ? 0.5 : 1,
            border: on ? "1px solid var(--amber)" : "1px solid var(--hair)",
            background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--ink)" : "var(--ink3)",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

export default function ClubAdminCampCreate({ venueToken, clubId, clubName, toast, onClose, onDone }) {
  const [name, setName] = useState("");
  const [spaces, setSpaces] = useState(null);
  const [instructors, setInstructors] = useState(null);
  const [teams, setTeams] = useState([]);
  const [spaceId, setSpaceId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [bookingMode, setBookingMode] = useState("per_day");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("360");
  const [capacity, setCapacity] = useState("20");
  const [price, setPrice] = useState("0.00");
  const [paymentMode, setPaymentMode] = useState("prepay");
  const [audience, setAudience] = useState("all");
  const [targetTeamId, setTargetTeamId] = useState("");
  const [campInfo, setCampInfo] = useState("");
  const [campDietary, setCampDietary] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [dropoffTime, setDropoffTime] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [dropoffLocation, setDropoffLocation] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const savingRef = useRef(false);
  const typeIdRef = useRef(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      venueListSpaces(venueToken).catch(() => []),
      venueListAdmins(venueToken).catch(() => ({ admins: [] })),
      clubListTeams(venueToken, clubId).catch(() => []),
    ]).then(([sp, ad, tm]) => {
      if (!alive) return;
      const activeSpaces = (Array.isArray(sp) ? sp : []).filter((s) => s.is_active);
      const activeAdmins = ((ad?.admins) ?? []).filter((a) => a.status === "active");
      setSpaces(activeSpaces);
      setInstructors(activeAdmins);
      setTeams(Array.isArray(tm) ? tm : []);
      setSpaceId(activeSpaces[0]?.id ?? "");
      setInstructorId(activeAdmins[0]?.id ?? "");
    });
    return () => { alive = false; };
  }, [venueToken, clubId]);

  const submit = async () => {
    if (savingRef.current) return;
    setErr(null);
    if (!name.trim()) { setErr("Give the camp a name."); return; }
    if (!spaceId) { setErr("Pick a space."); return; }
    if (!instructorId) { setErr("Pick a lead instructor."); return; }
    if (!dateFrom || !dateTo) { setErr("Pick the camp's start and end dates."); return; }
    if (dateTo < dateFrom) { setErr("The end date must be on or after the start date."); return; }
    if (!startTime) { setErr("Pick the daily start time."); return; }
    if (audience === "team" && !targetTeamId) { setErr("Pick the team this camp is for."); return; }
    const dur = parseInt(duration, 10);
    const cap = parseInt(capacity, 10);
    if (!Number.isFinite(dur) || dur <= 0) { setErr("Set a valid daily length."); return; }
    if (!Number.isFinite(cap) || cap < 0) { setErr("Set a valid capacity."); return; }

    savingRef.current = true; setBusy(true);
    try {
      // Step 1 runs ONCE — a retry after a step-2 clash reuses the created type (no duplicate).
      let classTypeId = typeIdRef.current;
      if (!classTypeId) {
        const r1 = await venueCreateClassType(venueToken, {
          name: name.trim(), spaceId, durationMinutes: dur, defaultCapacity: cap, category: "other",
          isCamp: true, bookingMode, audience,
          targetTeamId: audience === "team" ? targetTeamId : null,
          campInfo: campInfo.trim() || null, campDietary: campDietary.trim() || null,
          pickupTime: pickupTime || null, dropoffTime: dropoffTime || null,
          pickupLocation: pickupLocation.trim() || null, dropoffLocation: dropoffLocation.trim() || null,
        });
        classTypeId = r1.class_type_id;
        typeIdRef.current = classTypeId;
      }
      const r2 = await venueCreateCamp(venueToken, {
        classTypeId, instructorId, dateFrom, dateTo,
        dailyStartTime: startTime, pricePence: poundsToPence(price), paymentMode,
      });
      setResult(r2);
      toast?.({ icon: "check", text: "Holiday camp created" });
    } catch (e) {
      const m = e?.message || String(e);
      setErr(
        m === "space_unavailable" ? "The space is already booked on those dates/time — change the dates or daily start time and try again."
          : m === "target_team_not_found" ? "That team isn't linked to this venue."
          : m === "feature_disabled" ? "Camps aren't enabled for this club yet."
          : m
      );
    } finally { savingRef.current = false; setBusy(false); }
  };

  if (result) {
    return (
      <MobileSheet title="Camp created" onClose={onDone}>
        <div className="m-card" style={{ padding: "16px 15px", marginTop: 4 }}>
          <p style={{ fontSize: 14.5, color: "var(--ink)", margin: 0, lineHeight: 1.5 }}>
            Created <strong>{result.sessions_created}</strong> bookable {result.booking_mode === "block" ? "camp" : "day"}{result.sessions_created === 1 ? "" : "s"}.
            {result.sessions_skipped > 0 && <> {result.sessions_skipped} day{result.sessions_skipped === 1 ? " was" : "s were"} skipped because the space was already booked.</>}
          </p>
          <p style={{ fontSize: 12.5, color: "var(--ink3)", margin: "8px 0 0", lineHeight: 1.5 }}>
            Guardians can now see and book it in their app.
          </p>
        </div>
        <button onClick={onDone} style={{ ...btnPrimary, marginTop: 16 }}>Done</button>
      </MobileSheet>
    );
  }

  const loading = spaces === null || instructors === null;

  return (
    <MobileSheet title="Add holiday camp" onClose={onClose}>
      <div className="m-eyebrow" style={{ margin: "2px 2px 10px" }}>{clubName || "Your club"}</div>

      {err && <div style={{ color: "var(--live-ink)", background: "var(--live-soft)", borderRadius: "var(--r-sm)", padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Loading…</div>
      ) : spaces.length === 0 ? (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink2)", fontSize: 13.5, lineHeight: 1.5 }}>
          No spaces to run a camp in yet. Add a space (studio, hall or room) on the desktop console first.
        </div>
      ) : (
        <>
          <label style={labelStyle}>Camp name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Football Camp" style={inputStyle} />
          </label>

          <label style={labelStyle}>Space
            <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} style={inputStyle}>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <label style={labelStyle}>Lead instructor
            <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)} style={inputStyle}>
              {instructors.length === 0 && <option value="">No active staff — add staff first</option>}
              {instructors.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
          </label>

          <div className="m-eyebrow" style={{ margin: "2px 2px 8px" }}>Booking</div>
          <Toggle options={[{ key: "per_day", label: "Book per day" }, { key: "block", label: "Whole camp" }]} value={bookingMode} onChange={setBookingMode} />

          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ ...labelStyle, flex: 1 }}>Start date
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>End date
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
            </label>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ ...labelStyle, flex: 1 }}>Daily start
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>Length (min)
              <input type="number" min="1" step="15" value={duration} onChange={(e) => setDuration(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>Capacity
              <input type="number" min="0" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} style={inputStyle} />
            </label>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ ...labelStyle, flex: 1 }}>Price {bookingMode === "block" ? "(whole camp, £)" : "(per day, £)"}
              <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>Payment
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} style={inputStyle}>
                <option value="prepay">Prepay</option>
                <option value="door">On the day</option>
                <option value="both">Either</option>
              </select>
            </label>
          </div>

          <div className="m-eyebrow" style={{ margin: "2px 2px 8px" }}>Who can book</div>
          <Toggle
            options={[{ key: "all", label: "Everyone" }, { key: "team", label: "A team", disabled: teams.length === 0 }]}
            value={audience} onChange={setAudience} />
          {audience === "team" && (
            <label style={labelStyle}>Team
              <select value={targetTeamId} onChange={(e) => setTargetTeamId(e.target.value)} style={inputStyle}>
                <option value="">Pick a team…</option>
                {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.name}{t.cohort_name ? " (" + t.cohort_name + ")" : ""}</option>)}
              </select>
            </label>
          )}

          <div className="m-eyebrow" style={{ margin: "6px 2px 8px" }}>Camp details</div>
          <label style={labelStyle}>Information (optional)
            <input value={campInfo} onChange={(e) => setCampInfo(e.target.value)} placeholder="e.g. Bring boots, shin pads & a packed lunch" style={inputStyle} />
          </label>
          <label style={labelStyle}>Dietary / catering (optional)
            <input value={campDietary} onChange={(e) => setCampDietary(e.target.value)} placeholder="e.g. Nut-free site; lunch provided" style={inputStyle} />
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ ...labelStyle, flex: 1 }}>Pick-up time
              <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: 2 }}>Pick-up location
              <input value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} placeholder="e.g. Main reception" style={inputStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ ...labelStyle, flex: 1 }}>Drop-off time
              <input type="time" value={dropoffTime} onChange={(e) => setDropoffTime(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: 2 }}>Drop-off location
              <input value={dropoffLocation} onChange={(e) => setDropoffLocation(e.target.value)} placeholder="e.g. Main gate" style={inputStyle} />
            </label>
          </div>

          <button onClick={submit} disabled={busy} style={{ ...btnPrimary, marginTop: 4, opacity: busy ? 0.6 : 1 }}>
            <MIcon name="check" size={16} color="var(--amber-ink)" />
            {busy ? "Creating…" : "Create camp"}
          </button>
        </>
      )}
    </MobileSheet>
  );
}
