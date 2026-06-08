# Per-Build Commands Schema Generation — Design

## Problem Statement

The bundled `resources/commands.json` is hand-maintained and already drifting from upstream llama.cpp. On the installed b9202 build:

- 308 unique `--` flags exist in `llama-server --help` output
- 212 are in the bundled schema (96 missing, 1 stale: `--system-prompt`)
- Min/max values for 23 flags were curated from C++ source, not from `--help`

When a new build lands (e.g. b9219), the schema lags until someone hand-edits the JSON. The current state is brittle and will only get worse.

## Goal

Auto-generate a per-build `CommandsSchema` from `llama-server --help` at source-build time, layer it with a curated overlay for fields `--help` cannot provide, and resolve the right schema for any installed build at runtime.

## Non-Goals

- Generating fields that require C++ source code knowledge (most min/max bounds).
- Inferring curated labels, categories, or icons from `--help` text.
- Supporting non-`llama-server` binaries (e.g. `llama-cli`).
- Auto-deriving section-to-category mappings dynamically (the mapping is committed code; the overlay can override it per build).

## Solution Summary

Three layers, three files, three responsibilities:

1. **Generator** (`src/main/commandsSchemaGenerator.ts`): spawns `llama-server --help`, parses the output, writes a structural `CommandsSchema` to `<backendDir>/<buildTag>/generated.json`. Pure side-effecting.
2. **Loader + Merger** (`src/main/commandsSchemaLoader.ts`): reads the per-build structural schema (or shipped snapshot as fallback), layers the user override, applies curated metadata from the overlay, returns a merged `CommandsSchema`. Pure function, easy to test.
3. **Curated overlay** (`resources/commands/overlay.json`): ships with the app. Only curated fields. Maps `--arg` → `{ label, category, icon, placeholder, min, max }`.

Existing `get-commands` IPC handler is updated to call the merger. The existing user-override slot (`<backendDir>/<buildTag>/commands.json`) is preserved and continues to function.

## Architecture

```
┌─ Build-time (one-time per successful source build) ─────────────┐
│  update-backend-source (ipc.ts:2179)                             │
│    └─ child.on('exit', code === 0) at ipc.ts:2287                │
│         └─ listBackendsFromDirectory → finds new <buildTag>      │
│              └─ generateCommandsSchemaForBuild(newBackend)       │
│                   ├─ spawn llama-server --help (with timeout)    │
│                   ├─ parse stdout → CommandsSchema               │
│                   ├─ validate with Zod                           │
│                   └─ write <backendDir>/<buildTag>/generated.json│
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Read-time (on get-commands from renderer) ──────────────────────┐
│  get-commands(buildTag)  (replaces ipc.ts:1911)                  │
│    1. Load per-build generated.json                              │
│       └─ missing? Load shipped snapshot resources/commands/      │
│            <buildTag>.json                                       │
│            └─ missing? Use bundled "fallback" (if any) or error  │
│    2. For each arg in structural, look up curated fields in      │
│       resources/commands/overlay.json                            │
│    3. Layer user override (<backendDir>/<buildTag>/commands.json)│
│       using alias resolution (aliasLongs map to canonical)       │
│    4. Return merged CommandsSchema                               │
└──────────────────────────────────────────────────────────────────┘
```

## File Layout

```
src/main/
  commandsSchemaGenerator.ts       # NEW: spawn, parse, validate, write
  commandsSchemaLoader.ts          # NEW: read, merge, cache
  ipc.ts                           # MODIFIED: get-commands, regenerate-commands-schema
  schemas.ts                       # NEW: Zod schemas for CommandsSchema + per-build shape

resources/commands/
  overlay.json                     # NEW: curated metadata only (extracted from current commands.json)
  b9202.json                       # NEW: shipped snapshot, the auto-gen output for b9202
  (legacy: resources/commands.json # DELETED after migration)

<userData>/backends/<buildTag>/
  bin/llama-server.exe             # existing
  generated.json                   # NEW: written by generator at source-build time
  commands.json                    # existing: user override (CommandsEditor output)
```

The shipped snapshot (`resources/commands/b9202.json`) is a one-time committed structural schema for the build the app currently targets. It exists so that:

- Users with a b9202 build installed before this feature shipped get a working schema without waiting for a generation run.
- The app degrades gracefully if `llama-server.exe` is missing or corrupted.
- The bundled overlay can be migrated independently of any per-build file.

When a new app release targets a newer build (e.g. b9219), the snapshot is regenerated as part of the release process and committed alongside the overlay.

## Parser Spec

The parser converts `llama-server --help` output into a structural `CommandsSchema`. It is a pure function `parseHelpOutput(stdout: string): Command[]`.

### Section Detection

`^----- (.+) -----$` marks section boundaries. Section names become the `section` field on each command and drive the section-to-category fallback in the merger.

### Flag Line Tokenization

A flag line starts with `-` (no leading whitespace) and contains one or more comma-separated flag tokens followed by a value placeholder (optional) and the start of the description.

```text
-c,    --ctx-size N                     size of the prompt context (default: 0, ...)
```

Tokenization:
1. Consume leading `-x,` or `--xxx,` (short or long) tokens separated by `,\s+` (one or more spaces).
2. The remaining text starts with the final long token (no trailing comma), optionally followed by a value placeholder and description.
3. The final long token may be a `--no-X` negation form; record it separately and continue.

Arg selection rule: **the last positive long** (no `--no-` prefix) becomes the canonical `--arg`. Earlier positive longs are recorded as `aliasLongs`. The negation longs are not enumerated as separate commands.

Examples:

| Line | canonical arg | aliasLongs | negation |
|------|---------------|------------|----------|
| `-c, --ctx-size N` | `--ctx-size` | — | — |
| `-n, --predict, --n-predict N` | `--n-predict` | `[--predict]` | — |
| `--perf, --no-perf` | `--perf` | — | `[--no-perf]` |
| `-kvu, --kv-unified, -no-kvu, --no-kv-unified` | `--kv-unified` | — | `[--no-kv-unified, -no-kvu]` |

### Continuation Lines

A continuation line is either blank or indented with 38+ spaces. The flag block's last line is whichever non-continuation line comes next.

Continuations are searched for these patterns (in order):

1. `(default: X, …)` or `(default: X)` — extract X as the default; strip from description.
2. `(env: VAR_NAME)` — record env var.
3. `allowed values: a, b, c, …` — record as options array; flag is type `select`.
4. `the argument has been removed. use --X or --Y` — mark `deprecated: true`, capture the note.
5. `[DEPRECATED: use --X]` — same.
6. `valid range X to Y` (inline in description) — record `{ min: X, max: Y }` if not already set.

All other continuation text is appended to the description.

### Value Placeholder Detection

The first whitespace-delimited token after the final long flag is treated as a value placeholder if it matches one of:

- `^[A-Z][A-Z0-9_]*$` — uppercase single word (`N`, `TYPE`, `FNAME`, `PROMPT`, `JSON`, …)
- Starts with `<` and ends with `>`, `]`, or `),...` — angle-bracket forms (`<user>/<model>`, `<0|1>`, `<0...100>`, `<user>/<model>[:quant]`, `<tensor name pattern>=<buffer type>,...`)
- Starts with `[` and ends with `]` — square-bracket enum (`[on|off|auto]`)
- Starts with `{` and ends with `}` — curly-brace enum (`{none,linear,yarn}`)
- `lo-hi` — CPU range pattern
- Contains a comma with no whitespace — comma-separated enum (`--spec-type none,draft-simple,...`)

If the first token does not match, the flag is `boolean` (no value) and the entire tail is description.

### Type Inference

| Signal | Type |
|--------|------|
| No value placeholder | `boolean` |
| Placeholder is `N`, matches `^<\d+(\.\.\.\| \|)\d+>$`, or has `valid range` | `number` |
| Has `options` from inline shape or `allowed values:` | `select` |
| Anything else | `string` |

### Default Value Coercion

After extraction, the raw default string is coerced based on the inferred type:

- `number` / `boolean`: `Number(rawDefault)`. If `NaN`, try `enabled` / `disabled` / `on` / `off` → `true` / `false`.
- `select` / `string`: strip surrounding `'…'` or `"…"`.

### Output Shape

The parser emits `Command[]`, where:

```typescript
interface Command {
  arg: string              // canonical --arg
  short: string | null     // -x, or null
  aliasLongs?: string[]    // other --long forms, only if present
  negationLongs?: string[] // --no-X forms, only if present
  description: string      // cleaned prose, no (default: ...) clauses
  type: 'boolean' | 'number' | 'string' | 'select'
  default?: string | number | boolean
  env?: string
  options?: string[]       // for select type
  deprecated?: boolean
  deprecationNote?: string
  section: string          // --help section name, for category fallback
}
```

The structural schema wraps this as `{ version, categories: [{ name: section, commands: Command[] }] }`.

## Merge Logic

The loader runs in this order:

1. **Resolve structural source** (highest priority first):
   - `<backendDir>/<buildTag>/generated.json` (per-build, written at source-build time)
   - `resources/commands/<buildTag>.json` (shipped snapshot)
   - If neither exists: return `{ version, categories: [] }` and log a warning. The CommandsEditor will show an empty editor; the user can trigger a regeneration.
   - `resources/commands/overlay.json` is NOT a structural source; it is only metadata.

2. **Walk each command in the structural source.** For each `--arg`:
   - Look up curated metadata in `resources/commands/overlay.json`.
   - Look up user override in `<backendDir>/<buildTag>/commands.json` by the same arg, OR by any of the structural command's `aliasLongs` or `negationLongs`.
   - Build a merged `Command`:
     - Structural fields: `arg`, `short`, `description`, `type`, `default`, `env`, `options`, `deprecated`, `deprecationNote`, `section`.
     - Curated fields: `label` (curated or auto-derived), `placeholder`, `min`, `max`, `category`, `icon`.
     - User-override fields: any of the above, **user wins**.

3. **Auto-derive label** for commands not in the overlay: split `--arg` on `-`, capitalize each part, join with space. Example: `--n-gpu-layers` → `"N Gpu Layers"`.

4. **Auto-derive category** for commands not in the overlay: use the section-to-category map in `resources/commands/overlay.json` under the `sectionMap` key (see Overlay Schema below).

5. **Re-bucket** commands by category (curated or derived) and emit `{ version, categories: [{ name, icon, commands }] }`.

### Caching

The loader caches the merged result per `(buildTag, mtimes-hash)` in memory. The hash is a SHA-1 of the mtimes of:

- The per-build `generated.json` (if present)
- The shipped snapshot (if used)
- The overlay
- The user override

The cache is invalidated when any of these change, or when the build's directory listing changes (newly built backend). No on-disk cache file is needed.

### Alias Resolution for User Overrides

User overrides are saved with the arg name as it appeared in the editor at save time. If the user saved an override for `--gpu-layers` and upstream renamed the canonical to `--n-gpu-layers`, the override must still apply to the merged `--n-gpu-layers` command.

The loader's lookup: for the structural command's canonical arg, first check user override for the canonical; if not found, walk `aliasLongs` and `negationLongs` in declaration order; first match wins. The merged result shows the canonical arg as the displayed name; the override is silently absorbed.

## Overlay Schema

`resources/commands/overlay.json` is the single source of curated metadata. Two top-level keys:

```typescript
interface Overlay {
  version: string                       // "1.0"
  sectionMap: Record<string, {          // --help section name → category
    name: string
    icon: string
  }>
  args: Record<string, ArgOverlay>      // canonical --arg → curated fields
}

interface ArgOverlay {
  label: string
  category: string                      // category name (matches sectionMap values or custom)
  icon: string                          // icon name (Box, Cpu, Zap, Database, Sliders, Wind, Server, FileText, GitBranch, Star, Settings)
  placeholder?: string
  min?: number
  max?: number
}
```

Curated args also live under `aliasLongs` keys: the overlay can map any historical alias to the same curated fields, so a user override for `--gpu-layers` (now an alias of `--n-gpu-layers`) finds the curated label even if the canonical is unknown. The generator's `aliasLongs` field drives this lookup at merge time.

## Generator Flow (build-time)

The new function `generateCommandsSchemaForBuild(backend: BackendVersion): Promise<GenerateResult>` is called from the `update-backend-source` success path at `ipc.ts:2287` after `listBackendsFromDirectory`.

```
async function generateCommandsSchemaForBuild(backend) {
  // 1. Locate the llama-server binary.
  const exe = path.join(backend.path, 'bin', 'llama-server.exe')
  if (!existsSync(exe)) return { ok: false, error: 'llama-server.exe not found' }

  // 2. Spawn with a 10-second timeout. Capture stdout.
  const { stdout, code } = await spawnCapture(exe, ['--help'], { timeoutMs: 10_000 })
  if (code !== 0) return { ok: false, error: 'llama-server --help exited with code ' + code }

  // 3. Parse the output.
  const commands = parseHelpOutput(stdout)
  if (commands.length === 0) return { ok: false, error: 'Parser produced zero commands' }

  // 4. Validate the output shape with Zod.
  const structural = { version: backend.name, categories: groupBySection(commands) }
  const validated = StructuralSchema.parse(structural) // throws on shape error

  // 5. Write to disk atomically: write to <generated.json.tmp>, rename.
  const target = path.join(backend.path, 'generated.json')
  const tmp = target + '.tmp'
  writeFileSync(tmp, JSON.stringify(validated, null, 2))
  renameSync(tmp, target)

  return { ok: true, path: target, commandCount: commands.length }
}
```

Failure handling: a failed generation logs a warning and does **not** fail the source build. The user's existing `commands.json` (or the bundled snapshot) keeps working.

The same function is called lazily on first `get-commands` access for a build that has no `generated.json`. The lazy call is awaited synchronously from the IPC handler (the user sees a brief loading state); the result is cached so subsequent calls are fast.

## Trigger Integration

### Source-build (primary)

Modify `update-backend-source` at `ipc.ts:2287-2296`:

```typescript
const backends = listBackendsFromDirectory(repoDir)
const nextBackend = backends.find(...) || backends[0]
if (!nextBackend) { /* existing error path */ }

event.sender.send('download-progress', { percent: 95, phase: 'generating-schema' })
const genResult = await generateCommandsSchemaForBuild(nextBackend)
if (!genResult.ok) {
  console.warn('[commands-schema-gen]', genResult.error)
  // Continue — don't fail the build
}

event.sender.send('download-progress', { percent: 100, phase: 'done' })
resolve({ success: true, result: buildBackendUpdateResult(nextBackend.name) })
```

### Lazy first access (secondary)

Modify `get-commands` at `ipc.ts:1911` to detect a missing per-build `generated.json` and trigger generation in-process before falling back to the shipped snapshot.

## Migration (one-time)

The existing `resources/commands.json` (212 entries, full schema) is split via a one-time script `scripts/migrate-commands-overlay.ts` (not shipped, run during development):

1. Load the existing file.
2. Extract the curated subset for each arg: `label`, `category` (from parent category), `icon` (from parent category), `placeholder`, `min`, `max`.
3. Build the `args` map.
4. Build the `sectionMap` from the bundled's category groupings:
   - `common params` → `Performance` / `Cpu`
   - `sampling params` → `Sampling` / `Sliders`
   - `speculative params` → `Speculative Decoding` / `GitBranch`
   - `example-specific params` → `Server` / `Server`
5. Write `resources/commands/overlay.json`.
6. Run the parser against the b9202 help output (already captured) to produce `resources/commands/b9202.json` (the shipped snapshot).
7. Delete `resources/commands.json` after both files exist and `ipc.ts:1916` no longer references it.

The existing 212 entries that no longer exist in b9202 (`--system-prompt`, deprecated drafts, etc.) are dropped from the overlay — they were tied to flags the build no longer accepts. If a flag's canonical name changed (e.g. `--gpu-layers` → `--n-gpu-layers`), the script records the curated fields under BOTH the old and new arg names in the overlay, so the merge can find them either way.

## Failure Handling

| Scenario | Behavior |
|----------|----------|
| `llama-server --help` exits non-zero | Log warning, skip generation, keep existing `commands.json` |
| `llama-server --help` times out (>10s) | Kill the process, log warning, skip generation |
| Parser produces 0 commands | Log warning, skip generation |
| Zod validation fails on the parsed output | Log the validation error, skip generation |
| `generated.json` exists but is malformed | Treat as missing, fall back to shipped snapshot, regenerate in background |
| Overlay is malformed | Throw on app startup — overlay is bundled and must be valid |
| User override is malformed | Log warning, ignore that file, use base resolution |
| Build directory doesn't exist (user deleted the build) | `get-commands` returns `{ version, categories: [] }` and logs a warning |

## Testing

The parser and merger are pure functions and unit-testable. Tests live in `src/main/__tests__/commandsSchema*.test.ts` (using the project's existing test framework).

### Parser tests (against captured b9202 help output)

- 241 commands parse without failure
- Spot-checks for: `--ctx-size` (number, default 0, env), `--flash-attn` (select, options=[on,off,auto]), `--hf-repo` (string, placeholder `<user>/<model>[:quant]`), `--n-gpu-layers` (canonical), `--repack` (boolean, default enabled), `--no-perf` (negation recorded, not separate arg), `--fim-qwen-1.5b-default` (boolean, dot in name)
- All deprecated flags have `deprecated: true` and a note
- All 4 sections are recognized
- Default extraction: `(default: 0, 0 = loaded from model)` → default=0, description cleaned
- Description stripping: no `(default: …)` text in any description

### Merge tests

- 178/212 existing curated entries are preserved exactly (label, category, placeholder, min, max)
- 34 stale entries are dropped (deprecated + renamed)
- 63 new entries appear with auto-derived labels
- User override for `--gpu-layers` applies to merged `--n-gpu-layers` via alias resolution
- Caching: same inputs return same output; changes to mtimes invalidate the cache

### Integration tests

- Spawning a fake `llama-server.exe` (a Windows .exe that prints the captured help text) works
- Generation on a missing binary returns `{ ok: false }` without throwing
- Atomic write: a crash mid-write leaves no `generated.json` (the `.tmp` file is orphaned and the next run overwrites it)

### Manual smoke test

- Run the source-build flow against a local repo, confirm a new `b####/generated.json` appears, the CommandsEditor opens, and FEATURED_ARGS (`--ctx-size`, `--gpu-layers`, `--threads`, `--batch-size`, `--flash-attn`) render with correct types and values.

## Out of Scope

- Generating flags' min/max from C++ source (would require parsing the llama.cpp source tree).
- Reverse-mapping deprecated arg names to their replacements (handled by alias resolution in the merge, not by the parser).
- Auto-updating the overlay when upstream changes category groupings.
- A "regenerate now" button in the UI (deferred; the lazy first-access path covers the common case).
- Parsing the help output of other llama.cpp binaries (`llama-cli`, `llama-embedding`, etc.).
- Multi-language help output (only English is parsed).
- Hot-reload of the overlay at runtime (the app must be restarted to pick up overlay changes).

## Open Questions

None at design time. The three decisions surfaced during the dry-run prototype are resolved as documented above:

1. **Arg selection rule**: last positive long wins.
2. **Alias resolution for user overrides**: implemented in the merger.
3. **Section-to-category mapping**: shipped in the overlay, not hardcoded in the generator.
