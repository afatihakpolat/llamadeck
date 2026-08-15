# Titlebar Multi-Live-Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show every running template in the titlebar — as individually stoppable chips — with a details popover (full stats per session + Stop all), while keeping the one-session detailed strip exactly as it is today.

**Architecture:** Renderer-only change. `getUsageStats` already returns the full `liveSessions` list; the Titlebar currently keeps only the newest. Split the header into three presentational states (0 / 1 / 2+) driven by a sorted memo of live sessions. Extract the pure ordering/formatting logic to `src/renderer/src/utils/titlebarSessions.ts` (unit-tested under node-env vitest). No IPC, main-process, preload, or dependency changes.

**Tech Stack:** TypeScript, React 18, existing `global.css` tokens, lucide-react (`Square`, `MoreHorizontal`). Verification is `npm run test:run`, `npm run build`, and a manual multi-template smoke test.

Spec: `docs/superpowers/specs/2026-08-15-titlebar-multi-live-sessions-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/renderer/src/utils/titlebarSessions.ts` (new) | Pure helpers: recency sort, number/timestamp formatting, uncached-input math, active-request check. |
| `src/renderer/src/__tests__/titlebarSessions.test.ts` (new) | Unit tests for the pure helpers. |
| `src/renderer/src/components/Titlebar.tsx` (modify) | Three-state rendering (0 / 1 / 2+), chip strip, details popover, `stoppingIds: Set<string>`, Stop all. |
| `src/renderer/src/styles/global.css` (modify) | Chip strip + popover styles beside the existing `.titlebar-session-*` block; `position: relative` on the strip. |
| `docs/HANDOFF.md` (modify) | Completion + verification + manual smoke checklist. |
| `CHANGELOG.md` (modify) | `[Unreleased]` entry. |

---

## Task 1: Pure helpers + unit tests

**Files:**
- Create: `src/renderer/src/utils/titlebarSessions.ts`
- Create: `src/renderer/src/__tests__/titlebarSessions.test.ts`

- [x] **Step 1: Create `titlebarSessions.ts`** with these exports (moved verbatim out of `Titlebar.tsx`):
  - `formatUsageNumber(value: number): string`
  - `formatUsageTimestamp(timestamp?: string): string`
  - `getUncachedInputTokens(session: Pick<UsageLiveSession, 'promptTokens' | 'cacheTokens'>): number`
  - `hasActiveRequests(session: Pick<UsageLiveSession, 'activeRequests'>): boolean`
  - `sortLiveSessionsByRecency(sessions: readonly UsageLiveSession[]): UsageLiveSession[]` — copy of the current `featuredSession` ordering: `lastRequestAt ?? startedAt`, newest first, non-mutating.
  - Import `UsageLiveSession` from `../../../shared/types` with `import type`.
- [x] **Step 2: Write tests** covering: grouped number formatting; timestamp fallbacks (`undefined` → `No tracked request yet`, invalid → `Unknown activity`, valid → clock string); uncached tokens (normal, cache > prompt → 0); `hasActiveRequests` at 0 and > 0; recency sort (lastRequestAt wins over startedAt; missing lastRequestAt falls back to startedAt; input order not mutated).
- [x] **Step 3: Run** `npm run test:run` — new suite passes, no regressions.

## Task 2: Rework `Titlebar.tsx`

**Files:**
- Modify: `src/renderer/src/components/Titlebar.tsx`

- [x] **Step 1:** Replace local `formatNumber` / `formatTimestamp` / `getUncachedInputTokens` / `getSessionSortTime` with imports from the new util. Replace the `featuredSession` memo with `sessions = useMemo(() => sortLiveSessionsByRecency(liveSessions), [liveSessions])`.
- [x] **Step 2:** Replace `stoppingTemplateId: string | null` with `stoppingIds: Set<string>` (immutable update pattern). Keep the live-session load `useEffect` unchanged (`limit: 1` stays — it only bounds `recentRequests`).
- [x] **Step 3:** Implement `stopSession(session)`: guard on `stoppingIds.has`, mark stopping, `window.api.stopModel`, on success `setCardStatus(id, 'idle')` + filter the session out, on failure alert with the existing text, clear the mark in `finally`.
- [x] **Step 4:** Implement `stopAll()`: bail if any stop is in flight; mark all current sessions stopping; `Promise.all` of `stopModel`; apply success side effects for the successful subset only; aggregated failure alert (count + first error); clear all marks.
- [x] **Step 5:** Add `detailsOpen` state + `detailsRef` (on the multi-mode strip) + Escape/outside-click `useEffect` (only active while open).
- [x] **Step 6:** Render by state:
  - 0 sessions → nothing.
  - 1 session → the current detailed strip JSX as-is (label, name, meta, Stop button) keyed on `sessions[0]`, with Stop disabled while `stoppingIds.size > 0`.
  - 2+ sessions → `.titlebar-live-chips` row (one `.titlebar-live-chip` per session: dot — pulsing only when `hasActiveRequests` — name (130px ellipsis, title tooltip), `N act` badge when > 0, 18px stop icon button), then the details toggle button, then the popover when `detailsOpen`: header (`N running` + Stop all, disabled per R8), rows with dot + name + optional `lastError` (warning color, truncated, full tooltip) + Stop button (text "Stop"/"Stopping") + meta line (req · active · in · out · Last …).
  - Popover rows are keyed by `session.launchId`.

## Task 3: Styles

**Files:**
- Modify: `src/renderer/src/styles/global.css`

- [x] **Step 1:** Add `position: relative` to the existing `.titlebar-session-strip` rule (anchors the popover; inert for single mode).
- [x] **Step 2:** After the `.titlebar-session-stop` rule, add chip-strip styles (`.titlebar-live-chips` flex row w/ `overflow-x: auto` and hidden scrollbar; `.titlebar-live-chip` pill reusing `--surface-hover`/`--border`; `.titlebar-live-chip-dot` 7px green dot using `var(--success)` + existing `pulse` keyframes, `.no-pulse` variant; name ellipsis; active badge; 18px `.titlebar-live-chip-stop` hover → danger).
- [x] **Step 3:** Add popover styles (`.titlebar-live-popover` absolute, `top: calc(100% + 8px)`, left-aligned to the strip, `--surface` bg, `--border`, `--shadow-lg`, `--radius-sm`, `fadeIn`; header row with uppercase title + Stop all; `.titlebar-live-popover-list` scrollable at 320px; grid rows: name line / meta line / stop button spanning both rows; hover `--surface-hover`; error text `var(--warning)` truncated). Reuse existing `.btn`/`.btn-sm`/`.btn-danger`/`.btn-ghost`/`.btn-icon` classes for buttons; no new color tokens.

## Task 4: Verify

- [x] **Step 1:** `npm run test:run` — all suites pass.
- [x] **Step 2:** `npm run build` — typecheck + bundle clean.
- [x] **Step 3:** Manual smoke (record in handoff): start 3 templates; chips appear for all in recency order; dot pulses only for the session currently serving requests; chip Stop retires a single chip; details popover shows all rows with correct stats; Stop all retires everything and unmounts the popover; start exactly 1 template and confirm the original detailed strip (regression check).

## Task 5: Docs / handoff

- [x] **Step 1:** `docs/HANDOFF.md`: add a Completed bullet (multi-session titlebar), a Verification line, and a manual smoke checklist entry under Next Recommended Check.
- [x] **Step 2:** `CHANGELOG.md` `[Unreleased]`: user-facing "Added" line about per-template header controls when multiple templates run.
