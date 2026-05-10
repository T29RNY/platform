import { useState } from "react";
import { colors as C } from "@platform/core";
import { BackBtn, Btn, FieldRow, Toggle } from "@platform/ui";

export default function ScheduleScreen({ schedule, setSchedule, settings, setSettings, onBack }) {
  const [sched,     setSched]     = useState(schedule);
  const [groupName, setGroupName] = useState(settings.groupName);

  const save = () => {
    setSchedule(sched);
    setSettings({ ...settings, groupName });
    onBack();
  };

  return (
    <div style={{ padding:18 }}>
      <BackBtn onClick={onBack}/>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.amber, letterSpacing:2, marginBottom:4 }}>
        SETTINGS & SCHEDULE
      </div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, marginBottom:20 }}>
        Set once — auto-opens every week.
      </div>

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

      <Btn label="Save Settings" color={C.amber} fill onClick={save}/>
    </div>
  );
}
