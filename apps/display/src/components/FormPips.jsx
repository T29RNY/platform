import React from "react";

// Last-5 form guide. The RPC returns newest-first (index 0 = most recent);
// broadcast tables read left→older, right→most-recent, so we render reversed.
// Pads to 5 slots with faint placeholders so every row aligns.
export default function FormPips({ form }) {
  const arr = Array.isArray(form) ? form.slice(0, 5) : [];
  const ordered = [...arr].reverse(); // oldest → newest (newest on the right)
  const pad = Math.max(0, 5 - ordered.length);
  return (
    <span className="formpips" aria-label={ordered.join(" ") || "no form"}>
      {Array.from({ length: pad }).map((_, i) => (
        <span key={`p${i}`} className="pip pip-empty" />
      ))}
      {ordered.map((r, i) => (
        <span key={i} className={`pip pip-${r}`}>{r}</span>
      ))}
    </span>
  );
}
