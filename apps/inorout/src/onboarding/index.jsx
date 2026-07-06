import { useOnboarding } from "./hooks/useOnboarding.js";
import CreateTeam from "./steps/CreateTeam.jsx";
import VerticalChooser from "./steps/VerticalChooser.jsx";
import SquadReady from "./steps/SquadReady.jsx";
import SetupLoadingScreen from "./steps/SetupLoadingScreen.jsx";

export default function Onboarding({ onComplete, authUser }) {
  const ob = useOnboarding({ onComplete, authUser });

  // Onboarded users reach /create from Profile / My Squads with a returnTo
  // marker; first-time setup arrives at a plain /create. Only the former gets
  // a Cancel button back to where they came from.
  let cancelTo = null;
  try {
    const rt = new URLSearchParams(window.location.search).get("returnTo");
    // Same-origin only — resolve with the WHATWG URL parser and compare origins
    // so a crafted ?returnTo= (e.g. "/\evil.com", tab/newline tricks) can't turn
    // Cancel into an open redirect. A bare string-prefix check is NOT enough:
    // location.href = "/\evil.com" resolves off-origin. Keep only the path.
    if (rt) {
      const u = new URL(rt, window.location.origin);
      if (u.origin === window.location.origin) cancelTo = u.pathname + u.search + u.hash;
    }
  } catch (e) { /* no-op */ }

  if (ob.loading) return <SetupLoadingScreen />;

  return (
    <div style={{
      background: "var(--bg)", minHeight: "100dvh", color: "var(--t1)",
      maxWidth: 430, margin: "0 auto", fontFamily: "var(--font-body)",
    }}>
      {ob.step === 1 && ob.vertical === null && (
        <VerticalChooser onPick={ob.pickVertical} cancelTo={cancelTo} />
      )}

      {ob.step === 1 && ob.vertical !== null && (
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
          cancelTo={cancelTo}
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
