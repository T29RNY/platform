import React from "react";

// Inline SVG icon registry ported from the v2 design bundle (24×24 viewBox,
// stroke 1.7, round caps/joins). The venue app uses no icon library — this
// self-contained set keeps it that way. Add a glyph here, reference it by name.
const PATHS = {
  ops:      <><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  bookings: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 3v4M16 3v4" /></>,
  payments: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>,
  teams:    <><circle cx="9" cy="9" r="3.2" /><circle cx="17" cy="10" r="2.4" /><path d="M3 19c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5" /><path d="M15 19c0-2 1.5-3.4 4-3.4 1 0 1.7.2 2 .5" /></>,
  players:  <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" /></>,
  staff:    <><circle cx="12" cy="7" r="3" /><path d="M6 21v-1c0-2.8 2.7-5 6-5s6 2.2 6 5v1" /><path d="M16 3l2 2-2 2" /></>,
  league:   <><path d="M6 4h12v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V4z" /><path d="M6 6H4v1a2 2 0 0 0 2 2" /><path d="M18 6h2v1a2 2 0 0 1-2 2" /><path d="M9 20h6M10 20l1-5h2l1 5" /></>,
  table:    <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></>,
  cups:     <><path d="M7 4h10v6a5 5 0 0 1-10 0V4z" /><path d="M7 7H4a3 3 0 0 0 3 3" /><path d="M17 7h3a3 3 0 0 1-3 3" /><path d="M9 21h6M12 15v6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.4.97 1.36 1.51 2.5 1.51H21a2 2 0 1 1 0 4h-.09c-.7 0-1.3.4-1.51 1z" /></>,
  tv:       <><rect x="2" y="5" width="20" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></>,
  plus:     <><path d="M12 5v14M5 12h14" /></>,
  search:   <><circle cx="11" cy="11" r="6" /><path d="m21 21-3.5-3.5" /></>,
  bell:     <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
  arrow_r:  <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  chevron_l:<><path d="M15 18l-6-6 6-6" /></>,
  chevron_r:<><path d="M9 6l6 6-6 6" /></>,
  refresh:  <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  check:    <><path d="M5 12l5 5L20 7" /></>,
  x:        <><path d="M6 6l12 12M18 6 6 18" /></>,
  copy:     <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  alert:    <><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v5M12 18v.5" /></>,
  info:     <><circle cx="12" cy="12" r="9" /><path d="M12 8v.5M12 11v6" /></>,
  pound:    <><path d="M16 7c-1.2-1.3-2.8-2-4.5-2C9 5 7.5 6.5 7.5 9c0 1 .3 2 1 3M5 13h10M7 19h11" /></>,
  clock:    <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pitch:    <><rect x="2" y="6" width="20" height="12" rx="1.5" /><path d="M12 6v12M2 12h4a2 2 0 0 1 0 4H2M22 12h-4a2 2 0 0 0 0 4h4" /></>,
  whistle:  <><circle cx="8" cy="14" r="5" /><path d="M13 14h7l2-4H13" /></>,
  phone:    <><path d="M22 16v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4 1h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.4 2.1L8 9a16 16 0 0 0 6 6l1.4-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.7A2 2 0 0 1 22 16z" /></>,
  whatsapp: <><path d="M21 12a9 9 0 1 1-3-6.7L21 4l-1.3 3.3A9 9 0 0 1 21 12z" /><path d="M9 9c0 4 3 7 7 7l1.5-1.5-2.5-1-1 1c-1.5-.5-3-2-3.5-3.5l1-1-1-2.5L9 9z" /></>,
  mail:     <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  customers:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="3" /><path d="M21 11l-2 2 4 4" /><path d="M19 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /></>,
  drag:     <><circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" /></>,
  equipment:<><path d="M4 8h16a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1z" /><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
};

export default function Icon({ name, size = 18 }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
    >
      {PATHS[name] || null}
    </svg>
  );
}
