# Usage Stats Model Pricing Design

## Problem Statement

Cost rates are defined per template (the `Per-Template Pricing` table on the Pricing tab), but usage is now organized around models (see `2026-08-22-usage-stats-model-grouping-design.md`). One model usually ships as several templates (quantizations, variants under one folder), so a user who wants to price "Qwen3.5-9B" must set identical rates on every quantization template and keep them in sync by hand. The pricing granularity no longer matches the unit operators think in.

## Key Facts

- `UsageCostSettings` (app-wide rates + currency) is persisted in `usage-cost-settings.json` and read/written through `src/main/appSettings.ts` → `get-usage-cost-settings` / `save-usage-cost-settings` IPC. Saving is partial: a key omitted by the caller keeps its stored value.
- Per-template pricing lives on `Template.pricing` (persisted with the template file, also exposed to the CLI) and is resolved at read time by `resolveTemplatePricing(template, appSettings)` in `src/renderer/src/utils/templatePricing.ts`. All cost figures in Usage Stats flow through the single `pricingForTemplate(templateId)` seam in `UsageStatsView.tsx`.
- Model identity has the canonical rule `getTemplateModelFolder(modelPath)` (leaf folder, case-insensitive) already used by the Templates screen and the model grouping.
- Usage snapshots carry `modelPath` on `sessionRollups`, `templateRollups`, and `modelPathSnapshot` on recent requests, so deleted templates keep resolving a model even after their template row is gone.

## Goal

- Let operators define cost rates per model (folder) on the Pricing tab, so every template/quantization under the folder shares one rate set with no duplication.
- Make model-priced rates flow through all cost calculations unchanged: Sessions/Cost drill-down, template/model rollup sections, recent requests, and cost sorting.

## Non-Goals

- No changes to how app-wide defaults, currency, token accounting, or the usage snapshot work.
- No main-process cost accounting — cost stays a purely renderer-side projection, as before.
- No editing of legacy per-template pricing from the UI (it leaves the Pricing tab but remains valid data, see R4).
- No CLI surface for model pricing in this change (app settings have no CLI commands today).
- No daily-rollup cost attribution change (daily cards have never been template/model-attributable).

## Requirements

- R1: The Pricing tab's second section is `Per-Model Pricing`, one row per model folder present in the current templates (same identity rule as the Templates screen; templates without a usable model folder do not appear and stay on app-wide defaults). Rows show the folder name, the templates it contains, an enable toggle, and the three rate inputs.
- R2: Saving a model row persists the whole model list as `modelPricing: ModelPricing[]` on `UsageCostSettings` via `save-usage-cost-settings`; saving app-wide defaults does **not** alter the stored model list (partial-save semantics).
- R3: Resolution cascade, most specific first: model entry (case-insensitive folder match, first valid entry wins) → legacy `template.pricing` → app-wide defaults. Model entries with invalid rates are skipped, not fatal. Currency is always the app-wide currency.
- R4: Existing `template.pricing` data keeps working: it still overrides app-wide rates when its model has no defined pricing, so upgrades do not change the meaning of previously configured templates. It is no longer editable in the UI; the CLI/template-file path remains the only way to set it.
- R5: Every cost figure in Usage Stats resolves through the cascade: model-group/session/template rollups, nested session tables, flat cost views, recent requests, and cost sorting all use it. For sessions/rollups whose template no longer exists, the row's own `modelPath` snapshot selects the model entry (deleted templates keep their model's pricing; previously they already fell back to app-wide).
- R6: On-disk data is normalized defensively on read: non-array `modelPricing` → `[]`; malformed entries dropped; names trimmed and capped (200 chars); case-insensitive duplicates keep the first; negative/invalid rates clamp to 0.
- R7: The row's "Effective" line shows the rates that would apply at the model level (the draft when enabled, else app-wide); per-rate mixing between levels is never allowed (a block is all-or-nothing, as today).

## Design

### Shared types (`src/shared/types.ts`)

- `ModelPricing { model: string; inputCostPerMillion; cacheCostPerMillion; outputCostPerMillion }` — `model` is the folder name as first seen in a template path (readable in the settings file); matching is case-insensitive.
- `UsageCostSettings` gains `modelPricing: ModelPricing[]` (default `[]`). Backward compatible on read: a missing key normalizes to `[]`.

### Resolution (`src/renderer/src/utils/templatePricing.ts`)

- `resolveTemplatePricing(template: Pick<Template, 'pricing' | 'modelPath'> | null | undefined, appSettings)` implements R3/R4: `findModelPricing(template.modelPath, appSettings)` (folder via `getTemplateModelFolder`, linear case-insensitive scan, first **valid** entry) beats a valid `template.pricing`, which beats app-wide.
- Invalid-rate check (`hasValidRates`) is the existing strict-group rule, now shared by both levels. The resolved object always carries `currency` from app settings and passes through the full `modelPricing` list (cost math only reads the four rate/currency fields).

### Main process (`src/main/appSettings.ts`)

- `DEFAULT_USAGE_COST_SETTINGS` gains `modelPricing: []`.
- `normalizeModelPricing(value)` (R6) is applied in both `getUsageCostSettings` and `saveUsageCostSettings`.
- Save semantics: `modelPricing === undefined` on the caller's partial → stored list preserved; otherwise the provided list (normalized) replaces it wholesale. This is what lets the two UI sections save independently through one IPC channel.

### Pricing tab (`src/renderer/src/components/PricingTab.tsx`)

- The `Per-Template Pricing` table is replaced by `Per-Model Pricing`. Model rows are derived from the cards: `getTemplateModelFolder(template.modelPath)` keyed lowercased, first-seen spelling kept for display/saving, sorted case-insensitively (same order as the grouping surfaces).
- Draft state `Record<lowerKey, ModelPricingDraft>` hydrates new rows from the stored list (case-insensitive match → enabled + rates; otherwise disabled) without clobbering in-flight edits (fill-missing-keys pattern used elsewhere).
- Per-row Save builds the full list from all rows (enabled rows only → `{ model: row.model, ...rates }`), validates every enabled row (first invalid row owns the error), then calls `saveUsageCostSettings({ modelPricing })`. Disabling the toggle removes the entry on next save.
- App-wide section now parses to a four-field partial (never includes `modelPricing`), so `Save Defaults` cannot wipe model pricing (R2). The `effective` meta line is unchanged.
- `Effective:` under each model name shows R7's model-level resolution for the current draft.

### Cost calculations (`src/renderer/src/components/UsageStatsView.tsx`)

- `pricingForTemplate(templateId, fallbackModelPath?)`: template lookup resolves pricing + modelPath; when the template is gone, the passed snapshot path (`session.modelPath`, `rollup.modelPath`, `record.modelPathSnapshot`) resolves the model entry; otherwise app-wide.
- `UsageSessionTemplateGroup` gains `modelPath?` (captured/backfilled from its sessions, next to the existing `modelFileName`) so nested template rows can resolve their own model.
- All model-centric seams pass the snapshot path: `costOfTemplate`/`costOfSession`, `getModelGroupCost`, `NestedSessionTable` prop, cost-tab model/template sections, no-grouping cost session rows, and recent requests. Flat per-template group views (group-by template/status) keep template-id-only resolution — identical to pre-change behavior.

## Edge Cases

- Same folder on different drives/casing → one pricing row (key = lowercased folder), same as everywhere else in the app.
- Model entry exists but all its templates are deleted/moved away → the entry stays in settings (invisible in the UI, which is derived from live templates); it reappears automatically if a template returns to that folder.
- Legacy template pricing exists under a model the user now defines → the model rate wins (R3); under a model without a definition → the legacy rate still wins over app-wide (R4).
- Hand-edited settings file with duplicate case-variants and malformed entries → normalized on read (R6); the renderer's `findModelPricing` additionally guards against a missing/non-array list.
- Empty model folder name after trimming → entry dropped; root-level GGUF (`C:\model.gguf`) has no folder → never matches any entry (legacy template pricing, if present, still applies).
- `usage-cost-settings.json` from an older app version (no `modelPricing` key) → reads as `[]`; first save of either section writes the full shape.

## Verification

- `src/renderer/src/__tests__/templatePricing.test.ts` — 11 tests: app-wide fallback (no template / no entries), legacy template pricing, model match (case-insensitive, Win + POSIX paths), model-over-template precedence, non-matching model ignored, invalid model entry skipped, duplicate case-variants first-wins, no-folder path never matches, currency pass-through.
- `src/main/__tests__/appSettings.test.ts` — 7 tests with `electron` mocked to a temp dir (settings file never touches the real userData): defaults on missing/malformed file, normalization (trim, drop invalid, case-dedupe, rate clamping), missing key → `[]`, save-with-list replaces, save-without-list preserves, round-trip through the file.
- `npm run test:run` — 236 tests / 27 files passing (199 → +37 with the model-grouping tests of the companion feature).
- `npm run build` clean; `tsc -p tsconfig.node.json | tsconfig.web.json --noEmit` — zero new errors (identical pre-existing baseline: test-file mock looseness, `usageSessions.ts` mismatch, tsconfig `src/shared` project-list noise).
- Manual smoke (recorded in `docs/HANDOFF.md` → Next Recommended Check): define a rate for a model with two quantization templates → both template rows and their sessions show the model rates in the Cost tab; uncheck + save → rates fall back; save app-wide defaults → model list survives; delete a template with usage → its historical rows keep the model rate.

## Alternatives Considered

- **A — keep per-template pricing, add model shortcuts** (e.g. "apply to all templates in this folder"): still n copies of the same rates in n template files, drift-prone, and it keeps the wrong unit as the source of truth. Rejected.
- **B — store model pricing on the templates (copy onto each template at save)**: couples templates' files to shared state, breaks on template edits via the CLI, and can't express "the model's price" for templates created later. Rejected.
- **C — `Record<folder, rates>` shape in settings instead of an array**: object keys make case-collision handling awkward (JS object keys are exact-match strings; dedupe would still need a case pass) and lose ordering for display; the array keeps `model` as readable data and makes first-wins dedupe explicit. Chosen.
- **D — model price beats everything, including legacy `template.pricing` unconditionally**: same as R3's ordering; the only difference is wording. The legacy rate only wins when its model is undefined, which keeps old setups' meaning intact (R4).
