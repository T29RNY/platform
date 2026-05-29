import React from "react";

// Non-removable attribution (free/standard tier). Enterprise white-label removal
// would be a deliberate future flag, never an accident.
export default function PoweredBy() {
  return (
    <div className="poweredby" aria-label="Powered by In or Out">
      Powered by <b>In&nbsp;or&nbsp;Out</b>
    </div>
  );
}
