# AGENTS.md

Project-level guide for AI agents working on LlamaDeck. Read this before doing meaningful work. The global orchestration rules in `~/.Codex/AGENTS.md` apply on top of this.

## Project

LlamaDeck is an Electron desktop app — a GUI for managing and running local LLMs through llama.cpp. Users browse Hugging Face, download GGUF models, build/switch llama.cpp backends, run models via a managed OpenAI-compatible proxy (LiteLLM), and edit backend launch parameters through a structured editor.

## Tech Stack

- **Electron 31** + electron-vite + electron-builder
- **TypeScript 5.5** (strict)
- **React 18** + **Zustand** (renderer state)
- **Zod** for runtime validation at IPC boundaries
- **Vitest** for tests
- **PowerShell** for the source-build helper (Windows-only)

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production bundles → `out/main`, `out/preload`, `out/renderer` |
| `npm run package` | NSIS installer + portable zips → `dist/` |
| `npm run test` | Vitest in watch mode |
| `npm run test:run` | Vitest once |
| `npm run test:coverage` | Vitest with v8 coverage (80% threshold) |

## Layout

- `src/main/` — Electron main process (Node)
  - `ipc.ts` — IPC handler hub. Large file (~2400 lines) but conventional; new IPC handlers go here.
  - `commandsSchema*.ts` — per-build commands schema pipeline (parser, merger, loader, generator, schemas)
  - `schemas.ts` — Zod schemas for IPC boundaries
  - `userData.ts` — userData path resolution + migration
- `src/preload/` — Electron preload (context bridge)
- `src/renderer/` — React app
- `src/shared/` — types shared between main and renderer
- `resources/commands/` — bundled with the app
  - `overlay.json` — curated metadata (label, category, icon, placeholder, min, max) per `--arg`
  - `b9202.json` — shipped structural snapshot (committed, regenerable)
- `scripts/` — one-time migration scripts (not shipped in build)
- `dist/` — build output (gitignored)
- `__tests__/fixtures/` — captured real-world test data (e.g. `b9202-help.txt`)

## Documentation

- `docs/HANDOFF.md` — cross-session state, what shipped, what's next
- `docs/KNOWLEDGE.md` — durable lessons, toolchain traps, non-obvious root causes
- `docs/DECISIONS.md` — durable decisions future work depends on
- `docs/superpowers/specs/<topic>-design.md` — design specs
- `docs/superpowers/plans/<topic>.md` — implementation plans
- `CHANGELOG.md` — version history (see conventions below)

When picking where a new doc lives, follow the existing structure. Don't create a competing one.

## Changelog Conventions

Top-level `CHANGELOG.md`. Keep-a-Changelog format with these project-specific conventions:

- **Header**: Keep-a-Changelog preamble + Semantic Versioning line.
- **`[Unreleased]`** section at the top, always present even when empty.
- **Each version** as `## [VERSION] - YYYY-MM-DD` in reverse chronological order.
- **Standard subsections** (use what fits, in this order): Added, Changed, Deprecated, Removed, Fixed, Security.
- **For substantive releases with many disparate changes**, group by feature area as a sub-list under "Added" (see 1.0.0 in the current changelog).
- **Write for users**, not developers. State what changed for the user, not what files were created. Internal implementation details (refactors, test additions, parser bug fixes) belong in commit messages, not the changelog.
- **Reference commits with their 7-char SHA** when useful for traceability (`34c4b40`).
- **PR / issue numbers** when relevant (`#1`).
- **Date format**: ISO `YYYY-MM-DD`.
- **Versioning**: Semver. Patch (1.0.x) for bug fixes and small features that don't change the public API; minor (1.x.0) for backward-compatible features; major (x.0.0) for breaking changes.

When bumping the version, update both `package.json` and the changelog in the same release.

## Source-Build Flow

When the user clicks "Update from source", the app:

1. Validates the configured `backend` folder is a llama.cpp git repo.
2. Spawns `update-llama-source.ps1` (embedded in `src/main/ipc.ts`, written to `%APPDATA%\hexllama\` on first use).
3. The script does: `git fetch` + `git reset --hard <tag>` → `cmake -G Ninja -DCMAKE_BUILD_TYPE=Release …` → `cmake --build … -j`.
4. Output lands in `<backend>/b####/` with `bin/llama-server.exe`.
5. On success, the main process calls the **per-build commands schema generator** which spawns `llama-server --help`, parses the output, validates with Zod, and writes `<backend>/b####/generated.json` atomically.

For CUDA builds, the user is prompted to pick **Single-threaded** (`-DGGML_SCHED_MAX_COPIES=1`, slower, more stable, less likely to OOM) or **Parallel** (default, faster). CPU builds skip the prompt.

Prerequisites: `git`, `cmake`, `ninja`, MSVC `cl.exe` (via vcvars), optional CUDA toolkit. Set `HEXLLAMA_BUILD_TYPE` env var to override `Release`.

See `docs/superpowers/specs/source-backend-update/` for the full design.

## Per-Build Commands Schema

The legacy hand-maintained `resources/commands.json` (212 entries, already drifting) was replaced by an automated pipeline:

- **Parser** (`commandsSchemaParser.ts`) — pure function `parseHelpOutput(stdout): Command[]`. Handles 4 section headers, comma-separated flag chains, 6 value-placeholder shapes, type inference, default extraction, env, deprecation detection.
- **Merger** (`commandsSchemaMerger.ts`) — pure function combining structural + overlay + user override. Field-level precedence: structural fields from structural, curated fields (label, category, icon, placeholder, min, max) from overlay or auto-derived, user override wins.
- **Loader** (`commandsSchemaLoader.ts`) — file I/O with mtime-based in-memory cache. Resolution chain: per-build `generated.json` → shipped `<buildTag>.json` snapshot → user override → null.
- **Generator** (`commandsSchemaGenerator.ts`) — spawns `llama-server --help`, validates with Zod, writes atomically. `SpawnFn` is dependency-injected for testability.
- **Overlay** (`resources/commands/overlay.json`) — curated metadata only.
- **Snapshot** (`resources/commands/b9202.json`) — shipped structural schema for the build the app currently targets. Regenerate via `scripts/migrate-commands-overlay.ts` when bumping target build.

The IPC handler `get-commands` uses the loader; `update-backend-source` calls the generator at the success path; both have a lazy first-access fallback.

Design and implementation: `docs/superpowers/specs/2026-06-07-per-build-commands-schema-generation-design.md`, `docs/superpowers/plans/2026-06-07-per-build-commands-schema-generation.md`.

## Code Conventions

- **Zod at IPC boundaries** — every IPC handler that reads JSON from disk parses through a Zod schema first. Don't trust on-disk data.
- **Atomic file writes** — `writeFileSync(tmp)` + `renameSync(tmp, target)`. A crash mid-write leaves an orphan `.tmp`; the next run overwrites it.
- **Dependency-injected spawn** — accept a `SpawnFn` parameter for testability. The default `spawn` from `child_process` is wired in by the production caller.
- **Pure functions for logic** — parsers, mergers, and other transformations are pure. Side effects (I/O, spawning) live in wrapper modules.
- **No `any` in new code** — use `unknown` and narrow. The project does not have `any` in production code by convention.
- **Type imports** — `import type { ... }` for type-only imports.
- **Named constants for magic numbers** — `CONTINUATION_INDENT_COLS = 38` is acceptable; `38` alone is not.

## Testing

- Tests live in `__tests__/*.test.ts` adjacent to the code under test.
- Use `vi.fn()` for dependency injection in tests (see `commandsSchemaGenerator.test.ts`).
- Filesystem tests: `mkdtempSync(join(tmpdir(), 'hexllama-<purpose>'))` for temp dirs, `rmSync(..., { recursive: true, force: true })` in `afterEach`.
- On Windows, **always** `mkdirSync(..., { recursive: true })` before writing nested files — `writeFileSync` does not create parent dirs.
- Coverage: 80% threshold on the per-build schema pipeline (`commandsSchema*.ts`, `schemas.ts`). Run `npm run test:coverage` to check.

## Known Patterns and Anti-Patterns

- **`isSafePath(parentDir, name)`** before any path construction in IPC handlers. The current convention is to call it before `join()`.
- **Module-level mutable state** in the main process is OK for caches (`commandsSchemaLoader`'s mtime-keyed Map is fine). Be deliberate about it.
- **Don't refactor `src/main/ipc.ts` opportunistically.** It's large but it's the conventional hub. New IPC handlers go there; if a refactor is needed, file a follow-up task.
- **Renderer-side data assumptions** — the renderer reads schemas through the IPC contract, not by reading `resources/commands.json` directly. If you change a schema, check the renderer consumer.
- **Windows path semantics** — `fs.writeFileSync` from a generator using `renameSync` updates mtime (verified). User-override writes from `save-backend-commands` use plain `writeFileSync` and inherit the inode's mtime, so the loader's mtime-hash check invalidates correctly.

## Versioning and Release Process

1. Pick next version per Semver rules.
2. Update `package.json`.
3. Add a section to `CHANGELOG.md`.
4. Commit: `chore: bump version to X.Y.Z`.
5. Build: `npm run package`.
6. (When ready) push, tag, and publish via GitHub Releases (the workflow at `.github/workflows/` auto-increments).
