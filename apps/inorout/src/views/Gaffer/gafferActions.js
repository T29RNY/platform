// gafferActions.js — the closed action registry for Gaffer's action-flow
// (GAFFER_ACTION_FLOW_HANDOFF.md Locked Decision #1: "do it" is a closed
// registry, never the LLM/client freely constructing an RPC call — Gaffer
// only ever selects an actionKey from this small, server-owned allow-list).
//
// v1 (PR-B) populates route + riskTier:'nav' for all three orb nudges —
// pure navigation, zero write. rpcWrapper/confirmCopy stay null until a real
// write path exists (PR-C for chase_no_response, PR-D for the other two);
// the chip renderer in Gaffer/index.jsx only shows "Do it for you" once
// rpcWrapper is set, so a team never sees a capability that isn't real yet.
//
// Domain-namespaced (`casual.*`) from day one per GAFFER.md's "composer"
// direction — costs nothing now, avoids a rename when venue/club domains
// land later.

export const GAFFER_ACTIONS = {
  "casual.chase_no_response": {
    actionKey: "casual.chase_no_response",
    label: "Chase no-responses",
    riskTier: "nav", // 'nav' | 'write-low' (v1 populates only these; 'write-money' never)
    route: "main",
    rpcWrapper: null,
    confirmCopy: null,
    allowedRoles: ["admin"],
  },
  "casual.chase_payment": {
    actionKey: "casual.chase_payment",
    label: "Chase payment",
    riskTier: "nav",
    route: "payments",
    rpcWrapper: null,
    confirmCopy: null,
    allowedRoles: ["admin"],
  },
  "casual.notify_reserves": {
    actionKey: "casual.notify_reserves",
    label: "Notify reserves",
    riskTier: "nav",
    route: "main",
    rpcWrapper: null,
    confirmCopy: null,
    allowedRoles: ["admin"],
  },
};

// Maps a computeNudge() key (GafferLauncher.jsx — e.g. "owed:40", "noresp:3",
// "shortfall:11/14") to its registry action. Nudges are already pre-classified
// client-side into a fixed key, so this is a lookup, never a dynamic dispatch.
export function actionForNudgeKey(nudgeKey) {
  if (!nudgeKey) return null;
  if (nudgeKey.startsWith("owed:")) return GAFFER_ACTIONS["casual.chase_payment"];
  if (nudgeKey.startsWith("noresp:")) return GAFFER_ACTIONS["casual.chase_no_response"];
  if (nudgeKey.startsWith("shortfall:")) return GAFFER_ACTIONS["casual.notify_reserves"];
  return null;
}
