# PowerShell CLI

## Goal

Expose a scriptable Windows command surface for inspecting and controlling the same templates and managed model processes used by the Electron UI.

## Command surface

```text
llamadeck capabilities
llamadeck template get [<id-or-name>]
llamadeck template list
llamadeck template create <--file <path>|--json <json>>
llamadeck template update <id-or-name> <--file <path>|--json <json>>
llamadeck template delete <id-or-name> --yes
llamadeck template validate <id-or-name>
llamadeck template validate <--file <path>|--json <json>>
llamadeck template start <id-or-name>
llamadeck template stop <id-or-name>
llamadeck template logs <id-or-name> [--tail <count>] [--follow]
llamadeck template wait <id-or-name> --ready [--timeout <seconds>]
llamadeck backend list
llamadeck backend use <name-or-display-name>
llamadeck status
llamadeck app show
llamadeck --version
```

`template get` without a selector returns all templates. Selectors prefer an exact ID, then a case-insensitive exact name. Duplicate names must be disambiguated with an ID. Successful commands return JSON on stdout; errors go to stderr with a non-zero exit code.

Template create/update documents are strict JSON. Create accepts `name` plus optional `id`, `description`, `backendVersion`, `modelPath`, `serverPort`, `args`, `launchMode`, and `pricing`. Update accepts the same mutable fields without `id`; optional values can be cleared with `null`. `--file -` reads the document from stdin. Writes are atomic, and create/update/delete broadcasts cause an open GUI to refresh its cards.

`template validate` checks the JSON shape, model resolution, backend resolution, public-port conflicts, and known backend argument types/ranges/options. It always prints a structured validation result and exits 2 when `valid` is false. It does not mutate state.

Model output is retained in a bounded, in-memory main-process buffer. `template logs` returns buffered events plus a cursor; `--follow` polls the cursor and emits newline-delimited JSON until the process stops or the user cancels. Logs are not written to disk. `template wait --ready` polls the managed proxy's loopback `/health` endpoint until it returns a 2xx response, the model stops, or the timeout expires.

`backend list` identifies the active backend. `backend use` persists the global active backend and refreshes the open GUI; templates pinned to a specific backend continue to take precedence.

`capabilities` and `--help --json` expose the installed app version, protocol version, output contracts, exit codes, command usage, and template-document fields for agent discovery.

## Architecture

The Electron main process owns all template and runtime operations. On startup it creates a Windows named-pipe server and atomically writes `cli-endpoint.json` under the resolved LlamaDeck user-data directory. The descriptor contains the pipe ID, protocol version, process ID, and a new random authentication token for that app launch.

The packaged `llamadeck.cmd` invokes a PowerShell client that:

1. Finds the current or legacy LlamaDeck user-data descriptor.
2. Starts the installed app and waits for its descriptor when necessary.
3. Sends one size-limited, Zod-validated JSON request over the named pipe.
4. Prints only the response payload as JSON.

No CLI TCP port is opened. The random token prevents a stale or guessed pipe name from being sufficient to issue commands. The descriptor is removed during normal shutdown and overwritten atomically on the next launch. Template documents are separately parsed and validated with strict Zod schemas before mutation.

## Launch consistency

The template argument builder is shared between renderer and main process, including default-true boolean negation, custom flags, port fallback, and API-only `--no-webui`. The selected active backend is persisted under main-process user data; templates pinned to a backend still take precedence.

## Packaging

`electron-builder` copies the PowerShell client and command shim into `resources/cli`. The NSIS custom install/uninstall macros add or remove that directory from the current user's `PATH`. Portable zip users invoke the shim directly or add the folder themselves.
