import { colors as C } from "@platform/core";
import { ONBOARDING_CONFIG as CFG } from "../config.js";

// Defined OUTSIDE component to prevent recreation on every render
// This fixes the focus-loss-on-keystroke bug
const Field = ({ label, children }) => (
  <div style={{ marginBottom:16 }}>
    <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
      color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>
      {label}
    </div>
    {children}
  </div>
);

const inputStyle = {
  width:"100%", padding:"12px 14px", borderRadius:6,
  border:"1.5px solid #2a2a2a", background:"#0a0a0a", color:"#F3F0EA",
  fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500,
  outline:"none", boxSizing:"border-box",
};

export default function CreateTeam({
  groupName, setGroupName,
  dayOfWeek, setDayOfWeek,
  kickoff,   setKickoff,
  venue,     setVenue,
  city,      setCity,
  squadSize, setSquadSize,
  pricePerPlayer, setPricePerPlayer,
  onSubmit, loading, error,
}) {
  return (
    <div style={{ padding:24, fontFamily:"Inter,sans-serif" }}>
      <div style={{ marginBottom:32 }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:36,
          color:C.amber, letterSpacing:3, lineHeight:1 }}>IN OR OUT</div>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
          color:C.text, letterSpacing:1, marginTop:4 }}>
          {CFG.steps.createTeam.title}
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:6 }}>
          {CFG.steps.createTeam.subtitle}
        </div>
      </div>

      <Field label="Team / Group Name *">
        <input
          value={groupName}
          onChange={e => setGroupName(e.target.value)}
          placeholder="e.g. Finbar's Tuesdays"
          style={inputStyle}
        />
      </Field>

      <Field label="Game Day">
        <select value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)}
          style={{ ...inputStyle, cursor:"pointer" }}>
          {CFG.daysOfWeek.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <Field label="Kick Off">
          <input
            type="time"
            value={kickoff}
            onChange={e => setKickoff(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Players Needed">
          <input
            type="number"
            value={squadSize}
            onChange={e => setSquadSize(parseInt(e.target.value)||14)}
            placeholder="14"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Venue">
        <input
          value={venue}
          onChange={e => setVenue(e.target.value)}
          placeholder="e.g. Powerleague Salford"
          style={inputStyle}
        />
      </Field>
      <Field label="City">
        <input
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="e.g. Manchester"
          style={inputStyle}
        />
      </Field>

      <Field label="Price Per Player (£)">
        <input
          type="number"
          value={pricePerPlayer}
          onChange={e => setPricePerPlayer(parseFloat(e.target.value)||0)}
          placeholder="6"
          style={inputStyle}
        />
      </Field>

      {error && (
        <div style={{ padding:"10px 14px", borderRadius:6, background:C.red+"18",
          border:`1px solid ${C.red}44`, fontFamily:"Inter,sans-serif",
          fontSize:13, color:C.red, marginBottom:16 }}>
          {error}
        </div>
      )}

      <button onClick={onSubmit} disabled={loading || !groupName.trim()} style={{
        width:"100%", padding:"15px 0", borderRadius:6, border:"none",
        background: loading || !groupName.trim() ? "#2a2a2a" : C.amber,
        color: loading || !groupName.trim() ? C.muted : "#000",
        fontFamily:"Inter,sans-serif", fontSize:15, fontWeight:800,
        letterSpacing:0.5, cursor: loading || !groupName.trim() ? "not-allowed" : "pointer",
        marginTop:8,
      }}>
        {loading ? "Creating..." : CFG.steps.createTeam.cta}
      </button>

      <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted,
        textAlign:"center", marginTop:16, lineHeight:1.5 }}>
        No account needed · Free to start · Your data stays yours
      </div>
    </div>
  );
}
