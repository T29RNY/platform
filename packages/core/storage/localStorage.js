// Storage layer — localStorage implementation
// To migrate to Supabase: swap this file's get/set implementation for a server-backed one.
// The key names and data shapes stay identical — only this file changes.

const PREFIX = "ioo_";

export const storage = {
  get: (key) => {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },

  set: (key, val) => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(val));
    } catch {}
  },

  delete: (key) => {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },

  exportAll: () => {
    const keys = ["squad", "bibHistory", "schedule", "matchHistory", "settings"];
    return keys.reduce((o, k) => ({ ...o, [k]: storage.get(k) }), {});
  },

  downloadBackup: () => {
    const data = JSON.stringify(storage.exportAll(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "inorout-backup.json";
    a.click();
  },
};
