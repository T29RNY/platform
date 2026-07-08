import { useState, useRef } from "react";
import { CaretLeft, Medal, ArrowSquareOut, SlidersHorizontal } from "@phosphor-icons/react";
import { selfServeCreateTournament } from "@platform/core/storage/supabase.js";
import ManageTournament from "./ManageTournament.jsx";

// Self-serve TOURNAMENT creation — the native "run a one-day cup from your phone" step.
// Unlike venue/club/gym (which capture a shell then hand off to the web console), a
// tournament is run pitch-side on a phone, so this is a surface:'native' vertical: the
// whole create → share → register → run flow lives in the app.
//
// One transaction via self_serve_create_tournament (mig 489): finds-or-creates the
// hidden personal-host venue, inserts the tournament (status='open' so the share link
// resolves immediately) + a default competition, and binds the creator as owner via the
// venue_admins owner row (managed later through Stage-1b venue_id-as-token, zero twins).
//
// Self-contained by design: owns its own state and calls the core wrapper directly
// rather than threading through useOnboarding, so the shared casual create hook stays
// byte-identical (casual-regression safety) — same pattern as CreateVenue.jsx.

// v1 sport pick-list (curated code list — see TOURNAMENT_SELF_SERVE_HANDOFF.md
// pre-build answer #1). The RPC validates the code server-side and applies the matching
// ref-UI preset; this list must stay in lock-step with the RPC's CASE arms.
const SPORTS = [
  { code: "football",     label: "Football" },
  { code: "futsal",       label: "Futsal" },
  { code: "5aside",       label: "5-a-side" },
  { code: "hockey",       label: "Hockey" },
  { code: "rugby",        label: "Rugby" },
  { code: "basketball",   label: "Basketball" },
  { code: "netball",      label: "Netball" },
  { code: "volleyball",   label: "Volleyball" },
  { code: "handball",     label: "Handball" },
  { code: "tennis",       label: "Tennis" },
  { code: "badminton",    label: "Badminton" },
  { code: "squash",       label: "Squash" },
  { code: "padel",        label: "Padel" },
  { code: "table_tennis", label: "Table tennis" },
  { code: "other",        label: "Other" },
];

// v1 formats the phone can run end-to-end, all driven from ManageTournament:
//   knockout    -> self_serve_seed_single_elim (mig 491)
//   round_robin -> venue_generate_schedule
//   groups      -> self_serve_seed_group_stage (mig 498) then venue_seed_knockout.
// For groups, the group count + how-many-advance are chosen at generate-time in
// Manage against the live team count (Decision #1), so there is no dead end at
// create — self_serve_create_tournament (mig 489) accepts format='groups'.
const FORMATS = [
  { code: "knockout",    label: "Knockout" },
  { code: "round_robin", label: "Round robin (everyone plays everyone)" },
  { code: "groups",      label: "Groups, then knockout" },
];

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block", marginBottom: 18 }}>
      <div style={{
        fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--t2)",
        marginBottom: 8,
      }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--t2)", marginTop: 6 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "var(--s2)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--r)", padding: "13px 14px",
  color: "var(--t1)", fontFamily: "var(--font-body)", fontSize: 16,
};

export default function CreateTournament({ onBack, manageSlug = null }) {
  const [name, setName]       = useState("");
  const [sport, setSport]     = useState("football");
  const [format, setFormat]   = useState("knockout");
  const [eventDate, setEventDate] = useState(""); // optional; blank → today (server default)
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [created, setCreated] = useState(null); // { slug } once the tournament exists
  // Manage mode: entered on return-visit (?manage=<slug>) or after create via the
  // success screen's "Manage" button. Renders the native run/manage UI in-place —
  // no App.jsx route. `manageOpen` may hold a slug to auto-open in the list.
  const [manageOpen, setManageOpen] = useState(manageSlug ? { slug: manageSlug } : null);
  const savingRef = useRef(false);

  // ── Manage UI (list → detail → score) ────────────────────────────────────────
  if (manageOpen) {
    return (
      <ManageTournament
        initialSlug={manageOpen.slug || null}
        onExit={() => setManageOpen(null)}
      />
    );
  }

  const pageStyle = { padding: "calc(28px + env(safe-area-inset-top)) 20px calc(40px + env(safe-area-inset-bottom))", minHeight: "100dvh" };

  const nameOk = name.trim().length >= 2;
  const canSubmit = nameOk && !loading;

  const friendly = (e) => {
    const m = e?.message || "";
    if (/self_serve_tournament_cap_reached/.test(m)) return "You've reached the limit of 10 active tournaments. Finish or cancel one first.";
    if (/tournament_name_required|tournament_name_too_long/.test(m)) return "Please enter a valid tournament name.";
    if (/sport_not_supported/.test(m)) return "Please pick a sport from the list.";
    if (/format_not_supported/.test(m)) return "Please pick a format.";
    if (/auth_required/.test(m)) return "Please sign in again to create a tournament.";
    return "Something went wrong creating your tournament. Please try again.";
  };

  const submit = async () => {
    if (savingRef.current || !canSubmit) return;
    savingRef.current = true;
    setLoading(true); setError(null);
    try {
      const data = await selfServeCreateTournament({
        name: name.trim(),
        sport,
        format,
        eventDate: eventDate || null,
      });
      setCreated({ slug: data?.slug ?? null });
    } catch (e) {
      console.error("selfServeCreateTournament failed", e);
      setError(friendly(e));
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  };

  // ── Success hand-off ───────────────────────────────────────────────────────
  // The public tournament page already exists (/tournament/:slug) and resolves
  // immediately because the RPC inserts status='open'. PR #3 enriches this with the
  // share sheet + QR + "install to follow" CTA; PR #4 adds the native run/manage UI.
  if (created) {
    return (
      <div style={pageStyle}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16, marginTop: 40 }}>
          <Medal size={48} weight="thin" color="var(--gold)" />
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 30, letterSpacing: 0.6, margin: 0 }}>
            {name.trim()} is live
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.5, color: "var(--t2)", maxWidth: 320, margin: 0 }}>
            Your tournament page is ready to share. Send the link to teams so they can
            register — then approve them and run it from your phone.
          </p>
          {created.slug && (
            <>
              <button
                type="button"
                onClick={() => setManageOpen({ slug: created.slug })}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8, border: "none",
                  background: "var(--gold)", color: "var(--bg)", cursor: "pointer",
                  fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600,
                  borderRadius: "var(--r)", padding: "13px 22px",
                }}
              >
                <SlidersHorizontal size={18} weight="thin" /> Manage tournament
              </button>
              <a
                href={`/tournament/${created.slug}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  background: "none", color: "var(--gold)", textDecoration: "none",
                  fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600,
                  borderRadius: "var(--r)", padding: "6px 22px",
                }}
              >
                Open public page <ArrowSquareOut size={18} weight="thin" />
              </a>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── The create form ────────────────────────────────────────────────────────
  return (
    <div style={pageStyle}>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, background: "none",
          border: "none", color: "var(--t2)", fontFamily: "var(--font-body)",
          fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 24,
        }}
      >
        <CaretLeft size={16} weight="thin" /> Back
      </button>

      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, letterSpacing: 0.6, margin: "0 0 6px" }}>
        Set up your tournament
      </h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--t2)", margin: "0 0 24px" }}>
        Give it a name and pick the sport and format. You can share it and add teams
        straight away.
      </p>

      <Field label="Tournament name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sunday 6-a-side Cup"
          maxLength={120}
          style={inputStyle}
        />
      </Field>

      <Field label="Sport">
        <select value={sport} onChange={(e) => setSport(e.target.value)} style={inputStyle}>
          {SPORTS.map((s) => (
            <option key={s.code} value={s.code}>{s.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Format" hint={format === "groups" ? "You'll draw the groups and choose how many teams go through once teams have registered." : undefined}>
        <select value={format} onChange={(e) => setFormat(e.target.value)} style={inputStyle}>
          {FORMATS.map((f) => (
            <option key={f.code} value={f.code}>{f.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Date" hint="Optional — leave blank for today.">
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          style={inputStyle}
        />
      </Field>

      {error && (
        <div style={{
          fontFamily: "var(--font-body)", fontSize: 13, color: "var(--danger, #FF6060)",
          margin: "4px 0 16px",
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        style={{
          width: "100%", boxSizing: "border-box",
          background: canSubmit ? "var(--gold)" : "var(--s2)",
          color: canSubmit ? "var(--bg)" : "var(--t2)",
          border: canSubmit ? "none" : "1px solid var(--border-subtle)",
          borderRadius: "var(--r)", padding: "15px 16px",
          fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600,
          cursor: canSubmit ? "pointer" : "default", marginTop: 8,
        }}
      >
        {loading ? "Creating…" : "Create tournament →"}
      </button>
    </div>
  );
}
