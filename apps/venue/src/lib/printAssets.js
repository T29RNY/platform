// Print-friendly QR assets (slice 5): a full-page poster and a table-talker
// tent card the venue prints from the QR codes view. Takes the rendered
// react-qr-code <svg> (vector → scales crisply to any print size) + labels,
// and opens a print window. No deps, no server round-trip.

const PRINT_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0A0D14;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .brand{font-size:13px;letter-spacing:4px;text-transform:uppercase;color:#8A8A8A}
  .venue{font-weight:800;line-height:1.05}
  .scan{font-weight:700}
  .url{color:#9A9A9A}

  .poster{width:210mm;min-height:297mm;padding:26mm 20mm;text-align:center;
          display:flex;flex-direction:column;align-items:center}
  .poster .venue{font-size:46px;margin:10px 0 6px}
  .poster .lede{font-size:21px;color:#555;margin-bottom:40px}
  .poster .qr{width:320px;height:320px}
  .poster .qr svg{width:100%;height:100%;display:block}
  .poster .scan{font-size:27px;margin:34px 0 26px}
  .poster .steps{text-align:left;max-width:380px;font-size:18px;line-height:2.1;color:#333}
  .poster .url{margin-top:auto;padding-top:40px;font-size:14px}

  .talker{width:148mm;height:105mm;padding:12mm;display:flex;gap:12mm;
          align-items:center;border:1px dashed #CCC}
  .talker .qr{width:190px;height:190px;flex:0 0 auto}
  .talker .qr svg{width:100%;height:100%;display:block}
  .talker .tt-body{text-align:left}
  .talker .venue{font-size:28px;margin:6px 0 2px}
  .talker .scan{font-size:21px;margin:10px 0 6px}

  @media print{.sheet{page-break-after:always}}
`;

function openPrint(title, innerHtml) {
  const w = window.open("", "_blank", "width=840,height=1180");
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${PRINT_CSS}</style></head><body>${innerHtml}` +
    `<script>window.onload=function(){setTimeout(function(){window.print()},60)}</script>` +
    `</body></html>`
  );
  w.document.close();
}

function svgOf(holder) {
  return holder?.querySelector("svg")?.outerHTML || "";
}

export function printPoster(holder, { venueName, label, url }) {
  const svg = svgOf(holder);
  if (!svg) return;
  const isVenue = label === venueName;
  openPrint(`${label} — poster`,
    `<div class="sheet poster">
       <div class="brand">In or Out</div>
       <div class="venue">${venueName}</div>
       <div class="lede">${isVenue ? "See what's on &amp; join in seconds" : `Join ${label}`}</div>
       <div class="qr">${svg}</div>
       <div class="scan">Scan to join</div>
       <div class="steps">1.&nbsp; Open your phone camera<br>2.&nbsp; Point it at the code<br>3.&nbsp; Tap the link — you're in</div>
       <div class="url">${url}</div>
     </div>`);
}

export function printTableTalker(holder, { venueName, label, url }) {
  const svg = svgOf(holder);
  if (!svg) return;
  const isVenue = label === venueName;
  openPrint(`${label} — table talker`,
    `<div class="sheet talker">
       <div class="qr">${svg}</div>
       <div class="tt-body">
         <div class="brand">In or Out</div>
         <div class="venue">${venueName}</div>
         <div class="scan">Scan to join</div>
         <div>${isVenue ? "See what's on &amp; join" : label}</div>
         <div class="url">${url}</div>
       </div>
     </div>`);
}
