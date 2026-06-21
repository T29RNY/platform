// ============================================================
// clockOwner — Phase 0d single-writer lock client (mig 374).
// Among devices holding the SAME ref_token (this phone + the future
// watch) only ONE owns the live clock at a time. This hook auto-claims
// the clock while a match is live, heartbeats to hold the lease, and
// releases on unmount — and exposes who holds it for the ⌚CTRL badge.
//
// DORMANT: the server does NOT yet reject a non-owner's clock writes
// (Option A — flip on after the real phone+watch concurrency rehearsal).
// So losing the lock does not block this device today; the badge just
// tells the ref which screen is "in charge".
// ============================================================
import { useEffect, useRef, useState, useCallback } from "react";
import {
  refClaimClock,
  refHeartbeatClock,
  refReleaseClock,
} from "@platform/core/storage/supabase.js";

const DEVICE_KEY = "ioo_ref_device_id";
const HEARTBEAT_MS = 15000; // half the 30s server lease

// A stable per-install id so the same browser keeps the same identity.
export function getDeviceId() {
  if (typeof window === "undefined") return "ref-server";
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = "ref-" + (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "ref-ephemeral";
  }
}

// Drives the badge + auto-claim. `active` should be true only while the
// match is in_progress. Failures are swallowed (the lock is advisory).
export function useClockOwner(refToken, active) {
  const deviceId = useRef(getDeviceId()).current;
  const [owner, setOwner] = useState(null);   // { owner_id, owner_kind, is_live, ... }
  const [isOwner, setIsOwner] = useState(false);

  const apply = useCallback((res) => {
    if (!res) return;
    setOwner(res.owner || null);
    setIsOwner(res.owner?.owner_id === deviceId && !!res.owner?.is_live);
  }, [deviceId]);

  useEffect(() => {
    if (!active || !refToken) return;
    let cancelled = false;

    (async () => {
      try { if (!cancelled) apply(await refClaimClock(refToken, deviceId, "phone", false)); }
      catch (e) { console.error("[ref] clock claim failed", e); }
    })();

    const id = setInterval(async () => {
      try { if (!cancelled) apply(await refHeartbeatClock(refToken, deviceId)); }
      catch (e) { console.error("[ref] clock heartbeat failed", e); }
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      // best-effort release so the watch can take over instantly
      refReleaseClock(refToken, deviceId).catch(() => {});
    };
  }, [active, refToken, deviceId, apply]);

  // Explicit "take control" (the badge tap) — forces ownership to this device.
  const takeControl = useCallback(async () => {
    try { apply(await refClaimClock(refToken, deviceId, "phone", true)); }
    catch (e) { console.error("[ref] clock takeover failed", e); }
  }, [refToken, deviceId, apply]);

  return { owner, isOwner, deviceId, takeControl };
}
