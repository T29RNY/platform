// IndexedDB queue for ref match events. Cycle 3.4.
//
// Why this exists: a ref's phone at the pitch can lose signal mid-tap.
// Every event row is written here BEFORE the network call, then deleted
// on RPC success. If the page crashes or the network drops, the row
// survives and the drain loop replays it on reconnect / next page load.
//
// Why a raw IDB helper rather than idb / dexie: keeps apps/ref's
// dependency surface tiny — no new packages, no bundle bloat for a ~80
// line module. The schema is one store, no migrations beyond v1.
//
// Why it's safe to replay rows: every ref_* RPC is idempotent on
// client_event_id (ON CONFLICT DO NOTHING in mig 120, extended to the
// Ref V2 clock/note/sin-bin/added-time writes in mig 264). A duplicate
// replay is a server-side no-op.

import {
  refRecordGoal,
  refRecordCard,
  refRecordSubstitution,
  refSetPeriod,
  refSetClock,
  refRecordNote,
  refRecordSinBin,
  refSetAddedTime,
} from "@platform/core/storage/supabase.js";

const DB_NAME    = "ioo-ref-queue";
const DB_VERSION = 1;
const STORE      = "events";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "client_event_id" });
        store.createIndex("by_fixture", "fixture_id");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((r) => {
        tx.oncomplete = () => resolve(r);
      })
      .catch(reject);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function enqueue(row) {
  return withStore("readwrite", (s) => reqAsPromise(s.put(row)));
}

export async function deletePending(clientEventId) {
  return withStore("readwrite", (s) => reqAsPromise(s.delete(clientEventId)));
}

export async function listPending(fixtureId) {
  const rows = await withStore("readonly", (s) =>
    reqAsPromise(s.index("by_fixture").getAll(fixtureId))
  );
  return rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

export async function isPending(clientEventId) {
  const row = await withStore("readonly", (s) => reqAsPromise(s.get(clientEventId)));
  return Boolean(row);
}

// ── Drain dispatch ────────────────────────────────────────────────────
// Replay one queued row by calling the matching wrapper. row.kind/args
// mirror the wrapper signatures so the drain loop stays trivial. Every
// kind here is idempotent on client_event_id server-side, so replaying
// a row the server already saw is a no-op. Extended for Ref V2 (mig 264):
// clock (pause/resume), note, sinbin, addedtime.
export async function fireQueued(refToken, row) {
  const a = row.args;
  switch (row.kind) {
    case "goal":     return refRecordGoal(refToken, a);
    case "card":     return refRecordCard(refToken, a);
    case "sub":      return refRecordSubstitution(refToken, a);
    case "period":   return refSetPeriod(refToken, a.period, a.clientEventId, a.localTimestamp);
    case "clock":    return refSetClock(refToken, a.action, a.clientEventId, a.localTimestamp);
    case "note":     return refRecordNote(refToken, a);
    case "sinbin":   return refRecordSinBin(refToken, a);
    case "addedtime":return refSetAddedTime(refToken, a);
    default: throw new Error(`unknown queue kind: ${row.kind}`);
  }
}
