# Usage Stats Model Grouping Design

## Problem Statement

Usage Stats is organized around templates, but operators think in models. One model commonly ships as several templates (different quantizations, variants, ports), so the Sessions, Cost, and template-rollup surfaces fragment what is really one model's usage. The Templates screen already solves the identity problem by grouping cards by the model's leaf folder; Usage Stats needed the same lens, with per-template and per-session detail preserved behind the model level.

## Key Facts (already true, no main-process work)

- Model identity already has a canonical rule: `getTemplateModelFolder(modelPath)` in `src/renderer/src/utils/templateGrouping.ts` — the leaf folder of the GGUF path, case-insensitive on match, `null` when there is no usable folder ("No model selected"). `CardsView` groups by it.
- `get-usage-stats` snapshots already carry `modelPath` snapshots on both `sessionRollups` and `templateRollups` (and on live sessions / recent requests), keyed by the path the template pointed at when the session/rollup was recorded. Deleted templates still resolve through their snapshot.
- Cost is derived at read time per template via `resolveTemplatePricing` (per-template pricing spec, `2026-06-05`). A model group can therefore not use one rate for its whole rollup: group cost must be the sum of per-template costs.
- Usage Stats filter/group state is renderer-local to `UsageStatsView.tsx` (stored query only persists the time window + template filter, per the richer-date-filters spec). Grouping choices are not persisted today and stay that way.

## Goal

- Make "model" the default grouping axis across Usage Stats: Sessions and Cost tab session analysis group by model by default, and the Overview/Cost template-rollup sections default to model rows.
- Keep every existing level reachable: model → templates → sessions drill-down, plus the pre-existing per-template and per-session-only views as selectable group modes.

## Non-Goals

- No main-process, IPC, or snapshot-shape changes — grouping is derived at read time in the renderer from the existing snapshot.
- No changes to the Live Sessions card grid (running proxies stay per-session by nature).
- No persistence of group-mode or Model/Template toggle choices (matches existing group-state behavior).
- No cross-surface model filter (the existing single-template filter remains).
- No new IPC for model-level rollups even for very large histories; session counts are small and rollups are already windowed.

## Requirements

- R1: Sessions tab defaults to "Group by model". Sessions are grouped by the model folder of each session's `modelPath` snapshot; templates with different quantizations in the same folder merge into one model group.
- R2: Expanding a model group lists its template rows (template name + GGUF file name from the first non-null snapshot); expanding a template row lists its per-session rows (port, status, requests, tokens, duration, activity).
- R3: "Group by template", "Group by status", and "No grouping" on the Sessions tab behave exactly as before; all sort modes (activity/tokens/requests/duration) apply at the model, template, and session levels.
- R4: Cost tab defaults to "Group by model" with the same drill-down. Every cost figure resolves per-template pricing; a model group's cost is the sum of its templates' costs. "Highest cost" orders model groups by summed cost, template rows and session rows by their own cost.
- R5: Overview "Templates" and Cost "Template Costs" default to model rows with a Model/Template toggle. Model rows roll up their template rollups (requests, uncached input/cache/output, total, last activity; the Cost tab adds the summed cost breakdown). Template rows under a model are the pre-existing per-template rows.
- R6: Sessions and rollups without a usable model folder land in a final "No model selected" group on every surface (same label as the Templates screen).
- R7: Model identity uses the exact rule of the Templates screen — leaf folder, case-insensitive match, Windows and POSIX paths.
- R8: Existing window, template, and status filters compose with model grouping; no empty-window behavior changes.

## Design

### New pure utility (`src/renderer/src/utils/usageModelGrouping.ts`)

Grouping and sorting are pure functions (project convention: logic pure, side effects in wrappers), unit-testable under the node-env vitest setup.

Types:

- `UsageSessionTemplateGroup extends UsageSummaryRollup` — `templateId`, `templateName`, `modelFileName: string | null`, `sessionCount`, `durationMs`, `lastActivityAt?`, `sessions: UsageSessionRollup[]`.
- `UsageSessionModelGroup extends UsageSummaryRollup` — `key` (`model:<lowercased-folder>` or `unassigned`), `label` (folder name or `No model selected`), `templateCount`, `sessionCount`, `durationMs`, `lastActivityAt?`, `templates`.
- `UsageTemplateModelGroup extends UsageSummaryRollup` — same key/label shape over `templateRollups`, with `lastRequestAt?` and `templates: UsageTemplateRollup[]` (the original rows, unmodified).

Functions:

- `getModelGroupKey(modelPath?)` / `getModelGroupLabel(modelPath?)` / `getModelFileName(modelPath?)` — identity + display helpers over `getTemplateModelFolder`.
- `buildSessionModelGroups(sessions)` — single pass; sessions merge into model groups, template groups (keyed by `modelKey::templateId`), and session lists. Template `modelFileName` backfills from the first non-null snapshot.
- `buildTemplateModelGroups(rollups)` — single pass over template rollups; `lastRequestAt` is the max of its members.
- `sortSessionRollupsBy(sessions, 'activity' | 'tokens' | 'requests' | 'duration')` — mirrors the pre-existing view ordering (moved from `UsageStatsView.tsx`, which lost its private copies of `zeroSummary`/`mergeSummary`/timestamp/duration helpers in the same move).
- `sortSessionTemplateGroups` / `sortSessionModelGroups` / `sortUsageTemplateRollups` / `sortTemplateModelGroups` — generic comparator (`compareSortNodes`) over `activity | tokens | requests | duration | cost`, with the unassigned-last rule applied only at the model level and deterministic tie-breaks (requests → activity → label).
- `buildSortedSessionModelGroups(sessions, sortKey, { costOfTemplate?, costOfSession? })` — builds, then sorts all three levels. `cost` maps to `tokens` for the inner levels; group cost is the sum of `costOfTemplate` over its templates; sessions sort by `costOfSession` when in cost mode.
- `buildSortedTemplateModelGroups(rollups, sortKey = 'tokens', costOfRollup?)` — same for the template-rollup sections.

### View changes (`UsageStatsView.tsx`)

- `UsageSessionGroupBy` gains `'model'`; `SESSION_GROUP_OPTIONS` becomes model / template / status / none. Both session-analysis selects default to `'model'` (state resets on reload, as all group options do).
- One scoped expansion map `expandedUsageGroups: Record<string, boolean>` with namespaced ids (`sessions-model:<key>`, `cost-model:<key>`, `overview-model:<key>`, `cost-model-row:<key>`, and `<id>:<templateId>` for template rows) so surfaces don't collide.
- `NestedSessionTable` — small presentational component for the deepest drill-down level; same columns as the tab's "No grouping" table (minus the now-redundant template column; port + endpoint identify the session), with an optional cost column driven by `pricingFor`.
- Cost wiring: `costOfTemplate`/`costOfSession` closures build `getUsageCostBreakdown(row, pricingForTemplate(row.templateId)).totalCost`; model-group display costs are the full per-template-summation breakdowns (`getModelGroupCost` / inline reduce), currency always app-wide.
- Overview + Cost template sections gain a `Model` / `Template` mini-toggle (default `model`) and render model rows with expandable static template rows underneath. Section titles flip ("Models" / "Model Costs") to match.
- Dead-code cleanup folded into the change: the view's unused `buildSessionAnalysisGroups` stub and its private copies of the helpers moved to the utility are removed.

### Styling (`global.css`)

New rules beside the existing `.usage-list-*` block, existing tokens only (`--surface`, `--surface-hover`, `--bg`, `--border(-strong)`, `--text*`, `--accent`, `--accent-fg`), so both themes work:

- `.usage-model-group` (card with clipped radius) + `.open` border emphasis; `.usage-model-group-header` full-width button row (folder icon, title stack, metrics, `ChevronDown`).
- `.usage-template-row` (inner card) + `.usage-template-row-header` (button row; `.usage-template-row-static` variant for non-expandable rows) + `.usage-template-row-body` for the nested session table.
- `.usage-mini-toggle` pill toggle for the section mode switches; chevron rotation via the `.open` ancestor selectors.

### Data flow

No IPC change. All inputs come from the existing `UsageStatsSnapshot` (`sessionRollups`, `templateRollups`) plus `templatesById` for pricing. Live updates re-render because the snapshot state does — drill-down expansion state survives refreshes because ids are stable (model key / templateId / launchId).

## Edge Cases

- Same folder, different casing on disk → one group (key lowercases the folder); label comes from the first-seen spelling.
- GGUF file renamed between sessions → same model group; template rows keep the first non-null file-name snapshot (cosmetic only).
- Session whose template had no model path (`modelPath` undefined) → unassigned group; template row subtitle falls back to "No model path snapshot".
- Template deleted after usage → its rollups/sessions still group by the snapshotted path; pricing falls back to app-wide rates via `resolveTemplatePricing` (pre-existing behavior for unknown templates).
- Cost ties → deterministic fallback order (requests → activity → label) at every level, so "Highest cost" never reorders randomly between renders.
- Very long folder/template names → title stack ellipsizes the primary line (`.usage-model-group-title .usage-list-title`), metrics wrap.
- Single-template window (template filter selected) → one model group with one template row; drill-down still works.

## Verification

- `npm run test:run` — 19 new unit tests in `src/renderer/src/__tests__/usageModelGrouping.test.ts`: identity helpers (casing, unassigned, file names), multi-quantization merge math (sessions, requests, tokens, durations, last activity), template-level snapshots, unassigned-last ordering under every sort key, cost sorting with summed per-template pricing, inner-level sorting, non-mutating sorts.
- `npm run build` — typecheck + renderer bundle clean. No pre-existing tsc errors in the touched files (the repo's known web-tscconfig gaps are untouched).
- Manual smoke (recorded in `docs/HANDOFF.md` → Next Recommended Check): two templates in one model folder with different GGUFs, drill-down on both tabs, per-template pricing split inside one model, and the "No model selected" fallback.

## Alternatives Considered

- **A — main-process `modelRollups` in the snapshot**: push grouping into `usageSessions.ts` like `templateRollups`. Rejected: the snapshot already carries model paths on every row, so a main-process rollup duplicates state and widens the IPC contract (Zod schema, preload, tests) for information derivable at read time — the same "derive at read time" rationale the per-template pricing spec used for cost.
- **B — flat model rows without drill-down** (mirroring the old template/status group rows): minimal, but it would hide the per-template/per-session detail the model view exists to organize, forcing tab-mashing to see a quantization's sessions.
- **C — a new "Models" top-level tab**: a fourth tab with duplicated filters and summary cards. Heavier than the feature needs; grouping mode inside the existing tabs keeps one filter surface and reuses every existing control.
