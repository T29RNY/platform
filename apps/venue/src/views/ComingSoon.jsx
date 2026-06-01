import React from "react";
import { motion } from "framer-motion";

// Placeholder for management sections whose data needs a dedicated venue RPC
// that isn't built yet (player rosters, round-robin league standings). Keeps
// the full navigation IA in place and is honest about what's coming.
export default function ComingSoon({ title, blurb, points = [] }) {
  return (
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">{title}</h2>
          <p className="mgmt-sub">Next up</p>
        </div>
      </div>
      <motion.div className="panel soon-panel"
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
        <div className="soon-glow" aria-hidden="true" />
        <span className="soon-badge">In build</span>
        <h3 className="soon-h">{title}</h3>
        <p className="soon-blurb">{blurb}</p>
        {points.length > 0 && (
          <ul className="soon-list">
            {points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        )}
      </motion.div>
    </main>
  );
}
