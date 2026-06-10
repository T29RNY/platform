import React, { useEffect, useMemo, useRef, useState } from "react";
import { teamColour, timeShort } from "../lib/format.js";

// Tall portrait promo (HANDOVER §6.7): rotates venue sponsor creative ↔ IoO
// app creative every 8s, weighted by display_config.sponsor_ratio (default
// 0.7). No sponsor image uploaded → 100% IoO. 250ms crossfade via classes.
const ROTATE_MS = 8000;

function PhoneMock({ liveFixtures, upcoming }) {
  const rows = [
    ...(liveFixtures || []).map((f) => ({
      key: f.fixture_id, live: true,
      c: teamColour(f.home_primary_colour, f.home_team_name || ""),
      lbl: `${f.home_team_name || ""} v ${f.away_team_name || ""}`,
      sc: `${f.home_score ?? 0}–${f.away_score ?? 0}`,
    })),
    ...(upcoming || []).map((f) => ({
      key: f.fixture_id, live: false,
      c: teamColour(f.home_primary_colour, f.home_team_name || ""),
      lbl: `${f.home_team_name || ""} v ${f.away_team_name || ""}`,
      sc: timeShort(f.kickoff_time),
    })),
  ].slice(0, 5);
  return (
    <div className="phone">
      <div className="phone__screen">
        <div className="topbar">
          <span className="logo" />
          {liveFixtures?.length > 0 && <span className="live">{liveFixtures.length} Live</span>}
        </div>
        {rows.map((r) => (
          <div className={`phone__row${r.live ? " live-row" : ""}`} key={r.key}>
            <span className="sw" style={{ "--c": r.c }} />
            <span className="lbl">{r.lbl}</span>
            <span className="sc">{r.sc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const IOO_CREATIVES = [
  { tag: "Get the app · In or Out", title: "Your league lives in one app.", sub: "Live tables, fixtures, payments — in your pocket.", url: "in-or-out.com" },
  { tag: "Built for Sunday League", title: "Stop chasing the WhatsApp group.", sub: "Players RSVP. You track stats. Done.", url: "in-or-out.com" },
];

export default function TallPromo({ config, venue, liveFixtures, upcoming }) {
  const sponsor = {
    image: config?.sponsor_image_url || null,
    tag: config?.sponsor_label || "Sponsor",
    title: config?.sponsor_title || "",
    sub: config?.sponsor_body || "",
    url: config?.sponsor_url || "",
  };
  // spec: no uploaded image ⇒ 100% IoO (never show the dashed placeholder in prod)
  const hasSponsor = !!sponsor.image;
  const ratioRaw = Number(config?.sponsor_ratio);
  const ratio = hasSponsor ? (Number.isFinite(ratioRaw) ? Math.max(0, Math.min(1, ratioRaw)) : 0.7) : 0;

  // build the rotation deck from the ratio: e.g. 0.7 → venue 7 : ioo 3 ≈ V V I V V I V V I V
  const deck = useMemo(() => {
    if (ratio <= 0) return [{ kind: "ioo", i: 0 }, { kind: "ioo", i: 1 }];
    if (ratio >= 1) return [{ kind: "venue" }];
    const slots = [];
    let acc = 0;
    for (let n = 0; n < 10; n++) {
      acc += ratio;
      if (acc >= 1) { slots.push({ kind: "venue" }); acc -= 1; }
      else slots.push({ kind: "ioo", i: slots.filter((s) => s.kind === "ioo").length % IOO_CREATIVES.length });
    }
    return slots;
  }, [ratio]);

  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState("");
  const timer = useRef(null);
  useEffect(() => {
    if (deck.length <= 1) return;
    timer.current = setInterval(() => {
      setFade("fade-out");
      setTimeout(() => {
        setIdx((i) => (i + 1) % deck.length);
        setFade("fade-in");
        setTimeout(() => setFade(""), 400);
      }, 250);
    }, ROTATE_MS);
    return () => clearInterval(timer.current);
  }, [deck.length]);

  const slot = deck[idx % deck.length] || deck[0];
  const isIoo = slot.kind === "ioo";
  const creative = isIoo ? IOO_CREATIVES[slot.i % IOO_CREATIVES.length] : sponsor;

  return (
    <div className={`tall-promo${isIoo ? " ioo" : ""} ${fade}`}>
      <div className="tall-promo__hero">
        {isIoo ? (
          <PhoneMock liveFixtures={liveFixtures} upcoming={upcoming} />
        ) : sponsor.image ? (
          <img className="tall-promo__img" src={sponsor.image} alt="" />
        ) : (
          <div className="tall-promo__slot">
            <div className="glyph">{(venue?.name || "?").slice(0, 2).toUpperCase()}</div>
            <div className="lbl">Sponsor image<br />(uploaded by venue)</div>
          </div>
        )}
      </div>
      <div className="tall-promo__body">
        <div className="tall-promo__tag">{creative.tag}</div>
        <div className="tall-promo__title">{creative.title}</div>
        {creative.sub && <div className="tall-promo__sub">{creative.sub}</div>}
        <div className="tall-promo__cta">
          <div className="tall-promo__url">{creative.url}</div>
          <div className="tall-promo__arrow">→</div>
        </div>
      </div>
    </div>
  );
}
