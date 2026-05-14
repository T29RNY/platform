import { useOnboarding } from "./hooks/useOnboarding.js";
import CreateTeam from "./steps/CreateTeam.jsx";
import AddPlayers from "./steps/AddPlayers.jsx";
import ShareLinks from "./steps/ShareLinks.jsx";

export default function Onboarding({ onComplete }) {
  const ob = useOnboarding({ onComplete });

  return (
    <div style={{
      background: "var(--bg)", minHeight: "100dvh", color: "var(--t1)",
      maxWidth: 430, margin: "0 auto", fontFamily: "var(--font-body)",
    }}>
      {ob.step === 1 && (
        <CreateTeam
          groupName={ob.groupName}           setGroupName={ob.setGroupName}
          dayOfWeek={ob.dayOfWeek}           setDayOfWeek={ob.setDayOfWeek}
          kickoff={ob.kickoff}               setKickoff={ob.setKickoff}
          venue={ob.venue}                   setVenue={ob.setVenue}
          city={ob.city}                     setCity={ob.setCity}
          squadSize={ob.squadSize}           setSquadSize={ob.setSquadSize}
          pricePerPlayer={ob.pricePerPlayer} setPricePerPlayer={ob.setPricePerPlayer}
          bibsEnabled={ob.bibsEnabled}       setBibsEnabled={ob.setBibsEnabled}
          adminEmail={ob.adminEmail}         setAdminEmail={ob.setAdminEmail}
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
