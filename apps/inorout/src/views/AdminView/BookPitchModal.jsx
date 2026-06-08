import { useState, useEffect, useRef, useCallback } from "react";
import { X, MagnifyingGlass, CaretLeft, CheckCircle } from "@phosphor-icons/react";
import {
  searchBookableVenues,
  getPitchFreeSlots,
  getPitchFreeSlotsSeries,
  bookPitchAdhoc,
  bookPitchSeries,
} from "@platform/core";

// ── helpers ───────────────────────────────────────────────────────────────────
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// YYYY-MM-DD from LOCAL components. Never toISOString — that converts to UTC and
// in UK BST (UTC+1) returns the previous day during the midnight hour, which would
// write a booking a day early.
const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Next date (YYYY-MM-DD) on/after today matching a weekday name.
function nextDateForDay(dayName) {
  const target = DAYS.indexOf(dayName);
  const today = new Date();
  if (target < 0) return isoLocal(today);
  const delta = (target - today.getDay() + 7) % 7; // 0 = today
  const d = new Date(today);
  d.setDate(today.getDate() + delta);
  return isoLocal(d);
}

// The weekday name for an ISO date — a weekly block repeats on whatever day its
// start date falls on (book_pitch_series keys the series on the start DOW).
function weekdayName(iso) {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "" : DAYS[d.getDay()];
}
// Human-readable date, e.g. "Wednesday, 24 June 2026".
function prettyDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
}

function localTime(tstz) {
  try {
    return new Date(tstz).toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
    });
  } catch { return ""; }
}

// Friendly mapping for the booking RPC error codes.
const ERR = {
  slot_unavailable: "That slot was just taken — pick another.",
  not_team_admin: "You need to be an admin of this team to book.",
  auth_required: "Please sign in to book.",
  pitch_unavailable: "That pitch isn't available for booking.",
  weeks_out_of_range: "Choose between 1 and 52 weeks.",
};
const friendlyErr = (e) => ERR[e?.message] || "Couldn't complete the booking — please try again.";

const OVERLAY = {
  position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const SHEET = {
  background: "var(--s1)", color: "var(--t1)", width: "100%", maxWidth: 520,
  maxHeight: "92dvh", overflowY: "auto", borderTopLeftRadius: "var(--rl)",
  borderTopRightRadius: "var(--rl)", padding: "18px 18px 32px",
  fontFamily: "var(--font-body)",
};
const LABEL = { fontSize: 11, letterSpacing: "0.08em", color: "var(--t2)", textTransform: "uppercase", marginBottom: 6, fontWeight: 300 };
const INPUT = {
  width: "100%", boxSizing: "border-box", padding: "12px 14px", fontSize: 15,
  background: "var(--s2)", color: "var(--t1)", border: "1px solid var(--s3)",
  borderRadius: "var(--rs)", fontFamily: "var(--font-body)", fontWeight: 300,
};
const PRIMARY = {
  width: "100%", padding: "14px", fontSize: 15, fontWeight: 400, cursor: "pointer",
  background: "var(--gold)", color: "var(--bg)", border: "none",
  borderRadius: "var(--rs)", fontFamily: "var(--font-body)",
};
const CHIP = (active) => ({
  padding: "10px 12px", borderRadius: "var(--rs)", cursor: "pointer",
  border: active ? "1px solid var(--goldb)" : "1px solid var(--s3)",
  background: active ? "var(--gold2)" : "var(--s2)", color: "var(--t1)",
  fontSize: 14, fontWeight: 300, textAlign: "left",
});

export default function BookPitchModal({ teamId, dayOfWeek, kickoff, recentVenues = [], onClose, onBooked }) {
  const [step, setStep]       = useState("venue");   // venue | plan | confirm | done
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState([]);
  const [venue, setVenue]     = useState(null);

  const [mode, setMode]       = useState("adhoc");   // adhoc | block
  const [date, setDate]       = useState(nextDateForDay(dayOfWeek));
  const [slots, setSlots]     = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selected, setSelected] = useState(null);    // the chosen slot row {playing_area_id, pitch_name, slot_minutes, slot_start}
  const [selectedTime, setSelectedTime] = useState(null); // chosen kickoff time "HH:MM"
  const [weeks, setWeeks]     = useState(6);
  const [blockStart, setBlockStart] = useState(nextDateForDay(dayOfWeek)); // weekly-block start date (its weekday IS the repeat day)

  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  // ── discovery ──
  const runSearch = useCallback((q) => {
    searchBookableVenues(q).then(setResults).catch(() => setResults([]));
  }, []);
  useEffect(() => { runSearch(""); }, [runSearch]); // initial: list bookable venues
  const onQuery = (v) => {
    setQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(v), 350);
  };

  // ── load slots when venue/date/mode/weeks changes ──
  // Block mode uses the series RPC so a slot is only offered when it's free on
  // EVERY one of the N weeks — otherwise book_pitch_series would reject the whole
  // block at the last step (mig 228). One-off mode checks the single chosen date.
  const loadSlotsFor = useCallback((venueId, m, d, w, startISO) => {
    setLoadingSlots(true);
    const req = m === "block"
      ? getPitchFreeSlotsSeries(venueId, startISO, Math.min(Math.max(Number(w) || 1, 1), 52))
      : getPitchFreeSlots(venueId, d);
    req
      .then((rows) => setSlots(Array.isArray(rows) ? rows : []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, []);

  const pickVenue = (v) => {
    setVenue(v);
    setSelected(null); setSelectedTime(null);
    setStep("plan");
    loadSlotsFor(v.venue_id, mode, date, weeks, blockStart);
  };

  const switchMode = (m) => {
    setMode(m);
    setSelected(null); setSelectedTime(null);
    if (venue) loadSlotsFor(venue.venue_id, m, date, weeks, blockStart);
  };

  const onDate = (d) => {
    setDate(d); setSelected(null); setSelectedTime(null);
    if (venue) loadSlotsFor(venue.venue_id, mode, d, weeks, blockStart);
  };

  // One picker: the start date. The block repeats weekly on whatever day that
  // date falls on, so picking the date sets both the day and the start.
  const onBlockStart = (iso) => {
    if (!iso) return;
    setBlockStart(iso);
    setSelected(null); setSelectedTime(null);
    if (venue) loadSlotsFor(venue.venue_id, "block", date, weeks, iso);
  };

  // Reload block availability when the week count changes — more weeks means more
  // chances of a clash, so the free-slot list can shrink.
  useEffect(() => {
    if (mode !== "block" || !venue) return;
    setSelected(null); setSelectedTime(null);
    loadSlotsFor(venue.venue_id, "block", date, weeks, blockStart);
  }, [weeks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Time-first: group the day's free slots by kickoff time. Shared by both modes —
  // the booker picks a time, then a pitch free at that time.
  const slotsByTime = (() => {
    const map = new Map();
    for (const s of slots) {
      const t = localTime(s.slot_start);
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(s);
    }
    return map;
  })();
  const times = [...slotsByTime.keys()].sort();
  const pitchesAtTime = selectedTime ? (slotsByTime.get(selectedTime) || []) : [];

  // Block: pre-select the team's weekly kickoff time once slots load, if it's free.
  useEffect(() => {
    if (mode !== "block" || selectedTime || slots.length === 0) return;
    const teamTime = (kickoff || "").slice(0, 5);
    if (slots.some((s) => localTime(s.slot_start) === teamTime)) setSelectedTime(teamTime);
  }, [slots, mode, kickoff, selectedTime]);

  const confirmBooking = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === "adhoc") {
        await bookPitchAdhoc(teamId, selected.playing_area_id, date, localTime(selected.slot_start), selected.slot_minutes);
      } else {
        await bookPitchSeries(teamId, selected.playing_area_id, localTime(selected.slot_start), blockStart, Number(weeks), selected.slot_minutes);
      }
      setStep("done");
      onBooked?.();
    } catch (e) {
      setError(friendlyErr(e));
    } finally {
      setBusy(false);
    }
  };

  // Shared time-first picker: a wrapped grid of kickoff times, then the pitches free
  // at the chosen time. Used by both one-off and weekly-block modes.
  const slotPicker = loadingSlots ? (
    <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>Loading…</div>
  ) : times.length === 0 ? (
    <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>No free slots that day.</div>
  ) : (
    <>
      <div style={LABEL}>Choose a time</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: selectedTime ? 16 : 0 }}>
        {times.map((t) => (
          <button key={t} onClick={() => { setSelectedTime(t); setSelected(null); }}
            style={{ ...CHIP(t === selectedTime), flex: "0 0 auto", minWidth: 72, textAlign: "center" }}>
            {t}
          </button>
        ))}
      </div>
      {selectedTime && (
        <>
          <div style={LABEL}>Available pitches</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pitchesAtTime.map((s, i) => (
              <button key={i} onClick={() => { setSelected(s); setStep("confirm"); }} style={CHIP(false)}>
                {s.pitch_name} · {s.slot_minutes} min
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );

  return (
    <div style={OVERLAY} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={SHEET}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          {step !== "venue" && step !== "done" && (
            <button onClick={() => setStep(step === "confirm" ? "plan" : "venue")}
              style={{ background: "none", border: "none", color: "var(--gold)", cursor: "pointer", padding: 0 }}>
              <CaretLeft size={20} weight="thin" />
            </button>
          )}
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--gold)", letterSpacing: "0.05em", flex: 1 }}>
            BOOK A PITCH
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--t2)", cursor: "pointer", padding: 0 }}>
            <X size={20} weight="thin" />
          </button>
        </div>

        {/* STEP 1 — venue */}
        {step === "venue" && (
          <>
            <div style={LABEL}>Find a venue</div>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <input value={query} onChange={(e) => onQuery(e.target.value)}
                placeholder="Venue name, city, or code" style={{ ...INPUT, paddingRight: 40 }} autoFocus />
              <MagnifyingGlass size={16} weight="thin" color="var(--t2)"
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }} />
            </div>

            {recentVenues.length > 0 && query.trim() === "" && (
              <>
                <div style={LABEL}>Your venues</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {recentVenues.map((v) => (
                    <button key={v.venue_id} onClick={() => pickVenue(v)} style={CHIP(false)}>
                      {v.name}{v.city ? ` — ${v.city}` : ""}
                    </button>
                  ))}
                </div>
                <div style={LABEL}>All bookable venues</div>
              </>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {results.map((v) => (
                <button key={v.venue_id} onClick={() => pickVenue(v)} style={CHIP(false)}>
                  {v.name}{v.city ? ` — ${v.city}` : ""}
                </button>
              ))}
              {results.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, padding: "8px 0" }}>
                  No bookable venues found. You can still record where you play in the venue field.
                </div>
              )}
            </div>
          </>
        )}

        {/* STEP 2 — plan (mode + date/slots) */}
        {step === "plan" && venue && (
          <>
            <div style={{ fontSize: 15, marginBottom: 4 }}>{venue.name}</div>
            {venue.city && <div style={{ fontSize: 12, color: "var(--t2)", marginBottom: 14 }}>{venue.city}</div>}

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={() => switchMode("adhoc")} style={{ ...CHIP(mode === "adhoc"), flex: 1, textAlign: "center" }}>One-off</button>
              <button onClick={() => switchMode("block")} style={{ ...CHIP(mode === "block"), flex: 1, textAlign: "center" }}>Weekly block</button>
            </div>

            {mode === "adhoc" ? (
              <>
                <div style={LABEL}>Date</div>
                <input type="date" value={date} min={isoLocal(new Date())}
                  onChange={(e) => onDate(e.target.value)} style={{ ...INPUT, marginBottom: 14 }} />
                {slotPicker}
              </>
            ) : (
              <>
                <div style={LABEL}>Starts</div>
                <input type="date" value={blockStart} min={isoLocal(new Date())}
                  onChange={(e) => onBlockStart(e.target.value)} style={{ ...INPUT, marginBottom: 10 }} />
                <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, marginBottom: 14 }}>
                  Repeats weekly from <span style={{ color: "var(--t1)" }}>{prettyDate(blockStart)}</span>.
                </div>
                <div style={LABEL}>Number of weeks</div>
                <input type="number" min={1} max={52} value={weeks}
                  onChange={(e) => setWeeks(e.target.value)} style={{ ...INPUT, marginBottom: 14 }} />
                {slotPicker}
              </>
            )}
          </>
        )}

        {/* STEP 3 — confirm */}
        {step === "confirm" && venue && selected && (
          <>
            <div style={LABEL}>Confirm your booking</div>
            <div style={{ background: "var(--s2)", border: "1px solid var(--s3)", borderRadius: "var(--rs)", padding: 14, marginBottom: 16, fontSize: 14, fontWeight: 300, lineHeight: 1.7 }}>
              <div><strong style={{ fontWeight: 400 }}>{venue.name}</strong>{venue.city ? ` — ${venue.city}` : ""}</div>
              <div>{selected.pitch_name}</div>
              {mode === "adhoc" ? (
                <div>{prettyDate(date)} · {localTime(selected.slot_start)} · {selected.slot_minutes} min</div>
              ) : (
                <>
                  <div>Every {weekdayName(blockStart)} at {localTime(selected.slot_start)} · {selected.slot_minutes} min · {weeks} week{Number(weeks) === 1 ? "" : "s"}</div>
                  <div style={{ marginTop: 4, color: "var(--t2)" }}>From {prettyDate(blockStart)}</div>
                </>
              )}
            </div>

            <div style={LABEL}>Cancellation policy</div>
            <div style={{ fontSize: 12, color: "var(--t2)", fontWeight: 300, marginBottom: 18, lineHeight: 1.6 }}>
              {venue.cancellation_policy || "Cancellation terms vary by venue — please check with the venue. The venue confirms every request."}
            </div>

            {error && <div style={{ fontSize: 13, color: "var(--red, #FF6060)", marginBottom: 12, fontWeight: 300 }}>{error}</div>}

            <button onClick={confirmBooking} disabled={busy} style={{ ...PRIMARY, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Sending…" : "Send booking request"}
            </button>
            <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, textAlign: "center", marginTop: 10 }}>
              The venue confirms your request — you'll see the status update here.
            </div>
          </>
        )}

        {/* DONE */}
        {step === "done" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <CheckCircle size={48} weight="thin" color="var(--gold)" />
            <div style={{ fontSize: 17, marginTop: 12, marginBottom: 6 }}>Request sent</div>
            <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, marginBottom: 20 }}>
              {venue?.name} will confirm shortly. Track it in your bookings.
            </div>
            <button onClick={onClose} style={PRIMARY}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
