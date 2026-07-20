# Changelog

All notable changes to LlamaDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.1] - 2026-07-20

### Changed
- Packaged upgrades now move the legacy user profile into `%APPDATA%\llamadeck` once instead of continuing to run from the old branded directory. If another LlamaDeck profile already exists, it is preserved as a timestamped backup before the canonical profile is moved.
- Renderer preferences are migrated to `llamadeck_*` storage keys and their legacy duplicates are removed automatically.

### Fixed
- The PowerShell CLI now ignores endpoint descriptors owned by dead processes and discovers the running app exclusively through the LlamaDeck profile, preventing stale development or pre-rename endpoints from masking the live app.

## [1.5.0] - 2026-07-20

### Added
- A new Agent Skills page detects Codex, Claude Code, Gemini CLI, and OpenCode; shows the skills each tool can discover; and installs, updates, or removes LlamaDeck-managed copies without overwriting personal skills.
- LlamaDeck now bundles its own control skill, including the LiteLLM workflow, and can import validated local `SKILL.md` folders into a managed library for deployment to compatible agent tools.

## [1.4.0] - 2026-07-20

### Added
- The PowerShell CLI can now install, update, start, stop, restart, test, inspect, and follow logs for the app-managed LiteLLM proxy, list its models, and validate or save its YAML config. The CLI and GUI stay synchronized, and API keys are redacted from all CLI output.

## [1.3.0] - 2026-07-20

### Added
- LlamaDeck can now be controlled from PowerShell with `llamadeck` commands for creating, updating, deleting, validating, listing, inspecting, starting, stopping, and waiting for templates; following live model logs; selecting the active backend; checking running status; and showing the app. Commands expose machine-readable capabilities and return JSON for agent automation, while the Windows installer adds the CLI to the user `PATH`.
- The GUI now refreshes when CLI commands change templates or select the active backend, so both interfaces can be used together against the same running app.

## [1.2.5] - 2026-07-18

### Added
- Templates are now organized into collapsible groups by their model subfolder, keeping provider folders out of the template list and making large collections easier to browse.

## [1.2.4] - 2026-07-15

### Added
- **A proper YAML editor for LiteLLM proxy configuration.** The editor now includes line numbers, syntax highlighting, folding, search, indentation support, live validation, file status, and Ctrl+S saving.

### Changed
- LiteLLM config saving is now atomic, and malformed or duplicate-key YAML is blocked before it can replace the last working config.
- Reloading the LiteLLM config now discards only config edits instead of also resetting unrelated runtime fields.

### Fixed
- **App update checks no longer always report that an update is already in progress.** The updater now blocks only genuinely overlapping checks or downloads and releases the guard after success or failure.

## [1.2.3] - 2026-07-15

### Fixed
- **In-app updates can now connect to GitHub Releases.** Packaged builds correctly initialize the updater, and releases now include the update manifest and download metadata under matching filenames.

## [1.2.2] - 2026-07-15

### Fixed
- **ReferenceError on update check.** A previous edit left `throw new Error(NOT_AVAILABLE_ERROR)` referring to a constant that had been inlined into a helper, so the throw sites threw `ReferenceError` instead of the intended message. Now inline the error string at each throw site.

## [1.2.1] - 2026-07-15

### Fixed
- **App Updates showed "Update manager not initialized" on launch.** The renderer called `update:check` before `initUpdateManager()` finished its async load of `electron-updater`. The bootstrap now awaits init before registering IPC handlers, catches load failures so the app still boots, and surfaces a clean "In-app updates are not available." error if init ever fails.

## [1.2.0] - 2026-07-15

### Added
- **In-app app updates.** LlamaDeck now checks GitHub Releases for new versions, downloads updates in the background, and prompts you to restart at your convenience. Open Settings → App Updates to check manually, see release notes, and toggle "Check on launch" / "Auto-download". Powered by `electron-updater`.
- **Updates preserve the Windows taskbar pin.** The NSIS installer path is now locked, so updates install into the same `%LOCALAPPDATA%\Programs\llamadeck` folder and your pinned shortcut survives every future update.

### Changed
- NSIS installer no longer offers a path picker on new installs.

### Fixed
- Clicking the taskbar icon while LlamaDeck is already running no longer starts a second instance. LlamaDeck now uses `app.requestSingleInstanceLock()`; subsequent launches focus the existing window instead of spawning a new process.

## [1.1.5] - 2026-07-13

### Added
- CUDA backends now show their Single or Parallel scheduler mode in the sidebar. New source builds remember the selected mode, while existing source builds are detected from their build cache when possible.

### Changed
- The CUDA build prompt now accurately describes the runtime memory and throughput tradeoff between Single and Parallel modes.

## [1.1.4] - 2026-07-09

### Added
- `--spec-type` can now select multiple speculative decoding modes, such as `draft-mtp,ngram-mod`, while still launching llama.cpp with the required comma-separated value.

## [1.1.3] - 2026-07-01

### Fixed
- **Recent Logs text not selectable in LiteLLM view.** The `body` element has `user-select: none` globally, but `<pre>` was not included in the opt-in list, making log output impossible to drag-select and copy.

## [1.1.2] - 2026-06-09

### Added
- Settings page now shows a small `LlamaDeck vX.Y.Z` badge in the page header, sourced from `app.getVersion()` (i.e. `package.json`). Updates automatically with each version bump.

## [1.1.1] - 2026-06-09

### Fixed
- **Root cause of "select with nonsense options" on bare-comma placeholders.** Several flags like `--tensor-split N0,N1,N2,...`, `--fit-target MiB0,MiB1,MiB2,...`, `--override-kv KEY=TYPE:VALUE,...`, `--lora-scaled FNAME:SCALE,...`, `--tools TOOL1,TOOL2,...` use uppercase-leading items to indicate a TYPE (first value, MiB value, key=value pair, etc.), not a fixed enum. The parser's bare-comma branch treated them as selects. New rule: a bare-comma placeholder is a select only if **all items start with a lowercase letter**; otherwise it's a free-form `string` for the user to fill in. Real enums like `--spec-type none,draft-simple,...` and `--pooling {none,mean,...}` still classify as `select`.
- Bundled `b9202.json` snapshot regenerated: 12 commands have `options` (down from 18 in 1.1.0; 6 of those were the broken format placeholders).
- New regression fixture `b9584-help.txt` (captured from the user's installed build, 642 lines, 243 commands) with parallel integration tests covering balanced parens, no-stray-`(` invariants, and the new format-placeholder rule.

## [1.1.0] - 2026-06-09

### Fixed
- Parser no longer treats angle-bracket placeholders with commas (e.g. `--device-draft`'s `<dev1,dev2,..>`) as `select` enums. Those are typed format placeholders, not fixed enums; the user enters free-form text.
- Parser no longer treats square-bracket forms without `|` (e.g. `--docker-repo`'s `[<repo>/]<model>[:quant]`) as `select` enums. The brackets are optional-syntax markers. Real enums like `[on|off|auto]` (with `|`) still work.
- Bundled `b9202.json` snapshot regenerated with the corrected parser: 18 commands have `options` (down from 19); no more nonsense options like `<repo>/]<model>[:quant`.

### Added
- `scripts/regen-b9202-snapshot.ts` to regenerate the bundled snapshot from the parser + b9202 fixture, without depending on the deleted legacy `resources/commands.json`.

## [1.0.9] - 2026-06-09

### Changed
- Live Output: text in the output stream is now selectable (drag-select, copy). The body still has `user-select: none` globally for non-interactive UI, but the live output viewport and per-line text spans opt in.
- Template start no longer auto-navigates to the Live Output view. The model starts, the card's status updates, and the user stays on whichever page they were on. The selected output is still tracked, so navigating to Live Output manually highlights the right card.

## [1.0.8] - 2026-06-09

### Fixed
- **Root cause of "No commands schema loaded" for per-build backends.** `get-commands` called `isSafePath(backendDir, backendName)` with the bare basename (e.g. `"b9570"`). `isSafePath` resolves relative targets against the current working directory, so the resolved target was `CWD/b9570` — never a subpath of the actual backend folder. Every per-build backend was rejected as "unsafe path", the failure was logged to `commands-schema-gen.log`, and `get-commands` returned `null`. Joining `backendDir` and `backendName` before the safety check fixes it.

## [1.0.7] - 2026-06-09

### Fixed
- `get-commands` IPC handler now logs unsafe-path rejections to `commands-schema-gen.log` instead of returning `null` silently. Path-traversal or other safety rejections were previously invisible; now they show up in the log file with the offending backend name and the parent dir.

## [1.0.6] - 2026-06-09

### Added
- Commands-schema generation failures are now appended to `%APPDATA%\hexllama\commands-schema-gen.log` in addition to the existing `console.warn`. Line format: `[ISO timestamp] [phase] backend=<name> path=<path> error=<message>`. Lets you see why a backend's schema couldn't be generated without running the app from a terminal.

## [1.0.5] - 2026-06-09

### Fixed
- `run-model` IPC handler produced a doubled executable path (`C:\llm\llama.cpp\b9570\C:\llm\llama.cpp\b9570\bin\llama-server.exe`) because the 1.0.3 fix made `backend.exe` absolute but the spawn handler still did `join(backendPath, exe)`. Reverted `listBackendsFromDirectory` to its original (relative) `exe` and taught `commandsSchemaGenerator` to resolve relative `exe` against `backend.path`. Both the spawn handler and the generator now work.
- Removed the misleading "Fallback Schema" badge from the Settings → Installed Backends list. The badge was shown for any backend without a user-override `commands.json`, but with the new auto-generated per-build schema pipeline, a backend can have a perfectly valid schema without any user override. "Fallback" implied something was broken; the badge added noise more than signal.

## [1.0.4] - 2026-06-09

### Fixed
- `CommandsEditor` now populates the global `commandsSchema` store on initial load (not just on save). Previously, `CmdParamsEditor` showed "No commands schema loaded. Ensure a backend is installed." because it reads from the global store while the schema was only set into local state. The local-vs-global split was a pre-existing bug; this fixes the symptom for the CommandsEditor path.

## [1.0.3] - 2026-06-09

### Fixed
- Per-build backend parameter generation was silently failing for any per-build folder with `bin/llama-server.exe` (e.g. `b9464-cpu`, `b9534`). `listBackendsFromDirectory` returned a relative `exe` path, but the generator's `existsSync` guard checked the current working directory, so it bailed with "llama-server.exe not found" and the user saw an empty CommandsEditor. The `exe` field is now an absolute path.

## [1.0.2] - 2026-06-09

### Added
- CUDA build mode prompt. When building from source with CUDA, the user is asked to pick **Single-threaded** (`-DGGML_SCHED_MAX_COPIES=1`, slower, more stable, less likely to OOM) or **Parallel** (default, faster). CPU builds skip the dialog and use parallel.

## [1.0.1] - 2026-06-08

### Added
- Per-build commands schema generation. `llama-server --help` is parsed at source-build time to produce a per-build `generated.json` in the backend folder. The schema is loaded at runtime, layered with a curated overlay (label, category, icon, placeholder, min, max) and the user's CommandsEditor override. A bundled snapshot ships for the b9202 build.
- `src/main/commandsSchemaParser.ts` — pure function that converts `--help` stdout to a structural `Command[]`. Handles 4 section headers, 6 value-placeholder shapes, type inference, default extraction (inline + wrapped), env vars, deprecated-flag detection, alias/negation forms.
- `src/main/commandsSchemaMerger.ts` — pure function combining structural commands, overlay, and user override with field-level precedence and alias resolution.
- `src/main/commandsSchemaLoader.ts` — file I/O wrapper with mtime-based in-memory cache. Resolves per-build `generated.json` → shipped `<buildTag>.json` snapshot → user override.
- `src/main/commandsSchemaGenerator.ts` — spawns `llama-server --help`, validates the result with Zod, writes atomically.
- `src/main/schemas.ts` — Zod schemas for `Command`, `Overlay`, `StructuralSchema`, `MergedSchema`.
- `scripts/migrate-commands-overlay.ts` — one-time migration that splits the legacy `resources/commands.json` into `resources/commands/overlay.json` (curated metadata, 212 entries) and `resources/commands/b9202.json` (shipped structural snapshot, 241 commands).
- `vitest` test framework and `zod` runtime validation as new dev/runtime dependencies. 51 unit + integration tests, 80%+ coverage on the new files.
- `src/main/__tests__/fixtures/b9202-help.txt` — 51 KB real captured `--help` output used as an integration-test fixture.

### Changed
- `get-commands` IPC handler now uses the loader to return a merged `CommandsSchema` (categories with icons, labels, curated metadata) instead of the raw bundled JSON. The renderer's `setCommandsSchema` already accepts this shape; no renderer changes needed.
- `update-backend-source` IPC handler now calls the generator at the success path (95% progress → `generating-schema` phase → 100% / `done`). Wrapped in try/catch so an unhandled error resolves the IPC promise with a structured error rather than hanging the renderer's build UI.
- Lazy first-access regeneration: when a per-build `generated.json` is missing, `get-commands` triggers an in-process regeneration before falling back to the bundled snapshot.

### Removed
- `resources/commands.json` (212 hand-maintained entries). Replaced by `resources/commands/overlay.json` (curated) + `resources/commands/b9202.json` (auto-generated snapshot).

### Fixed
- `electron-builder.yml` packaging list updated to ship the new bundled files. The previous entry `resources/commands.json` would have broken `npm run package`.
- Parser now handles all four wrapped `(default: ...)` shapes (the previous parser only stripped inline clauses, leaving 23 of 241 b9202 commands with malformed descriptions and stray `)`).
- Parser now detects `[DEPRECATED:` in the flag-line description body, not just continuation lines (3 of 4 deprecated flags in b9202 were silently un-marked).
- `get-commands` path is hardened: `isSafePath(backendDir, backendName)` is called before any path construction.

## [1.0.0] - 2026-06-07

### Added

**Model management**
- Integrated Model Hub: search Hugging Face directly within the app, browse repositories, view file details, download GGUF models with a single click.
- Smart Download Manager: pause, resume, cancel large downloads; paste direct GGUF links; auto-generate an execution template with recommended threads, batch sizes, and context windows tailored to model size and quantization.
- Multiple concurrent model runs on different ports.

**Templates and execution**
- Template-based execution: save configurations as reusable templates; run multiple models simultaneously without port conflicts.
- Chat UI mode (auto-opens the built-in llama.cpp web interface) and API Only mode (silent background server).
- Visual Command Editor: structured UI for backend-specific commands; toggle booleans, set limits on numerical inputs, define default parameter values.

**Backends and source build**
- Version and Backend Management: maintain and switch between multiple backend binaries; automatic update checks against the ggml-org repository with download + extract from the settings panel.
- Source build flow: build llama.cpp from a local git checkout, versioned `b####` build folders, older folders preserved, new backend set active after a successful build.
- CPU/CUDA backend flavors with persisted active backend.
- Concurrent template launches.

**LiteLLM and OpenAI proxy**
- Managed LiteLLM loopback proxy for OpenAI-compatible access to local models.
- Configurable paths.
- Proxy-backed usage stats and Live Output.
- Usage Cost settings and Cost tab; normalized token calculations.
- OpenAI `/v1/responses` usage tracking in proxy.

**Per-template pricing**
- Per-template pricing with app-wide fallback.

**Usage stats and filters**
- Date filters with custom range support, from/to timestamp range query model (replaced the older `UsageStatsWindow` enum).
- Sticky scroll with jump-to-bottom pill in Live Output.

**UI**
- Rebrand to LlamaDeck with theming support.
- System tray icons.

**CI / packaging**
- GitHub Actions workflow for automated GitHub releases and auto-incrementing version tags.
- Electron-builder packaging: Windows NSIS installer and portable `.zip` for both x64 and arm64.
- `npm run package` reproduces the build locally.
