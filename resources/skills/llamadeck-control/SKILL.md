---
name: llamadeck-control
description: Control and automate local llama.cpp models and the managed LiteLLM proxy through the installed LlamaDeck CLI. Use when an agent needs to manage LlamaDeck templates or backends; start, stop, or wait for model servers; inspect or follow logs; install, update, configure, start, stop, test, or inspect LiteLLM; coordinate CLI changes with the LlamaDeck GUI; or teach another agent a reliable LlamaDeck workflow.
---

# LlamaDeck Control

Operate LlamaDeck through its public `llamadeck` command. Treat the CLI and GUI as two controls for the same app state.

## Establish the command

1. Prefer `llamadeck` from `PATH`.
2. If unavailable on Windows, check `%LOCALAPPDATA%\Programs\llamadeck\resources\cli\llamadeck.cmd`.
3. In a LlamaDeck source checkout, use `resources\cli\llamadeck.cmd` only when it exists.
4. If none is available, explain that LlamaDeck must be installed or packaged; do not edit template files or construct named-pipe requests directly.

Open a new PowerShell process after installation when the command was newly added to `PATH`.

## Discover before acting

Run `llamadeck capabilities | ConvertFrom-Json` before relying on a command. Use only commands reported by that installation.

LiteLLM CLI control requires LlamaDeck 1.4.0 or newer. If the capabilities result does not report `litellm.status`, ask the user to update LlamaDeck instead of constructing an unsupported request.

Resolve templates with `llamadeck template get | ConvertFrom-Json`. Use the exact template `id` for every later automated command. Names are only a convenience for human input and may be ambiguous.

Use `llamadeck status | ConvertFrom-Json` to determine whether a template is already running before starting or stopping it.

## Run a template safely

1. Resolve and retain the template ID.
2. Run `llamadeck template validate <id>`.
3. Parse the JSON result even when the process exits with code 2. Do not start when `valid` is false unless the user explicitly wants to proceed despite the reported errors.
4. Start with `llamadeck template start <id> | ConvertFrom-Json` when it is not already running.
5. Wait with `llamadeck template wait <id> --ready --timeout <seconds> | ConvertFrom-Json`.
6. Report the returned endpoint and backend.

Do not start a duplicate instance of the same template. Different templates may run concurrently when their public ports do not conflict.

## Inspect and follow output

Use `llamadeck template logs <id> --tail <count> | ConvertFrom-Json` for a bounded snapshot.

Use `llamadeck template logs <id> --tail <count> --follow` only for a live-monitoring request. Follow mode emits one compact JSON event per line and continues until the model stops or the command is cancelled. Treat it as NDJSON, not one JSON array.

Logs are in memory and cover the current or most recent run; do not expect them to survive an app restart.

## Mutate templates deliberately

Prefer `--file <path>` over inline `--json` to avoid PowerShell quoting errors.

- Create documents require `name`; other fields are optional.
- Update documents are partial patches and cannot change `id`.
- Supplying `args` in an update replaces the complete argument map.
- Set `description`, `backendVersion`, `modelPath`, or `pricing` to `null` to clear it.
- Validate a document before creating or updating when practical.
- Require clear user intent before deletion. Pass `--yes` only after that intent is established.
- Stop a running template before deleting it.

CLI mutations automatically refresh an open GUI. Do not separately patch LlamaDeck's on-disk template JSON.

## Select backends carefully

Use `llamadeck backend list | ConvertFrom-Json` to inspect installed and active backends.

Run `llamadeck backend use <name> | ConvertFrom-Json` only when the user asks to change the global default or the task requires it. This changes the active backend for unpinned templates and the GUI; a template with `backendVersion` remains pinned.

## Control managed LiteLLM safely

Run `llamadeck litellm status | ConvertFrom-Json` before lifecycle changes. Reuse a running proxy when possible. Use `start`, `stop`, or `restart` only when the requested outcome requires it.

Do not run `litellm install` or `litellm update` unless the user requested provisioning or the authorized task explicitly requires it. These commands modify the detected system Python environment.

For config work:

1. Treat `litellm config get` as a redacted inspection copy, not a round-trip export.
2. Keep the intended YAML in a separate file.
3. Run `llamadeck litellm config validate --file <path>` and parse its JSON even when it exits 2.
4. Run `llamadeck litellm config set --file <path>` only when validation is successful.
5. If the result reports `restartRequired: true`, restart only when interruption is in scope; otherwise report the pending restart.

Use `litellm test` to verify the loopback proxy and `litellm models` to discover configured model IDs. Use `litellm logs --tail <count>` for diagnosis and add `--follow` only for live monitoring.

The CLI always redacts API keys and secret-like config values. Never attempt to recover, infer, or print the redacted values.

## Handle results and failures

Parse standard stdout as one JSON value. Keep stderr as diagnostic text.

Interpret exit codes as:

- `0`: success
- `1`: operation or transport failure
- `2`: invalid input or a validation result with `valid: false`
- `3`: not found
- `4`: ambiguous selector; retry with an ID
- `5`: conflict, including not running, already running, deletion conflict, or readiness timeout
- `64`: CLI usage error

If the CLI starts LlamaDeck automatically, allow its startup timeout to complete. Do not start extra Electron instances manually.

Read [references/cli.md](references/cli.md) for document fields, complete command syntax, and reusable agent examples when creating or updating templates, managing LiteLLM, following logs, switching backends, or troubleshooting.
