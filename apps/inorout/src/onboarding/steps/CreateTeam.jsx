import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin } from "@phosphor-icons/react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";

// ── Static option data ─────────────────────────────────────────────────────────

const KICKOFF_TIMES = (() => {
  const out = [];
  for (let h = 6; h <= 23; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 23 && m > 45) break;
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

const SQUAD_SIZES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22];

// ── Base styles (defined outside component — stable references) ────────────────

const BASE_INPUT = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid var(--s3)",
  background: "var(--s2)",
  color: "var(--t1)",
  fontFamily: "var(--font-body)",
  fontWeight: 300,
  fontSize: 15,
  outline: "none",
  boxSizing: "border-box",
  WebkitAppearance: "none",
  appearance: "none",
};

const FOCUS_BORDER = { border: "1px solid var(--goldb)" };

// ── Field wrapper ──────────────────────────────────────────────────────────────

function Field({ label, children, error }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 11,
        color: "var(--t2)", letterSpacing: "0.08em", marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
      {error && (
        <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6, fontWeight: 300 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Focusable input ────────────────────────────────────────────────────────────

function FInput({ type = "text", value, onChange, placeholder, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      style={{ ...BASE_INPUT, ...(focused ? FOCUS_BORDER : {}) }}
      {...rest}
    />
  );
}

// ── Focusable select ───────────────────────────────────────────────────────────

function FSelect({ value, onChange, children }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...BASE_INPUT, cursor: "pointer", paddingRight: 32, ...(focused ? FOCUS_BORDER : {}) }}
      >
        {children}
      </select>
      <span style={{
        position: "absolute", right: 12, top: "50%",
        transform: "translateY(-50%)",
        color: "var(--t2)", fontSize: 11, pointerEvents: "none",
      }}>
        ▾
      </span>
    </div>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ current, total }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < current ? "var(--gold)" : "var(--s3)",
          }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)", fontWeight: 300 }}>
        Step {current} of {total}
      </div>
    </div>
  );
}

// ── Venue suggestion row ───────────────────────────────────────────────────────

function SuggestionRow({ name, sub, isLast, onSelect }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "10px 14px",
        cursor: "pointer",
        background: hovered ? "var(--s3)" : "transparent",
        borderBottom: isLast ? "none" : "1px solid var(--s3)",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--t1)", fontWeight: 300 }}>{name}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Venue + city autocomplete ──────────────────────────────────────────────────

function VenueField({ venue, setVenue, city, setCity }) {
  const [text, setText] = useState(venue || "");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [cityAuto, setCityAuto] = useState("");
  const [showCityInput, setShowCityInput] = useState(true);
  const debounceRef = useRef(null);

  const fetchSuggestions = useCallback(async (q) => {
    if (q.length < 3) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=gb&format=json&limit=6&addressdetails=1`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      const data = await res.json();
      setSuggestions(Array.isArray(data) ? data : []);
    } catch {
      // Timeout or network error — silent fallback to plain text
      setSuggestions([]);
    }
  }, []);

  const onInput = (e) => {
    const val = e.target.value;
    setText(val);
    setVenue(val);
    setCityAuto("");
    setShowCityInput(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 400);
  };

  const onSelect = (result) => {
    const addr = result.address || {};
    const name = result.name || result.display_name.split(",")[0].trim();
    const cityVal = addr.city || addr.town || addr.village || addr.hamlet || "";
    const shortVenue = cityVal ? `${name}, ${cityVal}` : name;
    setText(shortVenue);
    setVenue(shortVenue);
    setCity(cityVal);
    setCityAuto(cityVal);
    setShowCityInput(!cityVal);
    setSuggestions([]);
  };

  return (
    <>
      <Field label="VENUE">
        <div style={{ position: "relative" }}>
          <input
            value={text}
            onChange={onInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="e.g. Powerleague Salford"
            style={{ ...BASE_INPUT, ...(focused ? FOCUS_BORDER : {}) }}
          />
          {focused && suggestions.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
              background: "var(--s2)", border: "1px solid var(--goldb)",
              borderRadius: 10, overflow: "hidden",
            }}>
              {suggestions.map((r, i) => {
                const addr = r.address || {};
                const name = r.name || r.display_name.split(",")[0].trim();
                const sub  = addr.city || addr.town || addr.village || "";
                return (
                  <SuggestionRow
                    key={r.place_id || i}
                    name={name}
                    sub={sub}
                    isLast={i === suggestions.length - 1}
                    onSelect={() => onSelect(r)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {!showCityInput && cityAuto && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <MapPin size={11} weight="thin" color="var(--t2)" />
            <span style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300 }}>{cityAuto}</span>
            <span style={{ fontSize: 11, color: "var(--t2)", opacity: 0.4 }}>·</span>
            <button
              type="button"
              onClick={() => setShowCityInput(true)}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: 11, color: "var(--t2)", fontWeight: 300, textDecoration: "underline",
              }}
            >
              change
            </button>
          </div>
        )}
      </Field>

      {showCityInput && (
        <Field label="CITY / TOWN">
          <FInput
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder="e.g. Coventry"
          />
        </Field>
      )}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CreateTeam({
  groupName,      setGroupName,
  dayOfWeek,      setDayOfWeek,
  kickoff,        setKickoff,
  venue,          setVenue,
  city,           setCity,
  squadSize,      setSquadSize,
  pricePerPlayer, setPricePerPlayer,
  bibsEnabled,    setBibsEnabled,
  adminEmail,     setAdminEmail,
  onSubmit, loading, error,
}) {
  const [priceDisplay,   setPriceDisplay]   = useState("");
  const [priceError,     setPriceError]     = useState(null);
  const [priceZeroAck,   setPriceZeroAck]   = useState(false);
  const [emailError,     setEmailError]     = useState(null);

  // Clear inherited default price on mount so the field starts empty
  useEffect(() => {
    setPricePerPlayer(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePriceChange = (e) => {
    const val = e.target.value;
    setPriceDisplay(val);
    setPriceError(null);
    if (val === "") {
      setPricePerPlayer(null);
    } else {
      const n = parseFloat(val);
      if (!isNaN(n)) setPricePerPlayer(n);
    }
  };

  const handleSubmit = () => {
    if (priceDisplay === "") {
      setPriceError("Please enter a price — use 0 if your game is free");
      return;
    }
    if (priceDisplay === "0" && !priceZeroAck) {
      setPriceError("Please enter a price — use 0 if your game is free");
      setPriceZeroAck(true);
      return;
    }
    if (!adminEmail?.trim()) {
      setEmailError("Please enter your email address");
      return;
    }
    setEmailError(null);
    setPriceError(null);
    onSubmit();
  };

  const nameValid = groupName.trim().length > 0;

  return (
    <div style={{ padding: 24, paddingBottom: 48, fontFamily: "var(--font-body)" }}>

      <ProgressBar current={1} total={3} />

      {/* Brand header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 32,
          letterSpacing: "0.06em", lineHeight: 1, marginBottom: 8,
        }}>
          <span style={{ color: "var(--green)" }}>IN</span>
          <span style={{ color: "var(--t1)" }}> OR </span>
          <span style={{ color: "var(--red)" }}>OUT</span>
        </div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 20, color: "var(--t1)",
          letterSpacing: "0.06em", marginBottom: 10,
        }}>
          SET UP YOUR SQUAD
        </div>
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5 }}>
          This takes a few minutes — and it's the most you'll ever do.
          Once your squad is set up, managing the game takes seconds each week.
        </div>
      </div>

      {/* Squad name */}
      <Field label="SQUAD NAME">
        <FInput
          value={groupName}
          onChange={e => setGroupName(e.target.value)}
          placeholder="e.g. Finbar's Tuesdays"
        />
      </Field>

      {/* Game day + kickoff */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="GAME DAY">
          <FSelect value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)}>
            {CFG.daysOfWeek.map(d => <option key={d} value={d}>{d}</option>)}
          </FSelect>
        </Field>
        <Field label="KICK OFF">
          <FSelect value={kickoff} onChange={e => setKickoff(e.target.value)}>
            {KICKOFF_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </FSelect>
        </Field>
      </div>

      {/* Players needed */}
      <Field label="PLAYERS NEEDED">
        <FSelect value={squadSize} onChange={e => setSquadSize(parseInt(e.target.value))}>
          {SQUAD_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </FSelect>
      </Field>

      {/* Venue + city autocomplete */}
      <VenueField venue={venue} setVenue={setVenue} city={city} setCity={setCity} />

      {/* Price */}
      <Field label="PRICE PER PLAYER (£)" error={priceError}>
        <FInput
          type="number"
          min={0}
          step={0.5}
          value={priceDisplay}
          onChange={handlePriceChange}
          placeholder="e.g. 6"
        />
      </Field>

      {/* Bibs */}
      <Field label="DOES YOUR GAME USE BIBS?">
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setBibsEnabled(true)}
            style={{
              flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer",
              fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "0.06em",
              outline: "none",
              background: bibsEnabled ? "var(--gold)" : "var(--s2)",
              color:      bibsEnabled ? "#000"       : "var(--t2)",
              border:     bibsEnabled ? "none"       : "1px solid var(--s3)",
            }}
          >
            YES
          </button>
          <button
            type="button"
            onClick={() => setBibsEnabled(false)}
            style={{
              flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer",
              fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "0.06em",
              outline: "none",
              background: !bibsEnabled ? "var(--s3)" : "var(--s2)",
              color:      !bibsEnabled ? "var(--t1)" : "var(--t2)",
              border:     !bibsEnabled ? "1px solid var(--t2)" : "1px solid var(--s3)",
            }}
          >
            NO
          </button>
        </div>
      </Field>

      {/* Admin email */}
      <Field label="YOUR EMAIL" error={emailError}>
        <FInput
          type="email"
          value={adminEmail || ""}
          onChange={e => { setAdminEmail(e.target.value); setEmailError(null); }}
          placeholder="e.g. tarny@gmail.com"
        />
        <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 6, fontWeight: 300 }}>
          For your admin link backup — we won't spam you
        </div>
      </Field>

      {/* Global server error */}
      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 16,
          background: "rgba(255,64,64,0.08)", border: "1px solid rgba(255,64,64,0.3)",
          fontSize: 13, color: "var(--red)", fontWeight: 300,
        }}>
          {error}
        </div>
      )}

      {/* Helper */}
      <div style={{
        fontSize: 12, color: "var(--t2)", textAlign: "center",
        marginBottom: 12, fontWeight: 300, lineHeight: 1.5,
      }}>
        Squad name, kickoff time and price can all be updated later under Admin → Match Settings
      </div>

      {/* CTA */}
      <button
        onClick={handleSubmit}
        disabled={loading || !nameValid}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: "none",
          background: nameValid ? "var(--gold)" : "var(--s3)",
          color:      nameValid ? "#000"       : "var(--t2)",
          fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.06em",
          cursor: loading || !nameValid ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Creating..." : "Create Team →"}
      </button>
    </div>
  );
}
