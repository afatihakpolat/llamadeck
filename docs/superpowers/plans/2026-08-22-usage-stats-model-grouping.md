# Usage Stats Model Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make "model" (the leaf folder of a template's GGUF path — same rule as the Templates screen) the default grouping axis in Usage Stats, with model → template → session drill-down on the Sessions and Cost tabs and Model/Template toggles on the template-rollup sections, while keeping every pre-existing grouping view selectable.

**Architecture:** Renderer-only. The `get-usage-stats` snapshot already carries `modelPath` on `sessionRollups` and `templateRollups`, so all grouping is derived at read time in a new pure utility (`src/renderer/src/utils/usageModelGrouping.ts`) and consumed by `UsageStatsView.tsx`. Cost figures sum per-template pricing (per the per-template pricing spec), so group costs are explicit sums of `costOfTemplate` callbacks rather than one rate applied to the rollup. No main-process, IPC, preload, or dependency changes.

**Tech Stack:** TypeScript (strict, no `any`), React 18, existing `global.css` tokens, lucide-react (`Folder`, `FolderOpen`, `ChevronDown`). Verification is `npm run test:run`, `npm run build`, and the manual smoke checklist in the handoff.

Spec: `docs/superpowers/specs/2026-08-22-usage-stats-model-grouping-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/renderer/src/utils/usageModelGrouping.ts` (new) | Pure model grouping/sorting: identity helpers, session model→template→session builders, template-rollup builders, all sort keys incl. cost, unassigned-last rule. Also hosts the `zeroSummary`/`mergeSummary`/timestamp/duration helpers moved out of the view. |
| `src/renderer/src/__tests__/usageModelGrouping.test.ts` (new) | 19 unit tests for the pure functions (merge math, ordering, fallbacks, cost summation, non-mutation). |
| `src/renderer/src/components/UsageStatsView.tsx` (modify) | `'model'` group option + defaults, scoped expansion state, `NestedSessionTable`, Sessions/Cost model branches, Model/Template toggles on both template-rollup sections, pricing closures. Removed dead `buildSessionAnalysisGroups` stub and the now-imported private helpers. |
| `src/renderer/src/styles/global.css` (modify) | `.usage-model-group`, `.usage-template-row`, `.usage-mini-toggle`, chevron-rotation rules beside the existing `.usage-list-*` block. |
| `docs/HANDOFF.md` (modify) | Completed + verification + manual smoke checklist. |
| `CHANGELOG.md` (modify) | `[Unreleased]` Added entry. |

---

## Task 1: Pure utility + unit tests

**Files:**
- Create: `src/renderer/src/utils/usageModelGrouping.ts`
- Create: `src/renderer/src/__tests__/usageModelGrouping.test.ts`

- [x] **Step 1: Create `usageModelGrouping.ts`.** Identity: `getModelGroupKey` / `getModelGroupLabel` over `getTemplateModelFolder` from `templateGrouping.ts` (key `model:<lowercased-folder>` or `unassigned`; label folder name or `No model selected`), plus `getModelFileName`. Move in (verbatim) from the view: `zeroSummary`, `mergeSummary`, `getSessionActivityTimestamp`, `getSessionDurationMs`, `getUsageTimestampValue`, and the session ordering comparator as `sortSessionRollupsBy(sessions, 'activity' | 'tokens' | 'requests' | 'duration')`.
- [x] **Step 2: Builders.** `buildSessionModelGroups(sessions)` — one pass merging sessions into model groups and `modelKey::templateId`-keyed template groups (backfill `modelFileName` from the first non-null snapshot, sum rollups/durations, track max last-activity). `buildTemplateModelGroups(rollups)` — same over `UsageTemplateRollup[]` with `lastRequestAt` as max.
- [x] **Step 3: Sorters.** Generic `compareSortNodes` with accessors (label/requests/tokens/activity/duration), unassigned-last predicate, and `cost` support. Expose `sortSessionTemplateGroups`, `sortSessionModelGroups`, `sortUsageTemplateRollups`, `sortTemplateModelGroups`, plus the combined `buildSortedSessionModelGroups(sessions, sortKey, { costOfTemplate?, costOfSession? })` (`cost` → `tokens` inner key; group cost = Σ templates) and `buildSortedTemplateModelGroups(rollups, sortKey, costOfRollup?)`.
- [x] **Step 4: Tests.** Identity (casing, unassigned, file names); multi-quantization merge (sessions, requests, tokens, durations, last activity, template order); per-template snapshots; unassigned-last under every sort key; cost sorting with summed per-template pricing; inner template/session ordering; input arrays not mutated.
- [x] **Step 5: Run** `npm run test:run` — new suite passes, no regressions.

## Task 2: Sessions + Cost tab model branches

**Files:**
- Modify: `src/renderer/src/components/UsageStatsView.tsx`

- [x] **Step 1:** Extend `UsageSessionGroupBy` with `'model'`; `SESSION_GROUP_OPTIONS` = model / template / status / none; default both `sessionGroupBy` and `costSessionGroupBy` to `'model'`. Import the utility; delete the view's private `zeroSummary`/`mergeSummary`/`getUsageTimestampValue`/`getSessionActivityTimestamp`/`getSessionDurationMs`/`sortSessionRollups` and the unused `buildSessionAnalysisGroups` stub.
- [x] **Step 2:** Add `expandedUsageGroups: Record<string, boolean>` with namespaced ids + `toggleUsageGroup`; derived `sessionModelGroups = buildSortedSessionModelGroups(filteredSessionRollups, sessionSortBy)` and `costSessionModelGroups = buildSortedSessionModelGroups(filteredCostSessionRollups, costSessionSortBy, { costOfTemplate, costOfSession })` (closures over `pricingForTemplate` → `getUsageCostBreakdown(...).totalCost`).
- [x] **Step 3:** Add `NestedSessionTable` (session rows keyed by `launchId`; port + endpoint identify the row; optional cost column) and `getModelGroupCost` (per-template breakdown summation).
- [x] **Step 4:** Render the `'model'` branch on both tabs before the `'none'` branch: model card (folder icon, label, `N templates • M sessions` subtitle, rolled metrics, chevron) → expandable template rows (name + GGUF file, metrics) → expandable session table. Cost tab variants render cost figures (group = summed per-template breakdowns; currency app-wide).
- [x] **Step 5:** Verify the legacy template/status/none branches are untouched; update the Cost tab header note ("by model, template, or status").

## Task 3: Template-rollup sections (Overview + Cost)

**Files:**
- Modify: `src/renderer/src/components/UsageStatsView.tsx`

- [x] **Step 1:** Add `UsageTemplateSectionGroupBy = 'model' | 'template'` with independent state per section, both default `'model'`. Derive `overviewTemplateModelGroups = buildSortedTemplateModelGroups(templateRollups)` (tokens order, matching the main-process default) and `costTemplateModelGroups = buildSortedTemplateModelGroups(templateRollups, 'cost', costOfRollup)`.
- [x] **Step 2:** Section headers gain a Model/Template mini-toggle and count lines ("2 models • 5 templates" vs "5 template rows"); titles flip to "Models" / "Model Costs".
- [x] **Step 3:** Model branch renders expandable model cards listing the pre-existing per-template rows (static, GGUF file subtitle) underneath; Cost variant adds the summed cost breakdown to the model header and per-template cost rows. Template branch is the existing flat list, unchanged.

## Task 4: Styles

**Files:**
- Modify: `src/renderer/src/styles/global.css`

- [x] **Step 1:** Add `.usage-section-header-start` (h2 + toggle row) and `.usage-mini-toggle` (pill toggle, `--accent` active state, focus rings).
- [x] **Step 2:** Add `.usage-model-group` (clipped-radius card, `.open` border emphasis), `.usage-model-group-header` (full-width button: icon, title stack with ellipsized primary line, wrapping metrics, chevron), `.usage-model-group-body` (inner card stack on `--bg`).
- [x] **Step 3:** Add `.usage-template-row` (+ `.open`), `.usage-template-row-header` (button row; `.usage-template-row-static` non-interactive variant for the rollup sections), `.usage-template-row-body`; chevron rotation via `.open >` descendant selectors. Mobile wrap for the header rows at ≤900px.

## Task 5: Verify

- [x] **Step 1:** `npm run test:run` — 25 files, 218 tests passing (19 new).
- [x] **Step 2:** `npm run build` — typecheck + renderer bundle clean; no new tsc errors in touched files.
- [x] **Step 3:** Manual smoke deferred (recorded in handoff): two templates in one model folder with different GGUFs; drill-down on both tabs; per-template pricing split inside one model; "No model selected" fallback on every surface.

## Task 6: Docs / handoff

- [x] **Step 1:** `docs/HANDOFF.md`: Completed bullet (with file pointers), Verification line, manual smoke checklist under Next Recommended Check.
- [x] **Step 2:** `CHANGELOG.md` `[Unreleased]` Added entry (user-facing: model as default grouping, drill-down, legacy views still selectable).
- [x] **Step 3:** Spec + this plan committed alongside the change.
