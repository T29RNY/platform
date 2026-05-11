import { useState } from "react";
import { colors as C } from "@platform/core";
import { BackBtn, Btn, FieldRow, Toggle } from "@platform/ui";

const DEFAULT_REMINDERS = {
  quietStart: "22:00",
  quietEnd:   "08:00",
  triggers: {
    gameLive:      true,
    squadFull:     true,
    spotOpened:    true,
    gameCancelled: true,
    gameDay9am:    true,
    oneHrBefore:   true,
    debtReminder:  true,
    bibs24hr:      true,
    bibs45min:     true,
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

export default function ScheduleScreen({ schedule, setSchedule, settings, setSettings, onBack }) {
  const [tab,       setTab]       = useState("schedule");
  const [sched,     setSched]     = useState(schedule);
  const [groupName, setGroupName] = useState(settings.groupName);
  const [reminders, setReminders] = useState(
    schedule.remindersConfig || DEFAULT_REMINDERS
  );

  const save = () => {
    setSchedule({ ...sched, remindersConfig: reminders });
    setSettings({ ...settings, groupName });
    onBack();
  };

  const setTrigger = (key, val) =>
    setReminders(r => ({ ...r, triggers: { ...r.triggers, [key]: val } }));

  return (
    <div style={{ padding:18 }}>
      <BackBtn onClick={onBack}/>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber,
        letterSpacing:2, marginBottom:20 }}>SETTINGS & SCHEDULE</div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:4, marginBottom:20, background:C.surface,
        padding:4, borderRadius:8, border:`1px solid ${C.border}` }}>
        {["schedule","reminders"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex:1, padding:"9px 0", borderRadius:6, border:"none",
            background:tab===t?C.amber+"18":"transparent",
            color:tab===t?C.amber:C.muted,
            fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700,
            letterSpacing:0.5, textTransform:"uppercase", cursor:"pointer" }}>
            {t==="schedule" ? "⚙️ Schedule" : "🔔 Reminders"}
          </button>
        ))}
      </div>

      {tab === "schedule" && (
        <>
          <FieldRow label="Group Name"           value={groupName}               onChange={setGroupName}                   placeholder="e.g. Finbar's Tuesdays"/>
          <FieldRow label="Game Day"             value={sched.dayOfWeek}         onChange={v=>setSched(s=>({...s,dayOfWeek:v}))}       placeholder="e.g. Tuesday"/>
          <FieldRow label="Kick Off Time"        value={sched.kickoff}           onChange={v=>setSched(s=>({...s,kickoff:v}))}         placeholder="e.g. 19:00"/>
          <FieldRow label="Venue"                value={sched.venue}             onChange={v=>setSched(s=>({...s,venue:v}))}           placeholder="e.g. Powerleague Salford"/>
          <FieldRow label="Players Needed"       value={String(sched.squadSize)} onChange={v=>setSched(s=>({...s,squadSize:parseInt(v)||14}))} placeholder="e.g. 14"/>
          <FieldRow label="Price Per Player (£)" value={String(sched.pricePerPlayer)} onChange={v=>setSched(s=>({...s,pricePerPlayer:parseFloat(v)||0}))} placeholder="e.g. 6"/>

          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700, color:C.muted,
            letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Game Date & Time</div>
          <input type="datetime-local" value={sched.gameDateTime||""}
            onChange={e=>setSched(s=>({...s,gameDateTime:e.target.value}))}
            style={{ width:"100%", padding:"11px 13px", borderRadius:6,
              border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
              fontFamily:"Inter,sans-serif", fontSize:14, outline:"none",
              boxSizing:"border-box", marginBottom:14, colorScheme:"dark" }}/>

          <FieldRow label="Invites Open Day"     value={sched.opensDay}    onChange={v=>setSched(s=>({...s,opensDay:v}))}    placeholder="e.g. Wednesday"/>
          <FieldRow label="Invites Open Time"    value={sched.opensTime}   onChange={v=>setSched(s=>({...s,opensTime:v}))}   placeholder="e.g. 10:00"/>
          <FieldRow label="Priority Lead (mins)" value={String(sched.priorityLeadMins)} onChange={v=>setSched(s=>({...s,priorityLeadMins:parseInt(v)||0}))} placeholder="e.g. 60"/>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"14px", background:C.surface, borderRadius:6,
            border:`1px solid ${C.border}`, marginBottom:14 }}>
            <div>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:600, color:C.text }}>
                Game Is Live This Week
              </div>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginTop:2 }}>
                Players can confirm availability now
              </div>
            </div>
            <Toggle on={sched.gameIsLive} onChange={() => setSched(s=>({...s,gameIsLive:!s.gameIsLive}))} color={C.green}/>
          </div>

          <div style={{ padding:"12px 14px", background:C.purple+"0c", border:`1px solid ${C.purple}30`,
            borderRadius:6, marginBottom:22,
            fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:500, color:C.purple }}>
            ★ Priority players notified {sched.priorityLeadMins} mins before everyone else.
          </div>
        </>
      )}

      {tab === "reminders" && (
        <>
          {/* Quiet hours */}
          <div style={{ background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:8, padding:"14px 16px", marginBottom:16 }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
              color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>
              🌙 Quiet Hours — no notifications sent
            </div>
            <div style={{ display:"flex", gap:12, alignItems:"center" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted,
                  marginBottom:6 }}>From</div>
                <input type="time" value={reminders.quietStart}
                  onChange={e => setReminders(r => ({ ...r, quietStart: e.target.value }))}
                  style={{ width:"100%", padding:"10px 12px", borderRadius:6,
                    border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
                    fontFamily:"Inter,sans-serif", fontSize:14, outline:"none",
                    boxSizing:"border-box", colorScheme:"dark" }}/>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted,
                  marginBottom:6 }}>To</div>
                <input type="time" value={reminders.quietEnd}
                  onChange={e => setReminders(r => ({ ...r, quietEnd: e.target.value }))}
                  style={{ width:"100%", padding:"10px 12px", borderRadius:6,
                    border:`1.5px solid ${C.border}`, background:"#0a0a0a", color:C.text,
                    fontFamily:"Inter,sans-serif", fontSize:14, outline:"none",
                    boxSizing:"border-box", colorScheme:"dark" }}/>
              </div>
            </div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.faint,
              marginTop:10 }}>
              Notifications triggered during quiet hours are queued and sent at {reminders.quietEnd}.
            </div>
          </div>

          {/* Trigger toggles */}
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
            color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>
            Notification Triggers
          </div>
          {TRIGGER_LABELS.map(({ key, label }) => (
            <div key={key} style={{ display:"flex", alignItems:"center",
              justifyContent:"space-between", padding:"13px 0",
              borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontFamily:"Inter,sans-serif", fontSize:13,
                fontWeight:500, color:C.text, flex:1, paddingRight:12 }}>
                {label}
              </span>
              <Toggle
                on={reminders.triggers?.[key] !== false}
                onChange={() => setTrigger(key, reminders.triggers?.[key] === false)}
                color={C.green}
              />
            </div>
          ))}
          <div style={{ height:20 }}/>
        </>
      )}

      <Btn label="Save Settings" color={C.amber} fill onClick={save}/>
    </div>
  );
}
