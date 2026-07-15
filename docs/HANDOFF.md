# Handoff

## In Progress
- Planning **smooth update path** for LlamaDeck itself (electron-updater + locked NSIS install path) so Windows taskbar pins and Start-menu shortcuts survive updates. Spec at `docs/specs/smooth-update-path/` (requirements, design, tasks). Existing users accept a one-time repin; new installs and all future updates use the locked `%LOCALAPPDATA%\Programs\llamadeck` path. Distinct from the existing in-app llama.cpp source-build update flow, which remains unchanged.

## Completed
- Implemented proxy-backed usage statistics for local llama.cpp templates: LlamaDeck now binds the public template port, launches `llama-server` on a hidden loopback port, records proxied completion/chat requests, persists compact per-session summaries under `userData/usage-sessions/`, and exposes live plus historical snapshots to the renderer.
- Expanded tracked usage endpoints to include legacy llama.cpp completion routes (`/completion`, `/completions`, `/chat/completions`) in addition to the OpenAI-compatible `/v1/*` paths.
- Added separate cache-token accounting to Usage Stats so input, output, cache, and total tokens are surfaced independently in live sessions, rollups, and request rows.
- Replaced the unbounded raw request-history persistence model with a hybrid approach: per-session summaries are durable, Recent Requests is in-memory only and capped to 20 rows, and older JSONL history is migrated forward once.
- Added a dedicated Usage Stats page with live session cards, historical template/day rollups, and recent-request detail rows; exact token totals are shown only for responses that included llama.cpp `usage` or `timings`.
- Added a dedicated Sessions tab inside Usage Stats that exposes per-session rollups for the selected window/template and supports local status filtering plus grouping by template or status for session-level analysis.
- Fixed the first session-analysis pass so `Last 7 days` aligns to local-day buckets, grouped output honors the chosen sort mode, and session-tab timing/activity fields now reflect the selected window rather than the full session lifetime.
- Added persisted app-wide usage cost settings plus a dedicated Cost tab inside Usage Stats, where the user can define input/cache/output rates and inspect derived cost analysis across overall totals, session rows, grouped sessions, templates, days, and recent requests.
- Fixed the first Cost tab pass so cost analytics stay hidden until pricing settings successfully load or save, preventing misleading zero-cost totals, and unsaved pricing edits preview consistently across the displayed numbers.
- Fixed token normalization across Recent Requests and persisted usage rollups so summary cards, session/template/day rollups, and request rows all use the same uncached-input/cache/output/total semantics even when llama.cpp mixes `usage` and `timings` shapes.
- Planned a proxy-based llama.cpp usage-statistics feature in `docs/specs/llama-proxy-usage-stats/`, covering requirements, design, tasks, and initial implementation notes.
- Replaced the old release-download update flow with an in-app Windows source-build flow for llama.cpp.
- Added main-process orchestration that fetches the latest upstream `b####` tag, checks out that tag, configures CMake/CUDA tooling, builds into a versioned backend folder, and refreshes the renderer snapshot on success.
- Updated Settings and the update banner to trigger source builds, show phase-based progress, support cancel, and refresh backends/templates/active backend after success.
- Preserved existing versioned backend folders and repointed pinned templates to the newly built backend automatically.
- Added a dedicated LiteLLM manager flow beside the local llama.cpp template workflow.
- Added a dedicated LiteLLM navigation page with system-Python detection, LiteLLM install/update actions, app-managed runtime settings, config editing, start/stop controls, and runtime logs.
- Simplified LiteLLM to a loopback-only app-managed proxy path, removed the separate external connection controls, and kept local model discovery and chat routed through the managed local proxy.
- Added local proxy testing and remote model discovery for the managed LiteLLM proxy.
- Removed the LiteLLM provider option from the template modal so template creation is local-only again; LiteLLM is managed separately from the LiteLLM page.
- Kept existing local templates working unchanged while keeping new template creation local-only.
- Removed the remaining LiteLLM-template code paths from cards, the dedicated chat route, preload, shared template types, and main IPC.
- Normalized loaded, saved, and imported templates to strip removed LiteLLM-only fields, and made invalid legacy templates show missing configuration instead of appearing ready to start.
- Removed the stale external LiteLLM settings API surface from preload, renderer typings, and unused main-process helpers.
- Fixed LiteLLM proxy startup to use LiteLLM's actual Python entry point instead of the invalid `python -m litellm` path.
- Increased the LiteLLM readiness timeout from 5 seconds to 30 seconds so slower proxy startup is not killed prematurely.
- Added a configurable API key to the managed LiteLLM runtime settings so Test Local Proxy and Refresh Models can authenticate against the loopback proxy when local auth is enabled.
- Fixed managed LiteLLM no-auth startup to ignore an inherited `LITELLM_MASTER_KEY` environment variable when the saved config sets `general_settings.disable_auth: true`, matching the user's working local script.
- Added an app shutdown hook so closing Hexllama also stops the managed LiteLLM proxy instead of leaving the child process running.
- Added a persisted Light/Dark/System theme setting, boot-time theme hydration, and a full dark token set so the renderer supports a proper dark mode instead of light-only colors.
- Updated chat windows and the Electron window bootstrap path so theme changes propagate across windows and dark mode no longer starts from a hardcoded light background when the OS theme already matches the app theme.
- Rebranded the app from Hexllama to LlamaDeck across the packaged app name, visible UI, window titles, and README branding.
- Added a main-process compatibility bootstrap so packaged upgrades keep using the legacy Hexllama user-data directory when it already exists, preserving templates, folder settings, LiteLLM settings, and renderer local storage through the rename.
- Added a persisted minimize-to-tray window behavior setting with a Settings toggle; when enabled, clicking the main window X hides LlamaDeck to a tray icon with reopen and quit actions instead of closing the app.
- Fixed packaged minimize-to-tray on Windows by shipping the tray icon asset with the app and extending main-process icon resolution to packaged resource paths before creating the tray.
- Updated the template Advanced Parameters editor so explicitly configured flags are grouped into a dedicated top section in the default view, while search keeps parameters in their native categories to avoid state-dependent result jumps.
- Fixed default-true boolean parameters in the template editor so their switches render as on by default, toggling them off stores an explicit `false`, and launch/preview/import paths emit the correct `--no-*` flag instead of silently dropping the setting.
- Fixed packaged builds so imported and existing templates can still load the fallback advanced-parameter schema even when a backend-specific `commands.json` is absent; the app now resolves the bundled schema from the packaged app root and includes `resources/commands.json` in the installer payload.
- Added a Live Output page that streams llama.cpp stdout and stderr over IPC into an in-memory renderer buffer; starting a model now focuses that page, nothing is persisted to disk, and process exit updates the card status out of running.
- Backend installs and source updates now preserve the current global active backend instead of auto-switching it to the newest build, so templates using `Default (Active)` keep following the user's chosen global backend.
- Added a CPU-only source-build option alongside CUDA builds: Settings now exposes separate `Build CPU Only` and `Build CUDA` actions, the source-build IPC accepts a build flavor, CPU builds skip NVCC/CUDA requirements, and CPU artifacts are written into a separate `b####-cpu` backend folder so they can coexist with CUDA builds.
- Persisted the global active backend selection in renderer storage so the user's chosen `Default (Active)` backend survives app restarts instead of resetting to the first listed backend.
- Stopped source-build refreshes from rewriting pinned template backends; explicitly pinned templates keep their backend choice, while `Default (Active)` templates continue following the persisted global active backend.
- Added explicit backend flavor metadata and UI labeling so CPU and CUDA builds no longer appear as duplicate `b####` entries; backend names now render as labels like `b#### · CPU` or `b#### · CUDA`, with a flavor badge in Settings.
- Settings and the update banner now hide source-build buttons for build flavors that are already installed for the latest upstream tag; if both latest CPU and CUDA variants exist, the build actions disappear entirely.
- Reverted the single-active-template restriction in the main-process launch path so different templates can run concurrently again; the app still prevents starting the exact same template twice.
- Extended proxy usage tracking to include OpenAI-compatible `/v1/responses` requests, including streamed Responses payloads that report usage through nested `response` objects and `input_tokens`/`output_tokens` fields.
- Added per-template pricing as the primary cost source for each template, with the app-wide rates kept as the default fallback. A new Pricing tab inside Usage Stats manages both surfaces; the Cost tab is read-only and resolves rates per rollup row (session/template rollups use the template's rates, daily and overall rollups use the app-wide rates, currency is always app-wide). Pricing lives in the template's existing JSON file and follows it through export/import.
- Fixed the Live Output viewport so it only auto-scrolls to the bottom while the user is already at (or within ~32px of) the bottom. Scrolling up to read earlier content no longer gets yanked back, and selections survive. New chunks that arrive while reading count up and surface a small "N new chunks ↓" pill that snaps back to the bottom when clicked.
- Replaced the three-chip date window on Usage Stats with five preset chips (Today, Last 7 days, Last 30 days, This month, All time) plus a Custom range picker (two `<input type="date">` + Apply). The filter is persisted to localStorage so the user's choice survives an app restart. The data model switched from a `window` enum to an explicit `fromTimestamp`/`toTimestamp` range, which let the main process drop its duplicated `getWindowStart` helpers.
- Shipped per-build commands-schema auto-generation: LlamaDeck now parses `llama-server --help` for each successfully built backend, layers a curated overlay on top of the parsed defaults, and resolves the final schema at runtime. A bundled `b9202.json` snapshot keeps things working offline, and a lazy first-access fallback regenerates the file on demand if it is ever missing.

## Verification
- `npm run build` after switching usage persistence from raw request ledger rows to compact per-session summaries with an in-memory recent-request buffer
- `npm run build` after fixing local-day window bucketing and session-finalization ordering in the new persistence model
- `npm run build` after adding session-level rollups to the usage snapshot and a session-analysis tab with grouping/filter controls in the renderer
- `npm run build` after adding persisted usage cost settings and the Cost analysis tab in Usage Stats
- `npm run build` after canonicalizing usage token fields across request rows and persisted session rollups
- `npm run build` after widening usage tracking to legacy non-v1 completion endpoints
- `npm run build` after adding separate cache-token accounting to Usage Stats
- `npm run build` after implementing proxy-backed usage stats, persistence, preload bridge, and Usage Stats page
- `npm run build`
- `npm run build` after renderer/source-update review fixes
- `npm run build` after LiteLLM provider implementation and review fixes
- `npm run build` after the dedicated LiteLLM manager page and local proxy control flow
- `npm run build` after removing the remaining LiteLLM-template runtime path
- `npm run build` after normalizing legacy templates and removing the stale LiteLLM settings API surface
- `npm run build` after fixing LiteLLM startup entry-point and readiness timeout handling
- `npm run build` after adding managed LiteLLM API key support for proxy test and model listing
- `npm run build` after making managed LiteLLM startup ignore inherited master-key auth in no-auth mode
- `npm run build` after adding managed LiteLLM shutdown cleanup on app exit
- `npm run build` after implementing persisted dark mode, cross-window theme sync, and dark-aware window bootstrap colors
- `npm run build` after renaming the app to LlamaDeck and adding legacy user-data compatibility for packaged upgrades
- `npm run build` after adding the persisted minimize-to-tray main-window behavior and Settings toggle
- `npm run build` after packaging the tray icon asset and hardening packaged icon resolution for minimize-to-tray
- `npm run build` after adding top-grouped overridden parameters in the template Advanced Parameters editor
- `npm run build` after fixing default-true boolean flags to emit `--no-*` args when switched off
- `npm run build` and `npm run package` after fixing bundled commands-schema loading for packaged builds
- `npm run build` after adding in-memory live model output streaming and the Live Output page
- `npm run build` after adding CPU-only backend source builds, active-backend persistence, and safe failed-build cleanup
- `npm run build` after adding backend flavor labels so CPU and CUDA backends render distinctly across the UI
- `npm run build` after hiding CPU/CUDA build buttons when the latest installed variants already exist
- `npm run build` after removing the guard that stopped other running templates before launching a new one
- `npm run build` after extending proxy usage extraction to cover `/v1/responses` and Responses API usage payload shapes
- `npm run build` after splitting the Cost tab into a read-only view plus a new Pricing tab and switching the cost resolver to per-template with app-wide fallback
- `npm run build` after replacing the unconditional auto-scroll in Live Output with a sticky-scroll that respects manual scroll position and adds a "N new chunks ↓" jump-to-bottom pill
- `npm run build` after switching the Usage Stats filter to a from/to timestamp range with five presets and a Custom range picker
- `npm run test:run` (7 files, 50 tests) and `npm run build` after adding per-build commands-schema generation, the overlay merger, the lazy first-access fallback, and the bundled `b9202.json` snapshot

## Next Recommended Check
- Manual smoke test for proxy-backed usage stats: start an API template, send both standard and streaming requests through `/v1/chat/completions`, `/v1/responses`, `/completions`, or `/completion`, confirm the request rows appear live on Usage Stats, verify input/cache/output/total stay internally consistent between the summary card and request rows, stop the session, restart the app, and confirm historical totals remain while Recent Requests resets.
- Manual smoke test for usage cost analysis: set non-zero input/cache/output rates in the Cost tab, reload the app, confirm the same rates persist, and verify overall/session/template/day/request cost totals recalculate as expected when the configured rates change.
- Add the smallest automated tests for `src/main/runtimePorts.ts`, `src/main/usageLedger.ts`, and the extraction path in `src/main/llamaProxy.ts`.
- Manual smoke test in the running app: point the backend folder at a llama.cpp repo, run "Check Now", trigger "Build From Source", confirm a new `b####` folder appears without deleting older builds, confirm the active backend stays unchanged unless the user changes it, and confirm cancel stops without an error alert.
- Manual smoke test for CPU/CUDA source builds: from Settings, build the latest CUDA backend and then `Build CPU Only`, confirm the CPU build lands in a separate `b####-cpu` folder, confirm the global active backend does not change automatically, pin one embedding template to the CPU backend manually, and verify standard `Default (Active)` templates still use the persisted global active backend.
- Manual smoke test for LiteLLM manager: open the LiteLLM page, confirm Python detection, install or update LiteLLM if needed, save the default config, set a local proxy API key if your config requires auth, start the proxy, test the local proxy, refresh remote models, and confirm a local template still starts against a local backend as before.
- Manual smoke test for theming: switch between Light, Dark, and System in Settings, open a chat window, confirm the chat window follows the same theme, and if using System, toggle the OS theme while both windows stay open.
- Manual smoke test for tray behavior: enable "Minimize To Tray" in Settings, click the main window X, confirm the app hides and shows a tray icon, restore it from the tray icon/menu, and confirm choosing Quit from the tray still shuts down managed processes.
- Packaging note: `npm run package` rebuilt the zip/unpacked outputs successfully after the tray fix, but NSIS installer regeneration was blocked by a locked existing `dist/LlamaDeck Setup 1.0.0.exe` file during validation.
- Manual smoke test for packaged schema fallback: install the generated Windows build, import one of the PowerShell-derived templates, expand its advanced parameters, and confirm the command editor loads instead of showing the missing-schema message.
- Manual smoke test for live output: start a template, confirm the app switches to Live Output, verify stdout and stderr appear live without any file log being written, then stop the model and confirm the exit message appears and the card status returns from running.
- Usage stats caveat: the page currently keeps its filter/query state locally instead of in Zustand, which keeps the implementation narrow but means there is no cross-view persistence of the selected stats filters yet.
- Residual polish gap: when the saved app theme differs from the OS theme, a cold-open main window or newly opened chat window can still flash the OS-based background before renderer hydration applies the saved theme.
- Rename caveat: packaged upgrades preserve the legacy Hexllama data directory, but the installer identity, taskbar pins, and shortcuts still move to the new LlamaDeck identity rather than migrating in place.
- Manual smoke test for per-template pricing: open the Pricing tab, save new app-wide defaults and confirm the Cost tab recalculates. Toggle one template on, set non-zero rates, save, and confirm that template's session/template-rollup rows in the Cost tab use the new rates while others stay on app-wide. Toggle the template off, save, and confirm the Cost tab reverts. Reload the app and confirm both surfaces persist. Delete a template that had per-template pricing and confirm historical cost rows for that template fall back to app-wide. Export a template with pricing, re-import on a fresh install, and confirm the pricing block survived the round-trip.
- Manual smoke test for richer date filters: click each preset chip (Today / 7d / 30d / This month / All time) and confirm the summary cards and rollup tables recalculate, with the active chip highlighted. Open the Custom range disclosure, set a from/to spanning a few days, click Apply, and confirm the data updates and no chip is highlighted (now in "Custom" mode). Set `from > to` in the Custom panel and confirm the Apply button is disabled. Set one of the dates blank and confirm Apply is disabled. Pick a filter, close the app, reopen, and confirm the same filter is restored. Confirm "All time" still works (no records filtered out). Confirm the Cost tab's per-row pricing still resolves correctly (regression check that the IPC change didn't break the existing snapshot shape).
- **Manual smoke test (run before merging) for per-build commands-schema generation.** The feature spec lives at `docs/superpowers/specs/2026-06-07-per-build-commands-schema-generation-design.md` and the plan at `docs/superpowers/plans/2026-06-07-per-build-commands-schema-generation.md`. New code lives in `src/main/commandsSchemaParser.ts` (parses `llama-server --help`), `commandsSchemaMerger.ts` (pure-function overlay merger), `commandsSchemaLoader.ts` (file I/O + cache), `commandsSchemaGenerator.ts` (spawn + write), and `src/shared/schemas.ts` (Zod schemas). Bundled data: `resources/commands/overlay.json` (curated metadata, 212 entries) and `resources/commands/b9202.json` (shipped snapshot, 241 commands). `resources/commands.json` was removed in favor of the overlay + snapshot split. `src/main/ipc.ts` was updated so `get-commands` uses the loader, `update-backend-source` calls the generator on the success path, and a lazy first-access fallback regenerates `generated.json` if it is missing. Test coverage: 50 unit/integration tests across 7 files, with 80%+ coverage on the new files. After a successful source build of `<buildTag>`, `<userData>/backends/<buildTag>/generated.json` is auto-written; to force-regenerate, delete that file and reopen the build in the app. Then:
  1. Run the source-build flow end-to-end. Verify the auto-generated file exists:
     ```bash
     ls -la "$APPDATA/hexllama/backend/<buildTag>/generated.json"
     ```
     (Windows path: `%APPDATA%\\hexllama\\backend\\<buildTag>\\generated.json`.) Confirm the file appears after a successful build and contains a `commands` array.
  2. Open the CommandsEditor in the app and verify these flags render with the correct types, defaults, and constraints:
     - `--ctx-size` (number, default 0, min 0)
     - `--threads` (number, default -1, max 256)
     - `--batch-size` (number, default 2048, min 1, max 65536)
     - `--n-gpu-layers` (number, no min/max overlay)
     - `--flash-attn` (select with `[on, off, auto]` options)
  3. Verify the lazy first-access path: rename `<userData>/backends/<buildTag>/generated.json` to `generated.json.bak`, open the app, switch to a template that uses that build, confirm the CommandsEditor briefly shows a loading state and then the schema appears, verify `generated.json` reappeared at the original path, and restore from backup.
