# Usage Stats Model Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Define cost rates per model (folder) on the Pricing tab instead of per template, and route every cost calculation in Usage Stats through a model → legacy-template → app-wide resolution cascade.

**Architecture:** `UsageCostSettings` gains `modelPricing: ModelPricing[]`, persisted in the existing `usage-cost-settings.json` with the same partial-save IPC (`save-usage-cost-settings`) — a save without the `modelPricing` key preserves the stored list, so the app-wide and model sections save independently. Resolution stays a pure renderer function (`templatePricing.ts`); all cost figures already flow through the single `pricingForTemplate` seam in `UsageStatsView.tsx`, which gains a `fallbackModelPath` parameter so deleted templates resolve their model through the snapshot's own `modelPath`. The Pricing tab's per-template table is replaced by a per-model table derived from the cards (same identity rule as the Templates screen). Legacy `template.pricing` is never edited from the UI anymore but still resolves when its model has no entry.

**Tech Stack:** TypeScript (strict, no `any`), React 18, zustand store for cards, existing `global.css` table classes (`usage-request-table`), vitest (node env; main-process test mocks `electron` to a temp dir).

Spec: `docs/superpowers/specs/2026-08-22-usage-stats-model-pricing-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` (modify) | `ModelPricing` interface; `UsageCostSettings.modelPricing: ModelPricing[]` (default `[]`). |
| `src/renderer/src/utils/templatePricing.ts` (modify) | Cascade: `findModelPricing` (case-insensitive folder match, first valid entry) → valid `template.pricing` → app-wide; shared `hasValidRates` strict-group check. |
| `src/main/appSettings.ts` (modify) | `DEFAULT_USAGE_COST_SETTINGS.modelPricing: []`; `normalizeModelPricing` (drop malformed, trim + 200-char cap, case-dedupe first-wins, clamp rates); get normalizes, save preserves when key absent / replaces when present. |
| `src/renderer/src/components/PricingTab.tsx` (modify) | `Per-Model Pricing` section replaces `Per-Template Pricing`: rows derived from cards via `getTemplateModelFolder`, draft hydration from stored list, per-row Save persisting the whole list, app-wide partial save that can't clobber the list, per-row Effective line. |
| `src/renderer/src/utils/usageModelGrouping.ts` (modify) | `UsageSessionTemplateGroup.modelPath?` captured/backfilled from sessions (pricing fallback for deleted templates). |
| `src/renderer/src/components/UsageStatsView.tsx` (modify) | `pricingForTemplate(templateId, fallbackModelPath?)`; modelPath passed at every model-centric cost seam (cost options, `getModelGroupCost`, `NestedSessionTable`, cost-tab model/template sections, no-grouping cost rows, recent requests); default constant updated. |
| `src/renderer/src/__tests__/templatePricing.test.ts` (new) | 11 cascade tests. |
| `src/main/__tests__/appSettings.test.ts` (new) | 7 get/save/normalization tests with `electron` mocked. |
| `docs/HANDOFF.md` (modify) | Completed + verification + manual smoke checklist. |
| `CHANGELOG.md` (modify) | `[Unreleased]` Added entry. |

---

## Task 1: Shared types + resolution cascade

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/utils/templatePricing.ts`
- Create: `src/renderer/src/__tests__/templatePricing.test.ts`

- [x] **Step 1:** Add `ModelPricing { model: string; inputCostPerMillion; cacheCostPerMillion; outputCostPerMillion }` and `modelPricing: ModelPricing[]` to `UsageCostSettings`.
- [x] **Step 2:** Rewrite `resolveTemplatePricing` for the cascade (model first, then valid `template.pricing`, then app-wide) with internal `findModelPricing` + shared `hasValidRates` strict-group check; widen the accepted template to `Pick<Template, 'pricing' | 'modelPath'>`; resolved objects always carry the app-wide currency and pass through `modelPricing`.
- [x] **Step 3:** 11 unit tests: fallbacks, legacy template pricing, case-insensitive match (Win + POSIX), model-over-template precedence, non-matching model ignored, invalid entry skipped, duplicate case-variants first-wins, no-folder path never matches, currency pass-through.
- [x] **Step 4:** Run `npx vitest run src/renderer/src/__tests__/templatePricing.test.ts` — green.

## Task 2: Main-process persistence + normalization

**Files:**
- Modify: `src/main/appSettings.ts`
- Create: `src/main/__tests__/appSettings.test.ts`

- [x] **Step 1:** Default gains `modelPricing: []`; add `MODEL_PRICING_NAME_MAX_LENGTH = 200` and `normalizeModelPricing` (non-array → `[]`; drop non-object/blank/overlong names; case-insensitive first-wins dedupe; clamp rates via the existing `normalizeNonNegativeNumber`).
- [x] **Step 2:** `getUsageCostSettings` normalizes `parsed.modelPricing`; `saveUsageCostSettings` keeps the current list when the key is `undefined`, normalizes + replaces it otherwise. No IPC/preload changes (types flow through `UsageCostSettings`).
- [x] **Step 3:** Test file: `vi.mock('electron', ...)` pointing `app.getPath('userData')` at a `vi.hoisted` temp dir; import `appSettings` **dynamically in `beforeAll`** (static import would trigger the mock factory before the temp-dir const initializes); per-test file reset; 7 tests (defaults missing/malformed, normalization, missing key → `[]`, replace vs preserve semantics, round-trip).
- [x] **Step 4:** Run `npx vitest run src/main/__tests__/appSettings.test.ts` — green.

## Task 3: Pricing tab per-model section

**Files:**
- Modify: `src/renderer/src/components/PricingTab.tsx`

- [x] **Step 1:** Remove the per-template machinery (`TemplatePricingDraft`, its create/parse/save paths, `updateCard` usage, per-template table). App draft parsing returns a four-field partial (no `modelPricing` key → partial-save preserves the list).
- [x] **Step 2:** Derive model rows from `useStore` cards: `getTemplateModelFolder` key (lowercased), first-seen folder spelling, template names aggregated, case-insensitive sort; templates without a folder are skipped.
- [x] **Step 3:** Model draft state (`enabled` + 3 rate strings, keyed by lowercased folder), hydrated from `appSettings.modelPricing` with the fill-missing-keys pattern; `Effective:` line from the current draft (falling back to app-wide on invalid input/disabled).
- [x] **Step 4:** Per-row Save: build the full list from all rows (enabled only), validate every enabled row (first invalid owns the error), persist via `saveUsageCostSettings({ modelPricing })`, refresh via `onAppSettingsChange`.
- [x] **Step 5:** Section header note (folder = model, shared by all templates, no-folder templates stay on defaults), "N models" counter, empty state, disabled inputs/Save for un-checked rows.

## Task 4: Cost calculation wiring in Usage Stats

**Files:**
- Modify: `src/renderer/src/utils/usageModelGrouping.ts`
- Modify: `src/renderer/src/components/UsageStatsView.tsx`

- [x] **Step 1:** `UsageSessionTemplateGroup.modelPath?` — set from the creating session, backfilled from later sessions (same pattern as `modelFileName`).
- [x] **Step 2:** `pricingForTemplate(templateId, fallbackModelPath?)` — template lookup first; when the template is gone, resolve `{ pricing: undefined, modelPath: fallbackModelPath }`; otherwise app-wide. Update the view's `DEFAULT_USAGE_COST_SETTINGS` local constant.
- [x] **Step 3:** Pass the snapshot path at the model-centric seams: `costOfTemplate`/`costOfSession` options, `getModelGroupCost` (and its signature), `NestedSessionTable` prop type + call, cost-tab model branch (group header + template rows), Model Costs / Template Costs rollups, no-grouping cost session rows, recent requests (`modelPathSnapshot`). Flat group-by template/status views and daily-cost cards intentionally keep their pre-change resolution.

## Task 5: Verification

- [x] **Step 1:** `npm run test:run` — 236 tests / 27 files passing.
- [x] **Step 2:** `npm run build` — clean.
- [x] **Step 3:** `npx tsc -p tsconfig.node.json --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` — error locations byte-identical to the pre-change baseline (no new errors; restore `tsconfig.*.tsbuildinfo` afterwards — tracked artifacts the tsc runs dirty).

## Task 6: Documentation

**Files:**
- Create: this plan + `docs/superpowers/specs/2026-08-22-usage-stats-model-pricing-design.md`
- Modify: `docs/HANDOFF.md`, `CHANGELOG.md`

- [x] **Step 1:** `docs/HANDOFF.md` — Completed bullet (files, cascade semantics, deleted-template behavior), verification line, manual smoke checklist under Next Recommended Check.
- [x] **Step 2:** `CHANGELOG.md` — `[Unreleased]` Added entry written for users (per-model rates, one rate set per model folder, legacy per-template rates still respected, app-wide defaults untouched).
