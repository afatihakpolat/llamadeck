# Titlebar Multi-Live-Sessions Design

## Problem Statement

The titlebar's live-session strip was designed to display exactly one running template. When several templates run concurrently, only the most recently active one is shown (with a `+N` hint for the rest), and only that session can be inspected or stopped from the header. Managing another running template forces a trip back to the Templates card view.

## Key Facts (already true, no main-process work)

- `getUsageStats` already returns the **full** `liveSessions` list. The `limit` query param only slices `recentRequests` (see `buildUsageStatsSnapshot` in `src/main/usageLedger.ts`). The titlebar already receives every running session.
- `stopModel(templateId)` stops an arbitrary template; there is no stop-all IPC (the renderer can fan out per-template stops).
- The titlebar already re-fetches the live list on every `onUsageUpdated` event, so chips and popover stay live without polling.

## Goal

- Zero live sessions: render nothing (unchanged).
- One live session: render the current detailed strip exactly as today (regression-safe for the common case).
- Two or more live sessions: render a compact chip per running template — each individually stoppable — plus a details popover with full per-session stats and a Stop all action.

## Non-Goals

- No main-process / IPC contract changes.
- No chip-click navigation into cards or Live Output (possible later; `focusModelOutput` already exists in the store).
- No controls beyond stop (restart, edit, etc. stay on the cards).
- No persisted "featured session" or per-chip user preferences.

## Requirements

- R1: With exactly one live session, the header renders the existing detailed strip (Running label, name, req/active/in/out/Last meta, Stop button) with unchanged behavior.
- R2: With two or more live sessions, the header shows one chip per session, ordered by most-recent activity first. Each chip shows a status dot, the template name (truncated), the active-request count (only when > 0), and a working per-template Stop button.
- R3: A chip's dot pulses while `activeRequests > 0` and is static green otherwise.
- R4: A details affordance opens a popover listing every live session with full stats (requests, active, uncached input, output, last activity), a per-row Stop button, and a Stop all button.
- R5: The popover closes on Escape or outside click. It stays open while stops are in flight; stopped sessions disappear from it as the live list updates.
- R6: When the live list drops to zero (e.g., Stop all succeeded), the whole header area — including the popover — unmounts.
- R7: Stop all issues stops for all live sessions concurrently, applies `setCardStatus(id, 'idle')` and removes only the sessions that stopped successfully, and surfaces failures with an aggregated alert.
- R8: A template with an in-flight stop has its Stop affordance(s) disabled; Stop all is disabled while any stop is in flight.
- R9: Rendering is unchanged for the zero- and one-session cases (no visual regression).
- R10: The existing width-based media queries still hide the strip below 920px; extra chips overflow horizontally with an internal scroll instead of breaking the layout.

## Design

### Presentation states

| liveSessions | Header area |
|---|---|
| 0 | nothing (status quo) |
| 1 | existing detailed strip, byte-for-byte same markup/behavior |
| 2+ | chip strip + details toggle + (optional open) popover |

### Component shape (`Titlebar.tsx`)

- `liveSessions` state stays; a `useMemo` sorts it with `sortLiveSessionsByRecency` (most recent `lastRequestAt ?? startedAt` first) — the same ordering the current "featured" pick used.
- `stoppingIds: Set<string>` replaces the single `stoppingTemplateId`, shared by single mode, chips, popover rows, and Stop all.
- `detailsOpen` local state toggles the popover; a `ref` on the multi-mode strip powers outside-click detection, plus an Escape keydown listener.
- `stopSession(session)` — existing single-stop flow: guard on `stoppingIds`, call `stopModel`, on success `setCardStatus(id, 'idle')` + drop from local list, on failure alert (unchanged single-session alert text).
- `stopAll()` — mark all current sessions stopping, `Promise.all` of `stopModel`, remove/sync the successful subset, aggregated failure alert, then clear the stopping marks.

### Pure helpers (`src/renderer/src/utils/titlebarSessions.ts`)

Extracted from `Titlebar.tsx` so the ordering/formatting logic is unit-testable under the node-env vitest convention (pure functions, no DOM):

- `sortLiveSessionsByRecency(sessions): UsageLiveSession[]`
- `formatUsageNumber(value): string` (Intl grouping)
- `formatUsageTimestamp(timestamp?): string` (fallbacks: `No tracked request yet` / `Unknown activity`)
- `getUncachedInputTokens(session): number` (max(prompt - cache, 0))
- `hasActiveRequests(session): boolean`

### Markup (multi mode)

```
.titlebar-session-strip (position: relative)
├─ .titlebar-live-chips            (flex row, overflow-x auto, no scrollbar)
│   └─ .titlebar-live-chip × N
│        ├─ .titlebar-live-chip-dot    (green; pulse animated iff active > 0)
│        ├─ .titlebar-live-chip-name   (130px max, ellipsis)
│        ├─ .titlebar-live-chip-active ("3 act", only when > 0)
│        └─ .titlebar-live-chip-stop   (18px square-icon button)
├─ .titlebar-live-details-toggle      (btn-ghost btn-icon, MoreHorizontal)
└─ .titlebar-live-popover (absolute, top: 100% + 8px, left: 0) when open
     ├─ header: "N running" + Stop all (btn-danger btn-sm)
     └─ rows: dot + name (+ lastError in warning color) | Stop button | meta line
```

### Styling

New rules in `src/renderer/src/styles/global.css` beside the existing `.titlebar-session-*` block, using existing tokens (`--surface`, `--surface-hover`, `--surface-selected`, `--border`, `--text*`, `--success`, `--danger`, `--shadow-lg`, `--radius-sm`) and the existing `pulse` keyframes, so both themes work without new tokens. `.titlebar-session-strip` gains `position: relative` (needed to anchor the popover; inert for single mode).

### Data flow

No IPC change: `getUsageStats({ limit: 1 })` call is unchanged (limit no longer matters for what the header shows, and keeping it small keeps the `recentRequests` payload lean). Live updates arrive through the existing `onUsageUpdated` subscription.

## Edge Cases

- 5+ templates: chip row scrolls horizontally (scrollbar hidden), strip keeps its existing max-width constraints.
- Very long template names: ellipsized in chips (130px) and popover rows; full name in `title` tooltips.
- `lastError` present: surfaced in the popover row in warning color, truncated, full text in tooltip.
- Stale sessions: already reconciled by the main process; the header just mirrors whatever `liveSessions` reports.
- Popover open + a stop completes: the row disappears on the next live update; popover stays open until empty, then unmounts with the strip (R5/R6).
- Two rapid clicks on one chip Stop: guarded by `stoppingIds` + disabled state (R8).

## Verification

- `npm run test:run` — new unit tests for the pure helpers (ordering, formatting fallbacks, uncached-token math, active-request boundary, sort stability).
- `npm run build` — typecheck + renderer bundle.
- Manual smoke: start 3 templates; confirm chips appear for all three with correct order, dot pulses only on the one currently serving a request, chip Stops retire individual chips, the details popover shows full stats for all rows, Stop all retires everything including the popover, and the one-session case still shows the original detailed strip.

## Alternatives Considered

- **A — chip strip only**: all-stop-capable and simple, but loses the detailed per-session stats when 2+ run (tokens, last activity, errors), which is the information the single-strip case currently provides.
- **B — popover only**: scales to any count with a clean header, but hides Stop behind an extra indirect click for the common "just stop that one" case.
- **C — hybrid (chosen)**: per-chip stop covers the common case at a glance; the popover provides depth. Best fit for a 44px titlebar without regressing the single-session experience.
