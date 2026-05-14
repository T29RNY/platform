import { useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { Toggle } from "@platform/ui";
import { upsertSchedule } from "@platform/supabase";

const DEFAULT_REMINDERS = {
  quietStart: "22:00",
  quietEnd:   "08:00",
  triggers: {
    gameLive:true, squadFull:true, spotOpened:true,
    gameCancelled:true, gameDay9am:true, oneHrBefore:true,
    debtReminder:true, bibs24hr:true, bibs45min:true,
  },
};

const TRIGGER_LABELS = [
  { key:"gameLive",      label:"⚽ Game open — notify all players" },
  { key:"squadFull",     label:"🔒 Squad full — notify remaining players" },
  { key:"spotOpened",    label:"🟣 Spot opened — notify reserve list" },
  { key:"gameCancelled", label:"❌ Game cancelled — notify IN players" },
  { key:"gameDay9am",    label:"☀️ Game day 9am reminder (IN players)" },
  { key:"oneHrBefore",   label:"🕐 1hr before kickoff — unpaid players" },
  { key:"debtReminder",  label:"💸 24hrs after game — unpaid players" },
  { key:"bibs24hr",      label:"🧺 Bibs reminder — 24hrs before" },
  { key:"bibs45min",     label:"👕 Bibs reminder — 45 mins before" },
];

const LABEL = {
  fontFamily:"var(--font-display)", fontSize:11, color:"var(--t2)",
  letterSpacing:"0.08em", marginBottom:6, display:"block",
};

export default function RemindersScreen({ schedule, setSchedule, onBack, teamId }) {
  const [reminders,  setReminders]  = useState(schedule.remindersConfig || DEFAULT_REMINDERS);
  const [saving,     setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const setTrigger = (key, val) =>
    setReminders(r => ({ ...r, triggers: { ...r.triggers, [key]: val } }));

  const save = async () => {
    setSaving(true);
    try {
      const updated = { ...schedule, remindersConfig: reminders };
      if (teamId) await upsertSchedule(updated, teamId);
      setSchedule(updated);
      setSaveStatus("ok");
      setTimeout(() => { setSaveStatus(null); onBack(); }, 800);
    } catch (_) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)",
      fontFamily:"var(--font-body)", paddingBottom:80 }}>

      {/* Header */}
      <div style={{ padding:"16px 18px 0", display:"flex", alignItems:"center",
        gap:12, marginBottom:24 }}>
        <div onClick={onBack} style={{ cursor:"pointer", color:"var(--gold)",
          display:"flex", alignItems:"center", WebkitTapHighlightColor:"transparent" }}>
          <ArrowLeft size={20} weight="thin"/>
        </div>
        <div style={{ fontFamily:"var(--font-display)", fontSize:28, color:"var(--gold)",
          letterSpacing:"0.06em" }}>
          REMINDERS
        </div>
      </div>

      <div style={{ padding:"0 18px" }}>

        {/* Quiet hours */}
        <div style={{ background:"var(--s2)", border:"1px solid var(--s3)",
          borderRadius:10, padding:"14px 16px", marginBottom:16 }}>
          <div style={{ ...LABEL, marginBottom:12 }}>
            🌙 QUIET HOURS — NO NOTIFICATIONS SENT
          </div>
          <div style={{ display:"flex", gap:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginBottom:6 }}>From</div>
              <input type="time" value={reminders.quietStart}
                onChange={e => setReminders(r => ({ ...r, quietStart: e.target.value }))}
                style={{
                  width:"100%", padding:"10px 12px", borderRadius:10,
                  border:"1px solid var(--s3)", background:"var(--s1)", color:"var(--t1)",
                  fontFamily:"var(--font-body)", fontSize:14, outline:"none",
                  boxSizing:"border-box", colorScheme:"dark",
                }}/>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginBottom:6 }}>To</div>
              <input type="time" value={reminders.quietEnd}
                onChange={e => setReminders(r => ({ ...r, quietEnd: e.target.value }))}
                style={{
                  width:"100%", padding:"10px 12px", borderRadius:10,
                  border:"1px solid var(--s3)", background:"var(--s1)", color:"var(--t1)",
                  fontFamily:"var(--font-body)", fontSize:14, outline:"none",
                  boxSizing:"border-box", colorScheme:"dark",
                }}/>
            </div>
          </div>
          <div style={{ fontSize:11, color:"var(--t2)", fontWeight:300, marginTop:10 }}>
            Notifications triggered during quiet hours are queued and sent at {reminders.quietEnd}.
          </div>
        </div>

        {/* Trigger toggles */}
        <div style={{ ...LABEL, marginBottom:12 }}>NOTIFICATION TRIGGERS</div>
        <div style={{ background:"var(--s2)", borderRadius:10, border:"1px solid var(--s3)",
          overflow:"hidden", marginBottom:24 }}>
          {TRIGGER_LABELS.map(({ key, label }, i) => (
            <div key={key} style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"14px 16px",
              borderBottom: i < TRIGGER_LABELS.length - 1 ? "1px solid var(--s3)" : "none",
            }}>
              <span style={{ fontSize:14, color:"var(--t1)", fontWeight:300, flex:1, paddingRight:12 }}>
                {label}
              </span>
              <Toggle
                on={reminders.triggers?.[key] !== false}
                onChange={() => setTrigger(key, reminders.triggers?.[key] === false)}
                color="var(--green)"
              />
            </div>
          ))}
        </div>

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
          {saving ? "SAVING..." : saveStatus === "ok" ? "SAVED ✓" : "SAVE REMINDERS"}
        </button>

      </div>
    </div>
  );
}
