import { colors as C } from "@platform/core";
import { ONBOARDING_CONFIG as CFG } from "../config.js";

export default function CreateTeam({
  groupName, setGroupName,
  dayOfWeek, setDayOfWeek,
  kickoff,   setKickoff,
  venue,     setVenue,
  squadSize, setSquadSize,
  pricePerPlayer, setPricePerPlayer,
  onSubmit, loading, error,
}) {
  const Field = ({ label, children }) => (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
        color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>
        {label}
      </div>
      {children}
    </div>
  );

  const Input = ({ value, onChange, placeholder, type="text" }) => (
    <input type={type} value={value} onChange={e=>onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width:"100%", padding:"12px 14px", borderRadius:6,
        border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
        fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500,
        outline:"none", boxSizing:"border-box" }}/>
  );

  return (
    <div style={{ padding:24, fontFamily:"Inter,sans-serif" }}>
      {/* Header */}
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

      {/* Form */}
      <Field label="Team / Group Name *">
        <Input value={groupName} onChange={setGroupName}
          placeholder="e.g. Finbar's Tuesdays"/>
      </Field>

      <Field label="Game Day">
        <select value={dayOfWeek} onChange={e=>setDayOfWeek(e.target.value)}
          style={{ width:"100%", padding:"12px 14px", borderRadius:6,
            border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
            fontFamily:"Inter,sans-serif", fontSize:14, outline:"none",
            boxSizing:"border-box" }}>
          {CFG.daysOfWeek.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </Field>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <Field label="Kick Off">
          <Input value={kickoff} onChange={setKickoff} placeholder="19:00" type="time"/>
        </Field>
        <Field label="Players Needed">
          <Input value={String(squadSize)} onChange={v=>setSquadSize(parseInt(v)||14)}
            placeholder="14" type="number"/>
        </Field>
      </div>

      <Field label="Venue">
        <Input value={venue} onChange={setVenue} placeholder="e.g. Powerleague Salford"/>
      </Field>

      <Field label="Price Per Player (£)">
        <Input value={String(pricePerPlayer)}
          onChange={v=>setPricePerPlayer(parseFloat(v)||0)}
          placeholder="6" type="number"/>
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
