import { useOnboarding } from "./hooks/useOnboarding.js";
import CreateTeam from "./steps/CreateTeam.jsx";
import SquadReady from "./steps/SquadReady.jsx";
import SetupLoadingScreen from "./steps/SetupLoadingScreen.jsx";

export default function Onboarding({ onComplete, authUser }) {
  const ob = useOnboarding({ onComplete, authUser });

  if (ob.loading) return <SetupLoadingScreen />;

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
          subStep={ob.subStep}
          goNext={ob.goNext}
          goBack={ob.goBack}
          goToSubStep={ob.goToSubStep}
        />
      )}

      {ob.step === 2 && (
        <SquadReady
          groupName={ob.groupName}
          joinCode={ob.joinCode}
          adminToken={ob.adminToken}
          adminPlayerToken={ob.adminPlayerToken}
        />
      )}
    </div>
  );
}
