import { useState, useRef, useCallback } from "react";
import { ArrowLeft, MapPin } from "@phosphor-icons/react";
import { Toggle } from "@platform/ui";
import { upsertSchedule, upsertSettings } from "@platform/supabase";

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const KICKOFF_TIMES = (() => {
  const t = [];
  for (let h = 6; h < 24; h++)
    for (let m = 0; m < 60; m += 15)
      t.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
  return t;
})();

const OPEN_TIMES = (() => {
  const t = [];
  for (let h = 6; h <= 22; h++)
    for (let m = 0; m < 60; m += 30) {
      if (h === 22 && m > 0) break;
      t.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
    }
  return t;
})();

const QUIET_TIMES = (() => {
  const t = [];
  for (let h = 0; h < 24; h++)
    t.push(`${String(h).padStart(2,"0")}:00`);
  return t;
})();

const SQUAD_SIZES   = [6,7,8,9,10,11,12,13,14,16,18,20,22];
const PRIORITY_LEADS = [30,45,60,90,120];

const DEFAULT_REMINDERS = {
  quietStart: "22:00",
  quietEnd:   "08:00",
  triggers: {
    gameLive:true, squadFull:true, spotOpened:true,
    gameCancelled:true, gameDay9am:true, oneHrBefore:true,
    debtReminder:true, bibs24hr:true, bibs45min:true,
    teamsConfirmed:true,
  },
};

const NOTIFICATION_TOGGLES = [
  { key: 'gameLive',       label: 'Game is live',        sub: 'When the game opens for player responses'      },
  { key: 'squadFull',      label: 'Squad full',           sub: 'When the squad reaches the target number'      },
  { key: 'spotOpened',     label: 'Spot opened',          sub: 'When a reserve moves into the squad'           },
  { key: 'gameCancelled',  label: 'Game cancelled',       sub: 'When the game is cancelled'                    },
  { key: 'gameDay9am',     label: 'Game day morning',     sub: 'Reminder at 9am on matchday'                   },
  { key: 'oneHrBefore',    label: '1hr before kickoff',   sub: "Sent to players who haven't paid yet"          },
  { key: 'debtReminder',   label: 'Debt reminder',        sub: '24hrs after the game, chases unpaid players'   },
  { key: 'bibs24hr',       label: 'Bibs — 24hrs before',  sub: 'Reminder for the bib holder to wash the bibs' },
  { key: 'bibs45min',      label: 'Bibs — 45min before',  sub: 'Final reminder to bring the bibs'              },
  { key: 'teamsConfirmed', label: 'Teams confirmed',      sub: 'When teams are picked and shared with players' },
];


// ── Helpers ───────────────────────────────────────────────────────────────────

function computeOpensDay(dayOfWeek) {
  return DAYS[(DAYS.indexOf(dayOfWeek) + 6) % 7];
}

function formatNextMatchday(gameDateTime, kickoff) {
  if (!gameDateTime) return null;
  const d = new Date(gameDateTime);
  if (isNaN(d)) return null;
  const datePart = d.toLocaleDateString("en-GB", {
    weekday:"long", day:"numeric", month:"long", year:"numeric",
  });
  return `${datePart} at ${kickoff}`;
}

function buildOverrideDateISO(dateStr, kickoff) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes]   = kickoff.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const LABEL = {
  fontFamily:"var(--font-display)", fontSize:11, color:"var(--t2)",
  letterSpacing:"0.08em", marginBottom:6, display:"block",
};

const BASE_INPUT = {
  width:"100%", padding:"12px 14px", borderRadius:10,
  background:"var(--s2)", color:"var(--t1)",
  fontFamily:"var(--font-body)", fontWeight:300, fontSize:15,
  outline:"none", boxSizing:"border-box",
};

// ── Field components ──────────────────────────────────────────────────────────

function FInput({ label, value, onChange, placeholder, type="text" }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom:16 }}>
      {label && <div style={LABEL}>{label}</div>}
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...BASE_INPUT, border: focused ? "1px solid var(--goldb)" : "1px solid var(--s3)" }}
      />
    </div>
  );
}

function FSelect({ label, value, onChange, children, helper }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom:16 }}>
      {label && <div style={LABEL}>{label}</div>}
      <div style={{ position:"relative" }}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            ...BASE_INPUT,
            border: focused ? "1px solid var(--goldb)" : "1px solid var(--s3)",
            appearance:"none", WebkitAppearance:"none", paddingRight:36, cursor:"pointer",
          }}
        >
          {children}
        </select>
        <div style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)",
          color:"var(--t2)", pointerEvents:"none", fontSize:12 }}>▾</div>
      </div>
      {helper && (
        <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:6, paddingLeft:2 }}>
          {helper}
        </div>
      )}
    </div>
  );
}

// ── Venue autocomplete ────────────────────────────────────────────────────────

function VenueField({ venue, setVenue, city, setCity }) {
  const [suggestions,   setSuggestions]   = useState([]);
  const [inputFocused,  setInputFocused]  = useState(false);
  const [cityAuto,      setCityAuto]      = useState(city || "");
  const [showCityInput, setShowCityInput] = useState(!city);
  const debounceRef = useRef(null);
  const abortRef    = useRef(null);

  const fetchSuggestions = useCallback((q) => {
    if (q.length < 3) { setSuggestions([]); return; }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
    fetch(url, { signal:ctrl.signal, headers:{ "Accept-Language":"en" } })
      .then(r => r.json())
      .then(data => setSuggestions(data.slice(0,5).map(r => ({
        name: r.display_name.split(",")[0],
        sub:  r.display_name.split(",").slice(1,3).join(",").trim(),
        city: r.address?.city || r.address?.town || r.address?.village || "",
      }))))
      .catch(() => {});
  }, []);

  const handleChange = (val) => {
    setVenue(val);
    clearTimeout(debounceRef.current);
    if (val.length >= 3) debounceRef.current = setTimeout(() => fetchSuggestions(val), 400);
    else setSuggestions([]);
  };

  const handleSelect = (sug) => {
    setVenue(sug.name);
    if (sug.city) {
      setCityAuto(sug.city);
      setCity(sug.city);
      setShowCityInput(false);
    }
    setSuggestions([]);
  };

  return (
    <div style={{ marginBottom:16 }}>
      <div style={LABEL}>VENUE</div>
      <div style={{ position:"relative" }}>
        <div style={{ position:"relative" }}>
          <input
            value={venue}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setTimeout(() => { setInputFocused(false); setSuggestions([]); }, 150)}
            placeholder="e.g. Powerleague Salford"
            style={{
              ...BASE_INPUT,
              border: inputFocused ? "1px solid var(--goldb)" : "1px solid var(--s3)",
              paddingRight:40,
            }}
          />
          <MapPin size={16} weight="thin" color="var(--t2)" style={{
            position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", pointerEvents:"none",
          }}/>
        </div>
        {suggestions.length > 0 && (
          <div style={{
            position:"absolute", top:"100%", left:0, right:0, zIndex:100,
            background:"var(--s2)", border:"1px solid var(--goldb)",
            borderRadius:10, overflow:"hidden", marginTop:4,
          }}>
            {suggestions.map((sug, i) => (
              <div key={i} onMouseDown={() => handleSelect(sug)} style={{
                padding:"12px 14px", cursor:"pointer",
                borderBottom: i < suggestions.length - 1 ? "1px solid var(--s3)" : "none",
              }}>
                <div style={{ fontSize:14, color:"var(--t1)", fontWeight:300 }}>{sug.name}</div>
                {sug.sub && <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:2 }}>{sug.sub}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {cityAuto && !showCityInput ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
          <span style={{
            fontSize:12, color:"var(--gold)", fontWeight:300,
            background:"var(--gold2)", border:"1px solid var(--goldb)",
            borderRadius:20, padding:"4px 12px",
          }}>
            📍 {cityAuto}
          </span>
          <button onClick={() => setShowCityInput(true)} style={{
            background:"none", border:"none", color:"var(--t2)",
            fontSize:11, cursor:"pointer", fontFamily:"var(--font-body)", fontWeight:300,
          }}>
            · change
          </button>
        </div>
      ) : showCityInput && (
        <div style={{ marginTop:8 }}>
          <div style={LABEL}>CITY / TOWN</div>
          <input
            value={city}
            onChange={e => { setCity(e.target.value); setCityAuto(e.target.value); }}
            placeholder="e.g. Manchester"
            style={{ ...BASE_INPUT, border:"1px solid var(--s3)" }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScheduleScreen({ schedule, setSchedule, settings, setSettings, onBack, teamId, adminToken = null }) {
  const [sched,     setSched]     = useState(schedule);
  const [groupName, setGroupName] = useState(settings.groupName || "");
  const [reminders, setReminders] = useState(schedule.remindersConfig || DEFAULT_REMINDERS);

  const [saving,     setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | "ok" | "error"

  const [dateOverride,      setDateOverride]      = useState("");
  const [dateOverrideSaved, setDateOverrideSaved] = useState(false);

  const [priceDisplay, setPriceDisplay] = useState(
    sched.pricePerPlayer !== null && sched.pricePerPlayer !== undefined
      ? String(sched.pricePerPlayer) : ""
  );
  const [priceZeroAck, setPriceZeroAck] = useState(false);
  const [priceError,   setPriceError]   = useState(null);
  const [priceFocused, setPriceFocused] = useState(false);

  // ── One-off date override ────────────────────────────────────────────────────
  const applyDateOverride = async () => {
    if (!dateOverride || dateOverrideSaved) return;
    const newDt = buildOverrideDateISO(dateOverride, sched.kickoff);
    const newSched = { ...sched, gameDateTime: newDt };
    setSched(newSched);
    if (adminToken) {
      try { await upsertSchedule(adminToken, { ...newSched, remindersConfig: reminders }); } catch (_) {}
    }
    setDateOverrideSaved(true);
    setTimeout(() => { setDateOverrideSaved(false); setDateOverride(""); }, 2000);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!priceDisplay.trim()) {
      setPriceError("Enter a price (or 0 for free)"); return;
    }
    const priceVal = parseFloat(priceDisplay);
    if (isNaN(priceVal)) {
      setPriceError("Enter a valid number"); return;
    }
    if (priceVal === 0 && !priceZeroAck) {
      setPriceError("Is this game free? Tap Save again to confirm.");
      setPriceZeroAck(true); return;
    }
    setPriceError(null);

    const finalSched = { ...sched,
      pricePerPlayer: priceVal,
      remindersConfig: reminders,
      isDraft:       schedule.isDraft,
      isCancelled:   schedule.isCancelled,
      lineupLocked:  schedule.lineupLocked,
      activeMatchId: schedule.activeMatchId };

    setSaving(true);
    try {
      if (adminToken) {
        await upsertSchedule(adminToken, finalSched);
        await upsertSettings(adminToken, groupName);
      }
      setSchedule(finalSched);
      setSettings({ ...settings, groupName });
      setSaveStatus("ok");
      setTimeout(() => { setSaveStatus(null); onBack(); }, 1000);
    } catch (_) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const matchdayDisplay = formatNextMatchday(sched.gameDateTime, sched.kickoff);

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:80 }}>

      {/* Header */}
      <div style={{ padding:"16px 18px 0", display:"flex", alignItems:"center",
        gap:12, marginBottom:20 }}>
        <div onClick={onBack} style={{ cursor:"pointer", color:"var(--gold)",
          display:"flex", alignItems:"center", WebkitTapHighlightColor:"transparent" }}>
          <ArrowLeft size={20} weight="thin"/>
        </div>
        <div style={{ fontFamily:"var(--font-display)", fontSize:28, color:"var(--gold)",
          letterSpacing:"0.06em" }}>
          MATCHDAY SETTINGS
        </div>
      </div>

      <div style={{ padding:"0 18px" }}>

            {/* Next matchday display */}
            <div style={{ marginBottom:16 }}>
              <div style={LABEL}>NEXT MATCHDAY</div>
              <div style={{
                background:"var(--s2)", borderRadius:10, padding:14,
                color: matchdayDisplay ? "var(--t1)" : "var(--t2)",
                fontFamily:"var(--font-body)", fontWeight:300, fontSize:15,
                fontStyle: matchdayDisplay ? "normal" : "italic",
              }}>
                {matchdayDisplay || "Not yet scheduled — complete setup to activate"}
              </div>
            </div>

            {/* One-off date override */}
            <div style={{ background:"var(--s2)", borderRadius:10, padding:14,
              border:"1px solid var(--s3)", marginBottom:24 }}>
              <div style={LABEL}>ONE-OFF DATE CHANGE</div>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300,
                marginBottom:12, lineHeight:1.5 }}>
                Use for bank holidays or one-off venue changes. Resets automatically next week.
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <input
                  type="date"
                  value={dateOverride}
                  onChange={e => setDateOverride(e.target.value)}
                  style={{
                    flex:1, padding:"12px 14px", borderRadius:10,
                    background:"var(--bg)", color:"var(--t1)",
                    border:"1px solid var(--s3)",
                    fontFamily:"var(--font-body)", fontWeight:300, fontSize:15,
                    outline:"none", boxSizing:"border-box", colorScheme:"dark",
                  }}
                />
                <button
                  onClick={applyDateOverride}
                  disabled={!dateOverride || dateOverrideSaved}
                  style={{
                    padding:"12px 16px", borderRadius:8, cursor: dateOverride ? "pointer" : "not-allowed",
                    background:"transparent",
                    border: `1px solid ${dateOverrideSaved ? "var(--green)" : (!dateOverride ? "var(--s3)" : "var(--gold)")}`,
                    color: dateOverrideSaved ? "var(--green)" : (!dateOverride ? "var(--t2)" : "var(--gold)"),
                    fontFamily:"var(--font-display)", fontSize:14, letterSpacing:"0.06em",
                    flexShrink:0, whiteSpace:"nowrap",
                  }}
                >
                  {dateOverrideSaved ? "UPDATED ✓" : "UPDATE THIS WEEK"}
                </button>
              </div>
            </div>

            {/* Squad name */}
            <FInput
              label="SQUAD NAME"
              value={groupName}
              onChange={setGroupName}
              placeholder="e.g. Finbar's Tuesdays"
            />

            {/* Game day */}
            <FSelect
              label="GAME DAY"
              value={sched.dayOfWeek}
              onChange={v => setSched(s => ({ ...s, dayOfWeek: v }))}
              helper={`Invites auto-open ${computeOpensDay(sched.dayOfWeek)} at ${sched.opensTime || "10:00"}`}
            >
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </FSelect>

            {/* Kick off */}
            <FSelect
              label="KICK OFF"
              value={sched.kickoff}
              onChange={v => setSched(s => ({ ...s, kickoff: v }))}
            >
              {KICKOFF_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
            </FSelect>

            {/* Venue + city */}
            <VenueField
              venue={sched.venue || ""}
              setVenue={v => setSched(s => ({ ...s, venue: v }))}
              city={sched.city || ""}
              setCity={v => setSched(s => ({ ...s, city: v }))}
            />

            {/* Players needed */}
            <FSelect
              label="PLAYERS NEEDED"
              value={String(sched.squadSize)}
              onChange={v => setSched(s => ({ ...s, squadSize: parseInt(v) }))}
            >
              {SQUAD_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </FSelect>

            {/* Price per player */}
            <div style={{ marginBottom:16 }}>
              <div style={LABEL}>PRICE PER PLAYER (£)</div>
              <input
                type="number" min="0" step="0.5"
                value={priceDisplay}
                onChange={e => {
                  setPriceDisplay(e.target.value);
                  setPriceError(null);
                  if (e.target.value !== "0") setPriceZeroAck(false);
                }}
                onFocus={() => setPriceFocused(true)}
                onBlur={() => setPriceFocused(false)}
                placeholder="e.g. 6"
                style={{
                  ...BASE_INPUT,
                  border: priceFocused ? "1px solid var(--goldb)" : "1px solid var(--s3)",
                }}
              />
              {priceError && (
                <div style={{ fontSize:12, color:"var(--amber)", fontWeight:300, marginTop:4 }}>
                  {priceError}
                </div>
              )}
            </div>

            {/* Bibs */}
            <div style={{ marginBottom:16 }}>
              <div style={LABEL}>DOES YOUR GAME USE BIBS?</div>
              <div style={{ display:"flex", gap:8 }}>
                {[true, false].map(val => (
                  <button key={String(val)}
                    onClick={() => setSched(s => ({ ...s, bibsEnabled: val }))}
                    style={{
                      flex:1, padding:"12px 0", borderRadius:10, border:"none", cursor:"pointer",
                      background: (sched.bibsEnabled ?? true) === val ? "var(--gold)" : "var(--s3)",
                      color:      (sched.bibsEnabled ?? true) === val ? "#000" : "var(--t2)",
                      fontFamily:"var(--font-display)", fontSize:14, letterSpacing:"0.06em",
                    }}
                  >
                    {val ? "YES" : "NO"}
                  </button>
                ))}
              </div>
            </div>

            {/* Invites open */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div>
                <div style={LABEL}>INVITES OPEN DAY</div>
                <div style={{ position:"relative" }}>
                  <select
                    value={sched.opensDay}
                    onChange={e => setSched(s => ({ ...s, opensDay: e.target.value }))}
                    style={{
                      ...BASE_INPUT, border:"1px solid var(--s3)",
                      appearance:"none", WebkitAppearance:"none", paddingRight:30, cursor:"pointer",
                    }}
                  >
                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                    color:"var(--t2)", pointerEvents:"none", fontSize:12 }}>▾</div>
                </div>
              </div>
              <div>
                <div style={LABEL}>INVITES OPEN TIME</div>
                <div style={{ position:"relative" }}>
                  <select
                    value={sched.opensTime}
                    onChange={e => setSched(s => ({ ...s, opensTime: e.target.value }))}
                    style={{
                      ...BASE_INPUT, border:"1px solid var(--s3)",
                      appearance:"none", WebkitAppearance:"none", paddingRight:30, cursor:"pointer",
                    }}
                  >
                    {OPEN_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                    color:"var(--t2)", pointerEvents:"none", fontSize:12 }}>▾</div>
                </div>
              </div>
            </div>
            <div style={{ fontSize:11, color:"var(--gold)", fontWeight:300, marginTop:6, marginBottom:16 }}>
              Game auto-opens for players on {sched.opensDay} at {sched.opensTime}
            </div>

            {/* Priority lead */}
            <FSelect
              label="PRIORITY LEAD (MINS)"
              value={String(sched.priorityLeadMins)}
              onChange={v => setSched(s => ({ ...s, priorityLeadMins: parseInt(v) }))}
              helper="Priority players notified this many minutes before everyone else"
            >
              {PRIORITY_LEADS.map(n => <option key={n} value={n}>{n}</option>)}
            </FSelect>

            {/* Game is live toggle */}
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:14, background:"var(--s2)", borderRadius:10,
              border:"1px solid var(--s3)", marginBottom:24,
            }}>
              <div>
                <div style={{ fontSize:14, color:"var(--t1)", fontWeight:300 }}>
                  Game Is Live This Week
                </div>
                <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginTop:2 }}>
                  Players can confirm availability now
                </div>
              </div>
              <Toggle
                on={sched.gameIsLive}
                onChange={() => setSched(s => ({ ...s, gameIsLive: !s.gameIsLive }))}
                color="var(--green)"
              />
            </div>

            {/* Notifications */}
            <div style={{ marginBottom:24 }}>
              <div style={LABEL}>NOTIFICATIONS</div>

              {/* Quiet hours */}
              <div style={{
                background:"var(--s2)", borderRadius:10, padding:14,
                border:"1px solid var(--s3)", marginBottom:8,
              }}>
                <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300,
                  letterSpacing:"0.08em", marginBottom:12 }}>
                  QUIET HOURS
                </div>
                <div style={{ display:"flex", gap:12 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginBottom:4 }}>FROM</div>
                    <div style={{ position:"relative" }}>
                      <select
                        value={reminders.quietStart}
                        onChange={e => setReminders(r => ({ ...r, quietStart: e.target.value }))}
                        style={{
                          ...BASE_INPUT, border:"1px solid var(--s3)",
                          appearance:"none", WebkitAppearance:"none", paddingRight:30, cursor:"pointer",
                        }}
                      >
                        {QUIET_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                        color:"var(--t2)", pointerEvents:"none", fontSize:12 }}>▾</div>
                    </div>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginBottom:4 }}>TO</div>
                    <div style={{ position:"relative" }}>
                      <select
                        value={reminders.quietEnd}
                        onChange={e => setReminders(r => ({ ...r, quietEnd: e.target.value }))}
                        style={{
                          ...BASE_INPUT, border:"1px solid var(--s3)",
                          appearance:"none", WebkitAppearance:"none", paddingRight:30, cursor:"pointer",
                        }}
                      >
                        {QUIET_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                        color:"var(--t2)", pointerEvents:"none", fontSize:12 }}>▾</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-trigger toggles */}
              {NOTIFICATION_TOGGLES.map(({ key, label, sub }) => (
                <div key={key} style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:14, background:"var(--s2)", borderRadius:10,
                  border:"1px solid var(--s3)", marginBottom:8,
                }}>
                  <div style={{ flex:1, paddingRight:16 }}>
                    <div style={{ fontSize:14, color:"var(--t1)", fontWeight:300 }}>{label}</div>
                    <div style={{ fontSize:12, color:"var(--t2)", fontWeight:300, marginTop:2 }}>{sub}</div>
                  </div>
                  <Toggle
                    on={reminders.triggers?.[key] !== false}
                    onChange={() => setReminders(r => ({
                      ...r,
                      triggers: { ...r.triggers, [key]: r.triggers?.[key] !== false ? false : true },
                    }))}
                    color="var(--green)"
                  />
                </div>
              ))}
            </div>

        {/* ── SAVE ── */}
        {saveStatus === "error" && (
          <div style={{
            padding:"10px 14px", borderRadius:10, marginBottom:12,
            background:"rgba(255,64,64,0.08)", border:"1px solid rgba(255,64,64,0.3)",
            fontSize:12, color:"var(--red)", fontWeight:300,
          }}>
            Save failed — try again
          </div>
        )}
        <button
          onClick={save}
          disabled={saving}
          style={{
            width:"100%", padding:16, borderRadius:12, border:"none",
            background: saveStatus === "ok" ? "var(--green)" : "var(--gold)",
            color: "#000",
            fontFamily:"var(--font-display)", fontSize:18, letterSpacing:"0.06em",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "SAVING..." : saveStatus === "ok" ? "SAVED ✓" : "SAVE MATCH SETTINGS"}
        </button>

      </div>
    </div>
  );
}
