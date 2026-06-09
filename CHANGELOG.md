# Changelog

All notable changes to LlamaDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [1.0.0] - 2026-05-XX

### Added
- Initial release. (Hand-curate from `git log` before this date.)
