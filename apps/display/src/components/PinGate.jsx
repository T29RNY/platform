import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { checkDisplayPin } from "@platform/core/storage/supabase.js";

const LOCKOUT_MS = 30 * 60 * 1000;
const MAX_FAILS = 3;

const kUnlock = (t) => `iod_unlock_${t}`;
const kLockout = (t) => `iod_lockout_${t}`;

// Client-side PIN gate. The PIN is validated server-side (check_display_pin) but the
// 3-strike / 30-minute lockout lives here in localStorage (the display is read-only).
export default function PinGate({ token, onUnlock }) {
  const [phase, setPhase] = useState("checking"); // checking | open | locked
  const [digits, setDigits] = useState("");
  const [fails, setFails] = useState(0);
  const [err, setErr] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // remembered unlock or active lockout
  useEffect(() => {
    try {
      if (localStorage.getItem(kUnlock(token)) === "1") { onUnlock(); return; }
      const lu = Number(localStorage.getItem(kLockout(token)) || 0);
      if (lu > Date.now()) { setLockUntil(lu); setPhase("locked"); return; }
    } catch { /* storage blocked — fall through to live check */ }

    checkDisplayPin(token, null)
      .then((res) => {
        if (!res?.pin_required) { try { localStorage.setItem(kUnlock(token), "1"); } catch {} onUnlock(); }
        else setPhase("open");
      })
      .catch(() => setPhase("open")); // bad token surfaces later via get_display_state
  }, [token, onUnlock]);

  // lockout countdown tick
  useEffect(() => {
    if (phase !== "locked") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (phase === "locked" && lockUntil <= now) { setPhase("open"); setFails(0); setDigits(""); }
  }, [phase, lockUntil, now]);

  const submit = useCallback(async (pin) => {
    try {
      const res = await checkDisplayPin(token, pin);
      if (res?.ok) { try { localStorage.setItem(kUnlock(token), "1"); } catch {} onUnlock(); return; }
    } catch { /* treat as wrong */ }
    const f = fails + 1;
    setErr(true);
    setTimeout(() => { setErr(false); setDigits(""); }, 450);
    if (f >= MAX_FAILS) {
      const until = Date.now() + LOCKOUT_MS;
      try { localStorage.setItem(kLockout(token), String(until)); } catch {}
      setLockUntil(until); setPhase("locked");
    }
    setFails(f);
  }, [token, fails, onUnlock]);

  const press = useCallback((d) => {
    setDigits((cur) => {
      if (cur.length >= 4) return cur;
      const next = cur + d;
      if (next.length === 4) submit(next);
      return next;
    });
  }, [submit]);

  const back = useCallback(() => setDigits((c) => c.slice(0, -1)), []);

  if (phase === "checking") return <div className="loader">●</div>;

  return (
    <div className="gate">
      <div className="floodsweep" />
      <motion.div
        className={`gate-card${err ? " gate-shake" : ""}`}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="gate-kicker">Reception Display</div>
        <div className="gate-title">{phase === "locked" ? "Locked" : "Enter PIN"}</div>

        {phase === "locked" ? (
          <div className="gate-msg err">
            Too many attempts. Try again in {Math.ceil((lockUntil - now) / 60000)} min.
          </div>
        ) : (
          <>
            <div className="pin-dots">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`pin-dot${err ? " err" : digits.length > i ? " on" : ""}`} />
              ))}
            </div>
            <div className="keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} className="key" onClick={() => press(d)}>{d}</button>
              ))}
              <div className="key ghost" />
              <button className="key" onClick={() => press("0")}>0</button>
              <button className="key" onClick={back}>⌫</button>
            </div>
            <div className={`gate-msg${err ? " err" : ""}`}>
              {err ? "Incorrect PIN" : fails > 0 ? `${MAX_FAILS - fails} attempt(s) left` : "Ask reception for the code"}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
