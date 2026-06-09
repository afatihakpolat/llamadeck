# Changelog

All notable changes to LlamaDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
