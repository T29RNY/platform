import { useState, useEffect, useRef, useCallback } from "react";
import { X, MagnifyingGlass, CaretLeft, CheckCircle } from "@phosphor-icons/react";
import {
  searchBookableVenues,
  getPitchFreeSlots,
  bookPitchAdhoc,
  bookPitchSeries,
} from "@platform/core";

// ── helpers ───────────────────────────────────────────────────────────────────
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// Next date (YYYY-MM-DD) on/after today matching a weekday name.
function nextDateForDay(dayName) {
  const target = DAYS.indexOf(dayName);
  const today = new Date();
  if (target < 0) return today.toISOString().slice(0, 10);
  const delta = (target - today.getDay() + 7) % 7; // 0 = today
  const d = new Date(today);
  d.setDate(today.getDate() + delta);
  return d.toISOString().slice(0, 10);
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
  const [selected, setSelected] = useState(null);    // a slot (adhoc) or {playing_area_id, pitch_name, slot_minutes} (block)
  const [weeks, setWeeks]     = useState(6);

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

  // ── load slots when venue/date/mode changes ──
  const loadSlots = useCallback((venueId, d) => {
    setLoadingSlots(true);
    getPitchFreeSlots(venueId, d)
      .then((rows) => setSlots(Array.isArray(rows) ? rows : []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, []);

  const pickVenue = (v) => {
    setVenue(v);
    setSelected(null);
    setStep("plan");
    loadSlots(v.venue_id, mode === "block" ? nextDateForDay(dayOfWeek) : date);
  };

  const switchMode = (m) => {
    setMode(m);
    setSelected(null);
    const d = m === "block" ? nextDateForDay(dayOfWeek) : date;
    if (m === "block") setDate(nextDateForDay(dayOfWeek));
    if (venue) loadSlots(venue.venue_id, d);
  };

  const onDate = (d) => {
    setDate(d); setSelected(null);
    if (venue) loadSlots(venue.venue_id, d);
  };

  // Block: distinct pitches (+ offered lengths) derived from the day's free slots.
  const blockPitches = (() => {
    const map = new Map();
    for (const s of slots) {
      const cur = map.get(s.playing_area_id) || { playing_area_id: s.playing_area_id, pitch_name: s.pitch_name, lengths: new Set() };
      cur.lengths.add(s.slot_minutes);
      map.set(s.playing_area_id, cur);
    }
    return [...map.values()].map((p) => ({ ...p, lengths: [...p.lengths].sort((a, b) => a - b) }));
  })();

  const confirmBooking = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === "adhoc") {
        await bookPitchAdhoc(teamId, selected.playing_area_id, date, localTime(selected.slot_start), selected.slot_minutes);
      } else {
        await bookPitchSeries(teamId, selected.playing_area_id, kickoff, nextDateForDay(dayOfWeek), Number(weeks), selected.slot_minutes);
      }
      setStep("done");
      onBooked?.();
    } catch (e) {
      setError(friendlyErr(e));
    } finally {
      setBusy(false);
    }
  };

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
                <input type="date" value={date} min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => onDate(e.target.value)} style={{ ...INPUT, marginBottom: 14 }} />
                <div style={LABEL}>Available slots</div>
                {loadingSlots ? (
                  <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>Loading…</div>
                ) : slots.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>No free slots that day.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {slots.map((s, i) => (
                      <button key={i} onClick={() => { setSelected(s); setStep("confirm"); }} style={CHIP(false)}>
                        {localTime(s.slot_start)} · {s.slot_minutes} min · {s.pitch_name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, marginBottom: 14 }}>
                  Your weekly slot: <span style={{ color: "var(--t1)" }}>{dayOfWeek}s at {kickoff}</span>, starting {nextDateForDay(dayOfWeek)}.
                </div>
                <div style={LABEL}>Number of weeks</div>
                <input type="number" min={1} max={52} value={weeks}
                  onChange={(e) => setWeeks(e.target.value)} style={{ ...INPUT, marginBottom: 14 }} />
                <div style={LABEL}>Choose a pitch</div>
                {loadingSlots ? (
                  <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>Loading…</div>
                ) : blockPitches.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>No pitches free that day.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {blockPitches.map((p) => (
                      p.lengths.map((len) => (
                        <button key={`${p.playing_area_id}-${len}`}
                          onClick={() => { setSelected({ playing_area_id: p.playing_area_id, pitch_name: p.pitch_name, slot_minutes: len }); setStep("confirm"); }}
                          style={CHIP(false)}>
                          {p.pitch_name}{p.lengths.length > 1 ? ` · ${len} min` : ""}
                        </button>
                      ))
                    ))}
                  </div>
                )}
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
                <div>{date} · {localTime(selected.slot_start)} · {selected.slot_minutes} min</div>
              ) : (
                <div>{dayOfWeek}s at {kickoff} · {selected.slot_minutes} min · {weeks} week{Number(weeks) === 1 ? "" : "s"}</div>
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
