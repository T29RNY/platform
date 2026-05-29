import React from "react";
import { AnimatePresence, motion } from "framer-motion";

// Broadcast score numeral that flips when the value changes.
export default function Score({ value, className = "score" }) {
  return (
    <div className={className} style={{ position: "relative", overflow: "hidden" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "70%", opacity: 0, filter: "blur(4px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: "-70%", opacity: 0, filter: "blur(4px)" }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          style={{ display: "inline-block" }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
