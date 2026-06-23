import React, { useState, useMemo } from "react";
import Icon from "./Icon.jsx";

// Shared page primitives for the venue console IA (Venue People & Spaces epic, Phase 1).
//
// ViewSubhead — a one-line plain-English explainer under a page title, so a first-time
// operator knows what the view is for.
//
// TabbedPage — renders a set of related sub-views as tabs. The caller passes ONLY the
// sub-views that are visible (flag + discipline already filtered upstream); when exactly
// one qualifies the tab bar collapses and it renders bare. Each tab carries its own
// subhead. Tabs reuse the existing token-based styles (no hardcoded colour).

export function ViewSubhead({ children }) {
  if (!children) return null;
  return <p className="view-sub">{children}</p>;
}

// tabs: [{ id, label, subhead?, render: () => ReactNode }] — pre-filtered to the visible set.
// initial: an id to open first (e.g. from a legacy deep-link alias); falls back to the first tab.
export function TabbedPage({ tabs, initial }) {
  const valid = (tabs || []).filter(Boolean);
  const [active, setActive] = useState(() =>
    (initial && valid.some((t) => t.id === initial)) ? initial : valid[0]?.id
  );

  if (valid.length === 0) {
    return <div className="text-mute" style={{ padding: 24 }}>Nothing to show here yet.</div>;
  }

  const current = valid.find((t) => t.id === active) || valid[0];

  return (
    <div>
      {valid.length > 1 && (
        <div className="view-tabs" role="tablist">
          {valid.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="view-tab"
              aria-selected={t.id === current.id}
              aria-pressed={t.id === current.id}
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <ViewSubhead>{current.subhead}</ViewSubhead>
      <div className="view-tab-body">{current.render()}</div>
    </div>
  );
}

// DataTable — the shared sortable/searchable/filterable table for the venue console
// IA (Venue People & Spaces epic, Phase 2 — first consumer: the Teams page). Reuses
// the existing token-based .dt / .dt-card / .dt-toolbar / .chips / .search styles.
//
// columns: [{
//   key,                      // unique column id; default cell = row[key]
//   label,                    // header text
//   align?: "num" | "center", // cell/header alignment class
//   sortable?: bool,          // header click sorts on this column
//   render?: (row) => node,   // custom cell
//   sortValue?: (row) => any, // value used for sorting (defaults to row[key])
//   width?: number,           // fixed column width (px)
// }]
// rows:        array of row objects (already loaded; null = loading)
// getRowKey:   (row) => string|number — stable React key
// searchFields:[keys] OR searchFn (row, lowerQuery) => bool. Omit to hide search.
// filters:     [{ id, label, test: (row) => bool }] — an "All" chip is prepended.
// onRowClick:  (row) => void — makes rows clickable (keyboard-accessible).
// initialSort: { key, dir: "asc"|"desc" }
// toolbarRight: extra node rendered at the right of the toolbar.
// empty / noMatch: { title, body } — empty = no rows at all; noMatch = filtered to none.
export function DataTable({
  columns, rows, getRowKey, searchFields, searchFn, searchPlaceholder = "Search…",
  filters, onRowClick, initialSort, toolbarRight, empty, noMatch,
}) {
  const [q, setQ] = useState("");
  const [filterId, setFilterId] = useState("all");
  const [sort, setSort] = useState(initialSort || null);

  const loading = rows == null;
  const list = rows || [];

  const filterDefs = useMemo(
    () => (filters && filters.length ? [{ id: "all", label: "All", test: () => true }, ...filters] : null),
    [filters]
  );

  const matchesSearch = (row) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    if (typeof searchFn === "function") return searchFn(row, needle);
    return (searchFields || []).some((f) => String(row[f] ?? "").toLowerCase().includes(needle));
  };

  const processed = useMemo(() => {
    let out = list.filter(matchesSearch);
    if (filterDefs) {
      const f = filterDefs.find((x) => x.id === filterId) || filterDefs[0];
      out = out.filter(f.test);
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const val = (r) => (col.sortValue ? col.sortValue(r) : r[col.key]);
        out = [...out].sort((a, b) => {
          const va = val(a), vb = val(b);
          let cmp;
          if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
          else cmp = String(va ?? "").localeCompare(String(vb ?? ""), undefined, { numeric: true, sensitivity: "base" });
          return sort.dir === "desc" ? -cmp : cmp;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, filterId, sort, columns, filterDefs]);

  const toggleSort = (key) => {
    setSort((s) =>
      s && s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };

  const showToolbar = (searchFields || searchFn || filterDefs || toolbarRight);

  return (
    <div className="dt-card">
      {showToolbar && (
        <div className="dt-toolbar">
          {filterDefs && (
            <span className="chips">
              {filterDefs.map((f) => (
                <button key={f.id} className="chip" aria-pressed={filterId === f.id} onClick={() => setFilterId(f.id)}>
                  {f.label}
                </button>
              ))}
            </span>
          )}
          <span className="spacer" />
          {toolbarRight}
          {(searchFields || searchFn) && (
            <span className="search">
              <span className="ico"><Icon name="search" size={15} /></span>
              <input placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
          )}
        </div>
      )}

      <table className="dt">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort && sort.key === c.key;
              return (
                <th
                  key={c.key}
                  className={(c.align || "") + (c.sortable ? " dt-sortable" : "") + (active ? " dt-sorted" : "")}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.label}
                  {c.sortable && <span className="dt-caret" aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {!loading && processed.map((row) => (
            <tr
              key={getRowKey(row)}
              className={onRowClick ? "dt-row-click" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? "button" : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align || ""}>
                  {c.render ? c.render(row) : (row[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {loading && <div className="text-mute" style={{ padding: 24 }}>Loading…</div>}
      {!loading && list.length === 0 && empty && (
        <div className="dt-empty"><div className="dt-empty-title">{empty.title}</div><div className="text-mute">{empty.body}</div></div>
      )}
      {!loading && list.length > 0 && processed.length === 0 && (
        <div className="dt-empty">
          <div className="dt-empty-title">{noMatch?.title || "Nothing matches"}</div>
          <div className="text-mute">{noMatch?.body || "Try a different search or filter."}</div>
        </div>
      )}
    </div>
  );
}
