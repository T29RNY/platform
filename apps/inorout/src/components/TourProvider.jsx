import { createContext, useContext } from "react";

// TourProvider — the single gate for the whole Phase 2 guided-tour experience
// (spotlight tours AND the inline FirstTimeHint coachmarks). Carries the per-team
// multi_context_nav flag down to deeply-nested call sites (PlayerProfile,
// TeamsScreen, BibsScreen, …) without prop-threading, so everything ships DARK
// until a team turns the flag on — then enables atomically and rolls back
// instantly (locked plan cross-cutting decision #7).
//
// Squad-context screens are the only consumers (that's where FirstTimeHint lives),
// so `enabled` is the squad team's multi_context_nav flag. The spotlight Tour
// engine is gated separately at each mount via its own `enabled` prop.

const TourContext = createContext({ enabled: false });

export function TourProvider({ enabled = false, children }) {
  return (
    <TourContext.Provider value={{ enabled: !!enabled }}>
      {children}
    </TourContext.Provider>
  );
}

export function useToursEnabled() {
  return useContext(TourContext).enabled;
}
