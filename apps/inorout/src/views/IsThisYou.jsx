import { colors as C } from "@platform/core";

function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = email.split("@");
  const masked = local[0] + "***" + (local.length > 3 ? local.slice(-1) : "");
  return `${masked}@${domain}`;
}

function maskName(name) {
  if (!name) return "";
  const parts = name.trim().split(" ");
  return parts[0][0] + "***" + (parts.length > 1 ? " " + parts[1][0] + "." : "");
}

export default function IsThisYou({ matches, userEmail, onConfirm, onCreateNew }) {
  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif",
      display:"flex", flexDirection:"column" }}>

      <div style={{ padding:"24px 24px 20px", background:"#0f0f0f",
        borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28,
          color:C.amber, letterSpacing:3 }}>IN OR OUT</div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:4 }}>We found existing players with your name</div>
      </div>

      <div style={{ padding:24, flex:1 }}>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
          color:C.muted, marginBottom:24, lineHeight:1.6 }}>
          Are you one of these players? Tap to link your account and keep all your stats.
        </div>

        {matches.map(player => (
          <button key={player.id} onClick={() => onConfirm(player)}
            style={{ width:"100%", padding:"16px", borderRadius:8, marginBottom:10,
              border:`1.5px solid ${C.border}`, background:C.surface,
              color:C.text, textAlign:"left", cursor:"pointer",
              display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:40, height:40, borderRadius:"50%",
              background:C.amber+"20", border:`1.5px solid ${C.amber}`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:"Bebas Neue,sans-serif", fontSize:18, color:C.amber,
              flexShrink:0 }}>
              {player.name[0]}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:15,
                fontWeight:600, color:C.text }}>{maskName(player.name)}</div>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:12,
                color:C.muted, marginTop:2 }}>
                {player.teamName} · {player.attended || 0} games played
              </div>
              {player.goals > 0 && (
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:11,
                  color:C.green, marginTop:2 }}>⚽ {player.goals} goals</div>
              )}
            </div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:12,
              color:C.amber, fontWeight:600 }}>That's me →</div>
          </button>
        ))}

        <div style={{ marginTop:16, padding:"1px 0" }}>
          <button onClick={onCreateNew} style={{
            width:"100%", padding:"14px 0", borderRadius:8,
            border:`1.5px solid ${C.border}`, background:"transparent",
            color:C.muted, fontFamily:"Inter,sans-serif", fontSize:14,
            fontWeight:600, cursor:"pointer" }}>
            None of these — I'm a new player
          </button>
        </div>

        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11,
          color:C.faint, textAlign:"center", marginTop:16, lineHeight:1.5 }}>
          Signed in as {maskEmail(userEmail)}
        </div>
      </div>
    </div>
  );
}
