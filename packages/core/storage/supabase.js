// Supabase storage layer — stub ready for implementation
// When ready: npm install @supabase/supabase-js
// Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env

// import { createClient } from "@supabase/supabase-js";
// const supabase = createClient(
//   import.meta.env.VITE_SUPABASE_URL,
//   import.meta.env.VITE_SUPABASE_ANON_KEY
// );

export const supabaseStorage = {
  get: async (table, id) => {
    // const { data } = await supabase.from(table).select("*").eq("id", id).single();
    // return data;
    throw new Error("Supabase not yet configured");
  },

  set: async (table, row) => {
    // const { data } = await supabase.from(table).upsert(row);
    // return data;
    throw new Error("Supabase not yet configured");
  },

  getAll: async (table, filters = {}) => {
    // let query = supabase.from(table).select("*");
    // Object.entries(filters).forEach(([k, v]) => { query = query.eq(k, v); });
    // const { data } = await query;
    // return data;
    throw new Error("Supabase not yet configured");
  },

  // Migration helper — call once to move localStorage → Supabase
  migrateFromLocalStorage: async (localData) => {
    // const tables = ["squad", "bibHistory", "schedule", "matchHistory", "settings"];
    // for (const table of tables) {
    //   if (localData[table]) await supabaseStorage.set(table, localData[table]);
    // }
    throw new Error("Supabase not yet configured");
  },
};
