import { colors as C } from "@platform/core";
import { useOnboarding } from "./hooks/useOnboarding.js";
import CreateTeam from "./steps/CreateTeam.jsx";
import AddPlayers from "./steps/AddPlayers.jsx";
import ShareLinks from "./steps/ShareLinks.jsx";

function ProgressBar({ step }) {
  return (
    <div style={{ padding:"16px 24px 0", background:"#0f0f0f",
      borderBottom:`1px solid ${C.border}` }}>
      {/* Logo */}
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:20,
        color:C.amber, letterSpacing:3, marginBottom:14 }}>IN OR OUT</div>
      {/* Steps */}
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {[1,2,3].map(s => (
          <div key={s} style={{ flex:1, height:3, borderRadius:2,
            background: s <= step ? C.amber : C.border,
            transition:"background 0.3s" }}/>
        ))}
      </div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:11,
        color:C.muted, marginBottom:12, letterSpacing:0.5 }}>
        Step {step} of 3
      </div>
    </div>
  );
}

export default function Onboarding({ onComplete }) {
  const ob = useOnboarding({ onComplete });

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif" }}>
      <ProgressBar step={ob.step}/>

      {ob.step === 1 && (
        <CreateTeam
          groupName={ob.groupName}       setGroupName={ob.setGroupName}
          dayOfWeek={ob.dayOfWeek}       setDayOfWeek={ob.setDayOfWeek}
          kickoff={ob.kickoff}           setKickoff={ob.setKickoff}
          venue={ob.venue}               setVenue={ob.setVenue}
          squadSize={ob.squadSize}       setSquadSize={ob.setSquadSize}
          pricePerPlayer={ob.pricePerPlayer} setPricePerPlayer={ob.setPricePerPlayer}
          onSubmit={ob.submitTeam}
          loading={ob.loading}
          error={ob.error}
        />
      )}

      {ob.step === 2 && (
        <AddPlayers
          playerNames={ob.playerNames}
          newName={ob.newName}       setNewName={ob.setNewName}
          addPlayer={ob.addPlayer}   removePlayer={ob.removePlayer}
          onSubmit={ob.submitPlayers}
          onSkip={() => ob.submitPlayers(true)}
          loading={ob.loading}
          error={ob.error}
        />
      )}

      {ob.step === 3 && (
        <ShareLinks
          groupName={ob.groupName}
          adminToken={ob.adminToken}
          players={ob.players}
          onComplete={ob.onComplete}
        />
      )}
    </div>
  );
}
