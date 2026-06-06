# Usage Stats Richer Date Filters Design

## Problem Statement

LlamaDeck's Usage Stats page only exposes three time windows — `Today`, `Last 7 days`, `All time` — selected via three chips at the top of the page. Users with monthly billing cycles, custom reporting windows, or interest in any period other than the last 7 days currently can't filter the cost and rollup views to that range.

The existing filter state is also kept in local component state rather than persisted, so the user has to re-pick their filter on every app launch.

## Goal

- Replace the three-chip window selector with five preset windows plus a custom date range picker.
- Persist the chosen filter (preset or custom range) across app restarts.
- Keep the data model simple: a single timestamp-range query that the main process filters by directly. No more window enum on the wire.
- Eliminate the duplicated `getWindowStart` in `usageLedger.ts` and `usageSessions.ts` as a side effect.

## Non-Goals

- Status filters, endpoint filters, free-text search, token thresholds, or any other filter dimensions. The user explicitly chose "Richer date filters only."
- Server-side query caching or aggregation changes.
- Visual redesign of the Usage Stats page header beyond the filter controls.
- Changing how the cost analysis tab reads the query.

## Actors

- A desktop user who runs a mix of templates and wants to see usage / cost for a specific month, week, or arbitrary date range.

## Use Cases

- A user picks "This month" to review the current month's spend across all templates.
- A user picks "Last 30 days" to compare against a 30-day rolling window.
- A user opens the Custom range picker, enters a 14-day range, and clicks Apply.
- A user closes the app with the filter set to "Last 30 days" and reopens — the same filter is restored.

## Data Model

```
UsageStatsQuery (replaces window with explicit timestamp range)
├─ fromTimestamp: number   // ms, 0 = "all time" (epoch)
├─ toTimestamp: number     // ms, default = now
├─ templateId?: string | null
└─ limit?: number

UsageStatsWindow (renderer-only — was in shared/types)
├─ 'today'                 // local midnight → now
├─ '7d'                    // now − 7d at local midnight → now
├─ '30d'                   // now − 30d at local midnight → now
├─ 'month'                 // 1st of local month at 00:00 → now
├─ 'all'                   // 0 → now
└─ 'custom'                // user-entered from/to (selected when from/to don't match a preset)
```

`UsageStatsWindow` is removed from `src/shared/types.ts` and lives in `src/renderer/src/components/UsageStatsView.tsx`. Preload never referenced it (verified by grep), so the boundary is clean. The IPC receives `fromTimestamp`/`toTimestamp` directly, so the main process never needs the preset enum.

The duplicated `getWindowStart` in `usageLedger.ts:113` and `usageSessions.ts:96` is removed; both files filter by `query.fromTimestamp` / `query.toTimestamp` directly. As a side benefit, this fixes a latent inconsistency: `usageLedger.ts:113` uses `Date.now()` for `7d` (rolling semantics) while `usageSessions.ts:96` uses local midnight (calendar-day semantics). The new code uses local-midnight alignment throughout, controlled by the renderer's preset helper.

## Architecture

### Main process (`src/main/`)

- **`ipc.ts:1939` (`get-usage-stats` handler)**: replace `partialQuery?.window ?? '7d'` with `partialQuery?.fromTimestamp ?? <default>` and `partialQuery?.toTimestamp ?? Date.now()`. Drop the `window` field from the normalized query.
- **`usageLedger.ts:113` (`getWindowStart`)**: delete. The ledger filter (wherever it currently consumes `windowStart`) uses `query.fromTimestamp` and `query.toTimestamp` directly.
- **`usageSessions.ts:96` (`getWindowStart`)**: delete. Replace its two call sites with `query.fromTimestamp` and `query.toTimestamp` directly.
- **`usageSessions.ts:339` (`getWindowedDailyRollups`)**: signature changes to `(session, fromTimestamp, toTimestamp)` instead of `(session, windowStart, window)`.
- No new main-process files; no new IPC handlers; no preload changes.

### Renderer (`src/renderer/src/`)

- **`UsageStatsView.tsx`**:
  - New internal type `UsageStatsWindow = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'` (renderer-only).
  - New constant `WINDOW_OPTIONS` with 5 entries: Today, Last 7 days, Last 30 days, This month, All time.
  - New helper `presetToRange(preset: UsageStatsWindow): { fromTimestamp, toTimestamp }` — computes the local-midnight-aligned range for the chosen preset. `month` is calendar-month-to-date (1st of local month at 00:00 → now).
  - Query state holds `{ fromTimestamp, toTimestamp, templateId, limit }` (no `window` field). The `selectedPreset` is derived: if a preset's computed range matches `query.from/to` exactly, that's the active preset; otherwise `'custom'`.
  - Page header (Approach A — single row, custom disclosure on the right): 5 chips (existing layout) + a "Custom" disclosure button on the right of the chip group. Disclosure toggles a thin inline panel: two `<input type="date">` + Apply button. Apply sets `query.fromTimestamp` (interpreted as local-midnight start of the chosen day) and `query.toTimestamp` (end-of-day local on the chosen day). When `from > to`, Apply is disabled. The two date inputs pre-fill with the current `query.fromTimestamp` / `query.toTimestamp` converted to `YYYY-MM-DD` strings, so opening the panel always shows a sensible starting point; the inputs may be left blank in which case Apply is disabled.
  - Persistence: a small `useState` + `useEffect` pair on mount reads `localStorage.getItem('hexllama_usage_stats_query_v1')` and hydrates the query; on every `setQuery`, the effect writes back. Schema is `{ fromTimestamp, toTimestamp, templateId, limit }`. Versioned key so we can change shape later. On parse failure, fall back to the existing default (last 7 days).
- **No new Zustand state** — the store is unchanged. Filter state stays local to the component, just persisted.
- **No new CSS classes** — the date inputs use existing `form-input`; the chip pattern is unchanged. The custom-range inline panel uses a small `usage-stats-custom-range` class with the existing variable styling (`--surface`, `--border`, `--accent`).

### Preload (`src/preload/`)

- No changes. The `getUsageStats(query)` IPC already accepts a partial query; the field names change but the channel stays the same.

## Data Flow

- **Render**: load query from `localStorage` (or default) → render chips with the active one highlighted, the custom panel hidden unless active.
- **Click a chip**: `setQuery({ ...query, fromTimestamp: presetToRange(preset).from, toTimestamp: ...to })`. Triggers the existing `useEffect([query.window, query.templateId])` (which becomes `useEffect([query.fromTimestamp, query.toTimestamp, query.templateId])`).
- **Open custom panel, set dates, click Apply**: same `setQuery` path with the user values.
- **Reload the app**: hydration effect loads the saved query before the first render, so the user sees their last filter.

## Edge Cases & Failure Handling

- **`localStorage` unavailable** (e.g., Safari private mode in some versions, sandbox restrictions): `try/catch` around the read and write. Log to `console.warn`. Fall back to in-memory only (filters reset on reload). Don't break the page.
- **Persisted query has stale shape** (e.g., has a `window` field from before this change): the hydration `try/catch` falls back to default. The versioned key (`_v1`) plus the parse-on-read pattern means the old shape is silently migrated on next save.
- **`from > to`**: Apply button is disabled (cheap client-side check). The native date input also typically prevents invalid ranges when the second field has `min` set to the first field's value.
- **"This month" preset** is calendar-month-to-date (1st of current local month at 00:00 → now). No daylight-saving / timezone ambiguity because we use `Date(year, month, 1)` like the existing code.
- **Time of day inside the range**: `from` is local-midnight start of the chosen day; `to` is end-of-day local (23:59:59.999) on the chosen day. This matches the existing calendar-day semantics and means a user picking "Today" sees the full current day, not a rolling 24h window.
- **Cost tab rebudgeting on filter change**: the existing per-row resolver and per-template pricing lookup is unchanged. The Cost tab just receives a different snapshot from the same IPC.

## Affected Files

- `src/shared/types.ts` — drop `UsageStatsWindow`; update `UsageStatsQuery` to `fromTimestamp`/`toTimestamp`.
- `src/main/ipc.ts` — update the `get-usage-stats` handler's normalized query.
- `src/main/usageLedger.ts` — delete `getWindowStart`; use `query.fromTimestamp`/`query.toTimestamp` directly.
- `src/main/usageSessions.ts` — delete `getWindowStart`; update `getWindowedDailyRollups` signature; use `query.fromTimestamp`/`query.toTimestamp` directly.
- `src/renderer/src/components/UsageStatsView.tsx` — add `UsageStatsWindow` local type, `WINDOW_OPTIONS`, `presetToRange` helper, custom-range panel JSX, `useEffect` dep changes, persistence `useState`/`useEffect` pair.
- `src/renderer/src/components/Titlebar.tsx` — update the `getUsageStats({ window: 'all', limit: 1 })` call (line ~45) to use the new query shape. The simplest fix is to drop the `window` field and rely on the IPC handler's `fromTimestamp ?? 0` / `toTimestamp ?? Date.now()` defaults; an explicit `{ fromTimestamp: 0, toTimestamp: Date.now(), limit: 1 }` is also fine. (Missed in the original spec; surfaced during Task 1's tsc cascade.)
- `src/renderer/src/styles/global.css` — add `.usage-stats-custom-range` styling (one small rule for the inline panel).
- `docs/HANDOFF.md` — add completion line, verification line, and manual smoke test list.

## Out of Scope / Future

- Status, endpoint, or template-search filters (deliberately excluded by user).
- Persisting other Usage Stats filters (group-by, sort-by, status). They stay local; persistence of the date filter is the only one in scope.
- Calendar picker component (a `<input type="date">` is sufficient for the v1 and avoids a dependency).
- Custom range with time-of-day (date-only, end-of-day inferred for `to`).

## Testing & Verification

The project has no test framework and the user opted out of unit tests for the prior per-template-pricing feature. Verification here is the same pattern:

- **`npm run build`** must pass with no new errors.
- **`npx tsc --noEmit -p tsconfig.web.json`** error count must stay at the baseline (12 pre-existing errors, none in the changed files). Run before and after the change to confirm the count is unchanged.
- **Manual smoke test** (added to `docs/HANDOFF.md` "Next Recommended Check"):
  - [ ] Click each preset chip (Today / 7d / 30d / This month / All time) — confirm the summary cards and rollup tables recalculate, and the active chip is highlighted.
  - [ ] Open the Custom range disclosure, set a from/to spanning a few days, click Apply — confirm the data updates and no chip is highlighted (now in "Custom" mode).
  - [ ] Set `from > to` in the Custom panel — confirm the Apply button is disabled.
  - [ ] Set one of the dates blank — confirm the Apply button is disabled.
  - [ ] Pick a filter, close the app, reopen — confirm the same filter is restored.
  - [ ] Confirm "All time" still works (no records filtered out, `fromTimestamp` is 0).
  - [ ] Confirm the Cost tab's per-row pricing still resolves correctly (Cost tab uses the same snapshot, so no extra work needed; this is a regression check that the IPC change didn't break the existing snapshot shape).
