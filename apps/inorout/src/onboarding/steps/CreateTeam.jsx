import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, CaretLeft, CaretRight } from "@phosphor-icons/react";
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

// ── Base styles ────────────────────────────────────────────────────────────────

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
  const controllerRef = useRef(null);

  // Cleanup debounce + in-flight fetch on unmount (step navigation)
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, []);

  const fetchSuggestions = useCallback(async (q) => {
    if (q.length < 3) { setSuggestions([]); return; }
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
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

// ── Wizard shell ───────────────────────────────────────────────────────────────

function WizardShell({ subStep, goBack, onContinue, continueLabel = "Continue →", continueDisabled = false, children }) {
  return (
    <div style={{
      padding: "calc(24px + env(safe-area-inset-top)) 24px calc(48px + env(safe-area-inset-bottom))",
      fontFamily: "var(--font-body)", minHeight: "100dvh",
      boxSizing: "border-box", display: "flex", flexDirection: "column",
    }}>
      {subStep > 1 && (
        <button
          type="button"
          onClick={goBack}
          style={{
            background: "none", border: "none", padding: "0 0 16px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
            color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)", fontWeight: 300,
          }}
        >
          <CaretLeft size={16} weight="thin" />
          Back
        </button>
      )}

      <ProgressBar current={subStep} total={6} />

      <div style={{ flex: 1 }}>
        {children}
      </div>

      <button
        type="button"
        onClick={onContinue}
        disabled={continueDisabled}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: "none", marginTop: 16,
          background: !continueDisabled ? "var(--gold)" : "var(--s3)",
          color: !continueDisabled ? "var(--bg)" : "var(--t2)",
          fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.06em",
          cursor: continueDisabled ? "not-allowed" : "pointer",
        }}
      >
        {continueLabel}
      </button>
    </div>
  );
}

// ── Step title block ───────────────────────────────────────────────────────────

function StepTitle({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 20, color: "var(--t1)",
        letterSpacing: "0.06em", marginBottom: 8,
      }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CreateTeam({
  groupName, setGroupName,
  dayOfWeek, setDayOfWeek,
  kickoff, setKickoff,
  venue, setVenue,
  city, setCity,
  squadSize, setSquadSize,
  pricePerPlayer, setPricePerPlayer,
  bibsEnabled, setBibsEnabled,
  adminEmail, setAdminEmail,
  onSubmit, loading, error,
  subStep, goNext, goBack, goToSubStep,
}) {
  const [priceDisplay, setPriceDisplay] = useState("");
  const [priceError, setPriceError] = useState(null);

  // Clear inherited default price on mount so the field starts empty
  useEffect(() => {
    setPricePerPlayer(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nameValid = groupName.trim().length > 0;

  // ── Step 1: Squad name ─────────────────────────────────────────────────────

  if (subStep === 1) {
    return (
      <WizardShell
        subStep={1}
        goBack={goBack}
        onContinue={goNext}
        continueDisabled={!nameValid}
      >
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
            Takes 2 minutes. Once you're set up, managing the game takes seconds each week.
          </div>
        </div>
        <Field label="WHAT'S YOUR SQUAD CALLED?">
          <FInput
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            placeholder="e.g. Finbar's Tuesdays"
          />
        </Field>
      </WizardShell>
    );
  }

  // ── Step 2: Game day + kickoff ─────────────────────────────────────────────

  if (subStep === 2) {
    return (
      <WizardShell subStep={2} goBack={goBack} onContinue={goNext}>
        <StepTitle
          title="WHEN DO YOU PLAY?"
          subtitle="You can change this later under Admin → Match Settings"
        />
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
      </WizardShell>
    );
  }

  // ── Step 3: Players needed ─────────────────────────────────────────────────

  if (subStep === 3) {
    return (
      <WizardShell subStep={3} goBack={goBack} onContinue={goNext}>
        <StepTitle
          title="HOW MANY PLAYERS?"
          subtitle="You can change this later under Admin → Match Settings"
        />
        <Field label="PLAYERS NEEDED">
          <FSelect value={squadSize} onChange={e => setSquadSize(parseInt(e.target.value))}>
            {SQUAD_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </FSelect>
        </Field>
      </WizardShell>
    );
  }

  // ── Step 4: Venue + city (skippable) ──────────────────────────────────────

  if (subStep === 4) {
    return (
      <WizardShell subStep={4} goBack={goBack} onContinue={goNext}>
        <StepTitle
          title="WHERE DO YOU PLAY?"
          subtitle="You can add or change this later under Admin → Match Settings"
        />
        <VenueField venue={venue} setVenue={setVenue} city={city} setCity={setCity} />
        <button
          type="button"
          onClick={goNext}
          style={{
            background: "none", border: "none", padding: "8px 0", cursor: "pointer",
            fontSize: 13, color: "var(--t2)", fontWeight: 300,
            width: "100%", textAlign: "center", textDecoration: "underline",
          }}
        >
          Skip — add later
        </button>
      </WizardShell>
    );
  }

  // ── Step 5: Price ──────────────────────────────────────────────────────────

  if (subStep === 5) {
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

    const handlePriceNext = () => {
      if (priceDisplay === "") {
        setPriceError("Enter a price, or tap No charge");
        return;
      }
      const n = parseFloat(priceDisplay);
      if (isNaN(n) || n < 0) {
        setPriceError("Enter a valid price (e.g. 6), or tap No charge");
        return;
      }
      setPriceError(null);
      goNext();
    };

    const handleNoCharge = () => {
      setPriceDisplay("");
      setPricePerPlayer(0);
      setPriceError(null);
      goNext();
    };

    return (
      <WizardShell subStep={5} goBack={goBack} onContinue={handlePriceNext}>
        <StepTitle
          title="WHAT'S THE PRICE?"
          subtitle="You can change this later under Admin → Match Settings"
        />
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
        <button
          type="button"
          onClick={handleNoCharge}
          style={{
            width: "100%", padding: "12px 0", borderRadius: 10, cursor: "pointer",
            background: "var(--s2)", border: "1px solid var(--s3)",
            color: "var(--t2)", fontSize: 14, fontFamily: "var(--font-body)",
            fontWeight: 300, marginTop: 4,
          }}
        >
          No charge
        </button>
      </WizardShell>
    );
  }

  // ── Step 6: Bibs ──────────────────────────────────────────────────────────

  if (subStep === 6) {
    return (
      <WizardShell subStep={6} goBack={goBack} onContinue={goNext}>
        <StepTitle
          title="DO YOU USE BIBS?"
          subtitle="You can change this later under Admin → Match Settings"
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setBibsEnabled(true)}
            style={{
              flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer",
              fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "0.06em",
              outline: "none",
              background: bibsEnabled ? "var(--gold)" : "var(--s2)",
              color:      bibsEnabled ? "var(--bg)" : "var(--t2)",
              border:     bibsEnabled ? "none" : "1px solid var(--s3)",
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
      </WizardShell>
    );
  }

  // ── Review & create (subStep 7) ────────────────────────────────────────────

  const displayPrice = pricePerPlayer === 0
    ? "No charge"
    : pricePerPlayer != null
      ? `£${pricePerPlayer}`
      : "Not set";

  const reviewRows = [
    { label: "SQUAD NAME",      value: groupName || "—",            step: 1 },
    { label: "GAME DAY",        value: `${dayOfWeek} at ${kickoff}`, step: 2 },
    { label: "PLAYERS NEEDED",  value: `${squadSize} players`,       step: 3 },
    { label: "VENUE",           value: venue || "Not set",           step: 4 },
    { label: "PRICE",           value: displayPrice,                 step: 5 },
    { label: "BIBS",            value: bibsEnabled ? "Yes" : "No",  step: 6 },
  ];

  return (
    <div style={{
      padding: "calc(24px + env(safe-area-inset-top)) 24px calc(48px + env(safe-area-inset-bottom))",
      fontFamily: "var(--font-body)", minHeight: "100dvh",
      boxSizing: "border-box", display: "flex", flexDirection: "column",
    }}>
      <button
        type="button"
        onClick={goBack}
        style={{
          background: "none", border: "none", padding: "0 0 16px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
          color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)", fontWeight: 300,
        }}
      >
        <CaretLeft size={16} weight="thin" />
        Back
      </button>

      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 20, color: "var(--t1)",
          letterSpacing: "0.06em", marginBottom: 8,
        }}>
          REVIEW & CREATE
        </div>
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300 }}>
          Everything look right? Tap any row to edit.
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {reviewRows.map(({ label, value, step }) => (
          <button
            key={label}
            type="button"
            onClick={() => goToSubStep(step)}
            style={{
              width: "100%", background: "none", border: "none", padding: "12px 0",
              borderBottom: "1px solid var(--s3)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              textAlign: "left",
            }}
          >
            <div>
              <div style={{
                fontSize: 11, color: "var(--t2)", fontFamily: "var(--font-display)",
                letterSpacing: "0.08em", marginBottom: 3,
              }}>
                {label}
              </div>
              <div style={{ fontSize: 15, color: "var(--t1)", fontWeight: 300 }}>{value}</div>
            </div>
            <CaretRight size={14} weight="thin" style={{ color: "var(--t2)", flexShrink: 0, marginLeft: 8 }} />
          </button>
        ))}

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, marginTop: 16,
            background: "rgba(255,64,64,0.08)", border: "1px solid rgba(255,64,64,0.3)",
            fontSize: 13, color: "var(--red)", fontWeight: 300,
          }}>
            {error}
          </div>
        )}

        <div style={{
          fontSize: 12, color: "var(--t2)", textAlign: "center",
          margin: "16px 0", fontWeight: 300, lineHeight: 1.5,
        }}>
          Squad name, kickoff time and price can all be updated later under Admin → Match Settings
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={loading}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: "none", marginTop: 16,
          background: "var(--gold)", color: "var(--bg)",
          fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.06em",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Creating..." : "Create my squad →"}
      </button>
    </div>
  );
}
