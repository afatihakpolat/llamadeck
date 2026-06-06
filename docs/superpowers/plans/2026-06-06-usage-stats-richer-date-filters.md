# Usage Stats Richer Date Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-chip window selector (Today / 7d / All time) with five preset chips plus a custom date range picker, persist the chosen filter across app restarts, and replace the `UsageStatsWindow` enum on the wire with an explicit `fromTimestamp`/`toTimestamp` range so the main process can drop its duplicated `getWindowStart` helpers.

**Architecture:** Renderer computes the timestamp range for the active preset (or accepts the user's custom range verbatim) and sends it to the main process via the existing `get-usage-stats` IPC. The main process filters by the two timestamps directly — no enum, no helper. Renderer-only type `UsageStatsWindow` lives in `UsageStatsView.tsx`. Persistence is a small `localStorage` read/write pair on the query state, versioned with a `_v1` suffix.

**Tech Stack:** TypeScript, React, Zustand (unchanged), Electron IPC. No new dependencies, no new test framework — verification is `npm run build` and a manual smoke test (matches the established project pattern).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` (modify) | Drop `UsageStatsWindow`; update `UsageStatsQuery` to use `fromTimestamp`/`toTimestamp`. |
| `src/main/usageLedger.ts` (modify) | Delete `getWindowStart`; replace its single call site with `query.fromTimestamp`/`toTimestamp` directly. |
| `src/main/usageSessions.ts` (modify) | Delete `getWindowStart`; update `getWindowedDailyRollups` signature; replace two call sites with `query.fromTimestamp`/`toTimestamp`. |
| `src/main/ipc.ts` (modify) | Update the `get-usage-stats` handler's normalized query to use `fromTimestamp`/`toTimestamp` instead of `window`. |
| `src/renderer/src/components/UsageStatsView.tsx` (modify) | Add renderer-only `UsageStatsWindow` type, `WINDOW_OPTIONS` (5 presets), `presetToRange` helper, custom-range panel state and JSX, `localStorage` persistence. |
| `src/renderer/src/styles/global.css` (modify) | Add `.usage-stats-custom-range` styling for the inline custom-range panel. |
| `docs/HANDOFF.md` (modify) | Add completion line, verification line, and manual smoke test list. |

No new dependencies, no new files, no new IPC handlers.

---

## Task 1: Update shared types

**Files:**
- Modify: `src/shared/types.ts:52-53` (drop `UsageStatsWindow`)
- Modify: `src/shared/types.ts:145-149` (update `UsageStatsQuery`)

- [ ] **Step 1: Drop `UsageStatsWindow` from shared types**

Open `src/shared/types.ts`. Delete the existing `UsageStatsWindow` type (line 52):

```ts
export type UsageStatsWindow = 'today' | '7d' | 'all'
```

This type is now defined in the renderer only. (Confirmed: preload never references it.)

- [ ] **Step 2: Update `UsageStatsQuery` to use timestamp range**

In the same file, replace the `UsageStatsQuery` interface (line 145-149):

```ts
export interface UsageStatsQuery {
  fromTimestamp: number
  toTimestamp: number
  templateId?: string | null
  limit?: number
}
```

The `window` field is gone. `fromTimestamp = 0` represents "all time" (epoch); `toTimestamp` defaults to `Date.now()` in the IPC handler.

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: errors will appear in `ipc.ts`, `usageLedger.ts`, `usageSessions.ts`, and `UsageStatsView.tsx` (all downstream). This is expected and will be fixed by Tasks 2-4. **Do not** address the errors here — proceed.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): replace UsageStatsWindow enum with from/to timestamp range"
```

---

## Task 2: Update main process — `usageLedger.ts` and `usageSessions.ts`

**Files:**
- Modify: `src/main/usageLedger.ts:113-119` (delete `getWindowStart`); `:199` (drop `window` from normalized query); `:203,206` (use `query.fromTimestamp` directly)
- Modify: `src/main/usageSessions.ts:96-104` (delete `getWindowStart`); `:339-345` (update `getWindowedDailyRollups` signature); `:350,396,400,412,472` (use `query.fromTimestamp`/`toTimestamp`)

- [ ] **Step 1: Delete `getWindowStart` in `usageLedger.ts`**

In `src/main/usageLedger.ts`, delete the function at lines 113-119:

```ts
function getWindowStart(window: UsageStatsQuery['window']): number {
  const now = new Date()
  if (window === 'all') return 0
  if (window === '7d') return Date.now() - (7 * 24 * 60 * 60 * 1000)

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}
```

- [ ] **Step 2: Update the call site in `usageLedger.ts`**

Find the function that builds the normalized query and applies the window filter (around lines 195-210). Edit it so:

1. The normalized query no longer includes `window`. Replace the `window: query.window` line with a from/to pair.
2. The window filter uses `query.fromTimestamp` instead of `windowStart`.

The original code looks like:

```ts
const normalizedQuery: UsageStatsQuery = {
  window: query.window,
  templateId: query.templateId ?? null,
  limit: Math.min(query.limit ?? 20, 20)
}
const windowStart = getWindowStart(normalizedQuery.window)
...
if (record.finishedAt && new Date(record.finishedAt).getTime() < windowStart) {
  continue
}
```

Replace with:

```ts
const normalizedQuery: UsageStatsQuery = {
  fromTimestamp: query.fromTimestamp,
  toTimestamp: query.toTimestamp,
  templateId: query.templateId ?? null,
  limit: Math.min(query.limit ?? 20, 20)
}
...
const fromTimestamp = normalizedQuery.fromTimestamp
...
if (record.finishedAt && new Date(record.finishedAt).getTime() < fromTimestamp) {
  continue
}
```

(Adjust the exact variable name `fromTimestamp` to match the local name in the surrounding code; the goal is to replace `windowStart` with a from-timestamp variable that's read from `normalizedQuery` directly.)

- [ ] **Step 3: Delete `getWindowStart` in `usageSessions.ts`**

In `src/main/usageSessions.ts`, delete the function at lines 96-104:

```ts
function getWindowStart(window: UsageStatsQuery['window']): number {
  const now = new Date()
  if (window === 'all') return 0

  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (window === '7d') return localMidnight - (6 * 24 * 60 * 60 * 1000)

  return localMidnight
}
```

- [ ] **Step 4: Update `getWindowedDailyRollups` signature in `usageSessions.ts`**

Replace the function at lines 339-345 with a version that takes a from-timestamp directly (no `window` parameter):

```ts
function getWindowedDailyRollups(session: UsagePersistedSession, fromTimestamp: number): UsageDailyRollup[] {
  if (fromTimestamp === 0) {
    return session.dailyRollups
  }

  return session.dailyRollups.filter((dailyRollup) => toDayTimestamp(dailyRollup.day) >= fromTimestamp)
}
```

`fromTimestamp === 0` is the new "all time" sentinel (matches the new `UsageStatsQuery` contract).

- [ ] **Step 5: Update the call sites in `usageSessions.ts`**

In the snapshot-builder (around lines 393-475), find these three changes:

1. **Lines ~395-400**: drop `window` from the normalized query, drop the `getWindowStart` call.

Original:
```ts
const normalizedQuery: UsageStatsQuery = {
  window: query.window,
  templateId: query.templateId ?? null,
  limit: Math.min(query.limit ?? 20, 20)
}
const windowStart = getWindowStart(normalizedQuery.window)
```

Replacement:
```ts
const normalizedQuery: UsageStatsQuery = {
  fromTimestamp: query.fromTimestamp,
  toTimestamp: query.toTimestamp,
  templateId: query.templateId ?? null,
  limit: Math.min(query.limit ?? 20, 20)
}
```

The `windowStart` variable is no longer needed for the from-filter. The `toTimestamp` is currently unused in `usageSessions.ts` — the sessions store includes per-day rollups and per-request rows, all of which are filtered only by `from`. (Add a `toTimestamp` filter on per-request `finishedAt` only if the existing semantics requires it; the current code only filters from, so leave it as-is.)

2. **Line ~412**: update the `getWindowedDailyRollups` call.

Original:
```ts
const windowedDailyRollups = getWindowedDailyRollups(session, windowStart, normalizedQuery.window)
```

Replacement:
```ts
const windowedDailyRollups = getWindowedDailyRollups(session, normalizedQuery.fromTimestamp)
```

3. **Line ~472**: update the `recentRequests` filter.

Original:
```ts
return new Date(record.finishedAt).getTime() >= windowStart
```

Replacement (since `windowStart` no longer exists):
```ts
return new Date(record.finishedAt).getTime() >= normalizedQuery.fromTimestamp
```

- [ ] **Step 6: Verify TypeScript still compiles (main process only)**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no new errors in `usageLedger.ts` or `usageSessions.ts`. The IPC handler in `ipc.ts` will still error (next task) and the renderer will still error (Task 4). Confirm no errors introduced by THIS task by checking that any remaining error lines reference `ipc.ts` or `UsageStatsView.tsx`, not `usageLedger.ts`/`usageSessions.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/main/usageLedger.ts src/main/usageSessions.ts
git commit -m "refactor(main): drop getWindowStart, use query.fromTimestamp directly"
```

---

## Task 3: Update IPC handler

**Files:**
- Modify: `src/main/ipc.ts:1939-1947` (`get-usage-stats` handler)

- [ ] **Step 1: Update the normalized query in the handler**

In `src/main/ipc.ts`, replace the body of the `get-usage-stats` handler (lines 1939-1947):

Original:
```ts
ipcMain.handle('get-usage-stats', (_e, partialQuery?: Partial<UsageStatsQuery>) => {
  const query: UsageStatsQuery = {
    window: partialQuery?.window ?? '7d',
    templateId: partialQuery?.templateId ?? null,
    limit: partialQuery?.limit ?? 20
  }

  return buildUsageStatsSnapshotFromSessions(Array.from(persistedUsageSessions.values()), getLiveUsageSessions(), recentUsageRequests, query)
})
```

Replacement:
```ts
ipcMain.handle('get-usage-stats', (_e, partialQuery?: Partial<UsageStatsQuery>) => {
  const query: UsageStatsQuery = {
    fromTimestamp: partialQuery?.fromTimestamp ?? 0,
    toTimestamp: partialQuery?.toTimestamp ?? Date.now(),
    templateId: partialQuery?.templateId ?? null,
    limit: partialQuery?.limit ?? 20
  }

  return buildUsageStatsSnapshotFromSessions(Array.from(persistedUsageSessions.values()), getLiveUsageSessions(), recentUsageRequests, query)
})
```

`fromTimestamp ?? 0` (all time) + `toTimestamp ?? Date.now()` (now) are the safe fallbacks when the renderer doesn't send values. The renderer will always send both, but the fallbacks keep the IPC forgiving.

- [ ] **Step 2: Verify TypeScript compiles (main process)**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: zero new errors in `ipc.ts`. Only `UsageStatsView.tsx` (renderer) should still error — Task 4 fixes that.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(main): accept from/to timestamp range in get-usage-stats"
```

---

## Task 4: Update renderer — query state, helpers, persistence, custom-range panel JSX

**Files:**
- Modify: `src/renderer/src/components/UsageStatsView.tsx`

This is the largest task. It contains four sub-changes that all live in the same file: the local `UsageStatsWindow` type and helper, the new 5-chip `WINDOW_OPTIONS` and `DEFAULT_QUERY`, the `localStorage` persistence, the chip-click handler, the disclosure toggle, and the custom-range panel JSX.

- [ ] **Step 1: Add the renderer-only `UsageStatsWindow` type and `presetToRange` helper**

In `src/renderer/src/components/UsageStatsView.tsx`, add the new type and helper immediately after the existing `WINDOW_OPTIONS` and `DEFAULT_QUERY` block (around line 29). Use the file's existing style (2-space indent, no trailing semicolons on field declarations):

```ts
type UsageStatsWindow = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'

const STORAGE_KEY = 'llamadeck_usage_stats_query_v1'

function presetToRange(preset: Exclude<UsageStatsWindow, 'custom'>): { fromTimestamp: number; toTimestamp: number } {
  const now = new Date()
  const toTimestamp = now.getTime()
  if (preset === 'all') return { fromTimestamp: 0, toTimestamp }

  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (preset === 'today') return { fromTimestamp: localMidnight, toTimestamp }
  if (preset === '7d') return { fromTimestamp: localMidnight - 6 * 24 * 60 * 60 * 1000, toTimestamp }
  if (preset === '30d') return { fromTimestamp: localMidnight - 29 * 24 * 60 * 60 * 1000, toTimestamp }
  // 'month' is calendar-month-to-date: 1st of current local month at 00:00 → now
  return { fromTimestamp: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), toTimestamp }
}

function detectPreset(fromTimestamp: number, toTimestamp: number, now: number = Date.now()): UsageStatsWindow {
  for (const preset of ['today', '7d', '30d', 'month', 'all'] as const) {
    const range = presetToRange(preset)
    if (range.fromTimestamp === fromTimestamp && range.toTimestamp === toTimestamp) {
      return preset
    }
  }
  // 'all' has a moving toTimestamp (now). Tolerate close-to-now by allowing within 60s.
  if (fromTimestamp === 0 && Math.abs(toTimestamp - now) < 60_000) return 'all'
  return 'custom'
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fromDateInputToLocalMidnightStart(value: string): number {
  // value is YYYY-MM-DD; interpret as local-midnight start of that day
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function fromDateInputToLocalEndOfDay(value: string): number {
  // value is YYYY-MM-DD; interpret as end-of-day local (23:59:59.999) on that day
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
}
```

Note: `'7d'` is "last 7 days" = local-midnight 6 days ago through now. This matches the existing `usageSessions.ts` semantics (calendar-day aligned, not rolling 24h). The old `usageLedger.ts` used rolling 24h; the spec calls this a latent inconsistency that's resolved in favor of the calendar-day semantics.

- [ ] **Step 2: Update `WINDOW_OPTIONS` to 5 presets and `DEFAULT_QUERY` to use timestamps**

Replace the existing `WINDOW_OPTIONS` and `DEFAULT_QUERY` constants (lines 19-29) with:

```ts
const WINDOW_OPTIONS: Array<{ label: string; value: Exclude<UsageStatsWindow, 'custom'> }> = [
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This month', value: 'month' },
  { label: 'All time', value: 'all' }
]

const DEFAULT_QUERY: UsageStatsQuery = (() => {
  const now = new Date()
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return {
    fromTimestamp: localMidnight - 6 * 24 * 60 * 60 * 1000,
    toTimestamp: now.getTime(),
    templateId: null,
    limit: 100
  }
})()
```

`WINDOW_OPTIONS` excludes `'custom'` (it's a derived state, not a selectable preset). `DEFAULT_QUERY` is computed at module load using the same "last 7 days" formula as the old `'7d'` window.

- [ ] **Step 3: Add `localStorage` persistence**

In the `UsageStatsView` component body, add a hydrated query state and a write effect. Place the new state right after the existing `useState` declarations (around line 377). The pattern: lazy-init the `useState` from `localStorage`; a `useEffect` writes back on every query change.

Replace the existing `useState<UsageStatsQuery>(DEFAULT_QUERY)` line (line 368):

```ts
const [query, setQuery] = useState<UsageStatsQuery>(() => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_QUERY
    const parsed = JSON.parse(raw) as Partial<UsageStatsQuery>
    return {
      fromTimestamp: typeof parsed.fromTimestamp === 'number' && Number.isFinite(parsed.fromTimestamp) ? parsed.fromTimestamp : DEFAULT_QUERY.fromTimestamp,
      toTimestamp: typeof parsed.toTimestamp === 'number' && Number.isFinite(parsed.toTimestamp) ? parsed.toTimestamp : DEFAULT_QUERY.toTimestamp,
      templateId: typeof parsed.templateId === 'string' || parsed.templateId === null ? parsed.templateId : null,
      limit: typeof parsed.limit === 'number' ? parsed.limit : 100
    }
  } catch (storageError) {
    console.warn('Failed to load saved usage stats query, falling back to defaults:', storageError)
    return DEFAULT_QUERY
  }
})
```

Add a write-back effect right after the `queryRef` and existing query `useEffect` blocks (around line 470):

```ts
useEffect(() => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(query))
  } catch (storageError) {
    console.warn('Failed to persist usage stats query:', storageError)
  }
}, [query])
```

- [ ] **Step 4: Update the `useEffect` that loads the snapshot to depend on the new fields**

Find the `useEffect` at line 510:

Original:
```ts
useEffect(() => {
  void loadSnapshot(query, 'initial')
}, [query.window, query.templateId])
```

Replacement:
```ts
useEffect(() => {
  void loadSnapshot(query, 'initial')
}, [query.fromTimestamp, query.toTimestamp, query.templateId])
```

- [ ] **Step 5: Add the custom-range panel state, toggle, and apply handler**

In the `UsageStatsView` component body, after the existing `useState` declarations, add:

```ts
const [customRangeOpen, setCustomRangeOpen] = useState(false)
const [customFrom, setCustomFrom] = useState<string>('')
const [customTo, setCustomTo] = useState<string>('')
```

Add a click handler for the chips and the apply handler, somewhere in the component (e.g., right before the return statement):

```ts
function handlePresetClick(preset: Exclude<UsageStatsWindow, 'custom'>) {
  const range = presetToRange(preset)
  setQuery((current) => ({ ...current, fromTimestamp: range.fromTimestamp, toTimestamp: range.toTimestamp }))
  setCustomRangeOpen(false)
}

function openCustomRange() {
  // Pre-fill the inputs with the current query range so the user has a sensible starting point.
  setCustomFrom(toDateInputValue(query.fromTimestamp))
  setCustomTo(toDateInputValue(query.toTimestamp))
  setCustomRangeOpen(true)
}

function applyCustomRange() {
  if (!customFrom || !customTo) return
  const fromDate = new Date(customFrom)
  const toDate = new Date(customTo)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return
  const fromTimestamp = fromDateInputToLocalMidnightStart(customFrom)
  const toTimestamp = fromDateInputToLocalEndOfDay(customTo)
  if (fromTimestamp > toTimestamp) return
  setQuery((current) => ({ ...current, fromTimestamp, toTimestamp }))
  setCustomRangeOpen(false)
}
```

The active preset for chip highlighting is `detectPreset(query.fromTimestamp, query.toTimestamp)`. Compute it once near the existing derived values (e.g., right after the `useState` calls):

```ts
const activePreset: UsageStatsWindow = detectPreset(query.fromTimestamp, query.toTimestamp)
const customFromValid = !!customFrom
const customToValid = !!customTo
const customRangeValid = customFromValid && customToValid && (() => {
  const fromTs = fromDateInputToLocalMidnightStart(customFrom)
  const toTs = fromDateInputToLocalEndOfDay(customTo)
  return Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs <= toTs
})()
```

To avoid recomputing `fromTs`/`toTs` on every render, this is fine in JSX context — the compute is cheap. If desired, wrap in `useMemo`, but not required.

- [ ] **Step 6: Replace the chip rendering with 5 chips + Custom disclosure + panel**

Find the existing chip rendering in the page header (around line 511-523). Original:

```tsx
<div className="usage-stats-filter-group">
  {WINDOW_OPTIONS.map((option) => (
    <button
      key={option.value}
      className={`usage-window-chip ${query.window === option.value ? 'active' : ''}`}
      onClick={() => setQuery((current) => ({ ...current, window: option.value }))}
    >
      {option.label}
    </button>
  ))}
</div>
```

Replacement:

```tsx
<div className="usage-stats-filter-group">
  {WINDOW_OPTIONS.map((option) => (
    <button
      key={option.value}
      className={`usage-window-chip ${activePreset === option.value ? 'active' : ''}`}
      onClick={() => handlePresetClick(option.value)}
    >
      {option.label}
    </button>
  ))}
  <button
    type="button"
    className={`usage-window-chip ${activePreset === 'custom' ? 'active' : ''}`}
    onClick={openCustomRange}
  >
    Custom
  </button>
</div>
{customRangeOpen && (
  <div className="usage-stats-custom-range">
    <label className="usage-control-field">
      <span>From</span>
      <input
        className="form-input"
        type="date"
        value={customFrom}
        onChange={(event) => setCustomFrom(event.target.value)}
      />
    </label>
    <label className="usage-control-field">
      <span>To</span>
      <input
        className="form-input"
        type="date"
        value={customTo}
        onChange={(event) => setCustomTo(event.target.value)}
        min={customFrom || undefined}
      />
    </label>
    <div className="usage-stats-custom-range-actions">
      <button
        type="button"
        className="btn btn-primary"
        onClick={applyCustomRange}
        disabled={!customRangeValid}
      >
        Apply
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setCustomRangeOpen(false)}
      >
        Cancel
      </button>
    </div>
  </div>
)}
```

The Custom chip uses the same `usage-window-chip` class so it visually matches the presets, and gets the `active` class when `activePreset === 'custom'`. The inline panel sits below the chip group inside the page header.

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: completes with no new errors in `UsageStatsView.tsx`. The remaining pre-existing 12 tsc errors are unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/UsageStatsView.tsx
git commit -m "feat(renderer): richer date filters with 5 presets and custom range"
```

---

## Task 5: Add CSS for the custom-range panel

**Files:**
- Modify: `src/renderer/src/styles/global.css` (one new class)

- [ ] **Step 1: Add the `.usage-stats-custom-range` rule**

In `src/renderer/src/styles/global.css`, add the new rule near the existing `usage-stats-filter-group` and `usage-window-chip` rules (around line 1033). Match the file's style (2-space indent, lowercase class names, variable-based theming):

```css
.usage-stats-custom-range {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-top: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.usage-stats-custom-range-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
```

The `.usage-control-field` class is reused for the From / To labels (it already exists and gives the label-above-input layout used elsewhere in the file).

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: completes with no errors. The CSS rule is bundled into the renderer output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles/global.css
git commit -m "style(renderer): add custom-range panel styles for date filter"
```

---

## Task 6: Update HANDOFF

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add a completion bullet**

In `docs/HANDOFF.md`, under `## Completed`, add a new bullet at the end of the list:

```markdown
- Replaced the three-chip date window on Usage Stats with five preset chips (Today, Last 7 days, Last 30 days, This month, All time) plus a Custom range picker (two `<input type="date">` + Apply). The filter is persisted to localStorage so the user's choice survives an app restart. The data model switched from a `window` enum to an explicit `fromTimestamp`/`toTimestamp` range, which let the main process drop its duplicated `getWindowStart` helpers.
```

- [ ] **Step 2: Add a verification line**

Under `## Verification` in the same file, add:

```markdown
- `npm run build` after switching the Usage Stats filter to a from/to timestamp range with five presets and a Custom range picker
```

- [ ] **Step 3: Add the manual smoke test list**

Under `## Next Recommended Check`, append:

```markdown
- Manual smoke test for richer date filters: click each preset chip (Today / 7d / 30d / This month / All time) and confirm the summary cards and rollup tables recalculate, with the active chip highlighted. Open the Custom range disclosure, set a from/to spanning a few days, click Apply, and confirm the data updates and no chip is highlighted (now in "Custom" mode). Set `from > to` in the Custom panel and confirm the Apply button is disabled. Set one of the dates blank and confirm Apply is disabled. Pick a filter, close the app, reopen, and confirm the same filter is restored. Confirm "All time" still works (no records filtered out). Confirm the Cost tab's per-row pricing still resolves correctly (regression check that the IPC change didn't break the existing snapshot shape).
```

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: record richer date filters in HANDOFF"
```

---

## Task 7: Final build verification

**Files:**
- (no file changes — verification only)

- [ ] **Step 1: Run the build**

Run: `npm run build`
Expected: completes with no errors. The renderer bundle includes the new CSS rule; main + preload bundles are unchanged in shape.

- [ ] **Step 2: Run the tsc baseline check**

Run: `npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -c "error TS"`
Expected: **12** (matches the pre-existing baseline of 12; none in the changed files).

- [ ] **Step 3: Confirm the diff scope**

Run: `git log main..HEAD --oneline` (or `git log --oneline -7` if the work is on a feature branch)
Expected: 6 commits matching the task structure (types, main, IPC, renderer, CSS, HANDOFF).

No commit needed — Task 7 is verification only.

---

## Self-Review (executed inline while writing)

**Spec coverage:** Skim each section of `docs/superpowers/specs/2026-06-06-usage-stats-richer-date-filters-design.md`:

- Goal (5 presets + custom + persistence + dedup getWindowStart) → Tasks 4, 5, 2, 6.
- Non-Goals (no other filter dimensions) → no extra tasks added; respected.
- Data Model (`UsageStatsQuery` with `fromTimestamp`/`toTimestamp`; `UsageStatsWindow` renderer-only) → Task 1 (types), Task 4 (renderer-only).
- Architecture — main process (ipc.ts:1939, usageLedger.ts:113, usageSessions.ts:96, getWindowedDailyRollups signature) → Tasks 2, 3.
- Architecture — renderer (UsageStatsWindow local type, WINDOW_OPTIONS, presetToRange, custom-range panel, persistence) → Task 4.
- CSS (`.usage-stats-custom-range`) → Task 5.
- Preload (no changes) → no task.
- Data Flow (chip click, custom apply, hydration, persistence) → Task 4.
- Edge Cases (localStorage unavailable, stale shape, from > to, blank inputs, "This month" semantics, end-of-day toTimestamp) → Task 4 (hydration try/catch, versioned key, customRangeValid disable, end-of-day helper).
- Affected Files → Tasks 1-6 cover all 7 files.
- Out of Scope / Future → no tasks added (correct).
- Testing & Verification (npm run build, tsc baseline, 7-step smoke test) → Task 7 + Task 6 (HANDOFF smoke test list).

**Placeholder scan:** No "TBD", "TODO", "implement later", "fill in details", "add appropriate error handling", "similar to Task N", or unreferenced types. Every code step shows the actual code.

**Type consistency:**
- `UsageStatsWindow` is declared in Task 4 step 1 with 6 values; `WINDOW_OPTIONS` in step 2 uses `Exclude<UsageStatsWindow, 'custom'>` — consistent.
- `presetToRange` return type is `{ fromTimestamp: number; toTimestamp: number }` — used consistently in `detectPreset` and the click handlers.
- `STORAGE_KEY` is declared in Task 4 step 1 and referenced in step 3 (read) and the write effect — consistent.
- `toDateInputValue`, `fromDateInputToLocalMidnightStart`, `fromDateInputToLocalEndOfDay` are declared in step 1 and used in step 5 — consistent.
- The `UsageStatsQuery` shape in Task 1 (types) matches what `DEFAULT_QUERY` produces in Task 4 step 2 and what `setQuery` calls produce throughout Task 4.
- `applyCustomRange` in Task 4 step 5 calls `setQuery({ ...current, fromTimestamp, toTimestamp })` — matches the `UsageStatsQuery` shape from Task 1.

No mismatches found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-usage-stats-richer-date-filters.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
