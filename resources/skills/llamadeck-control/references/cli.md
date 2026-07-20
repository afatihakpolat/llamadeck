# LlamaDeck CLI Reference

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
llamadeck litellm status
llamadeck litellm start
llamadeck litellm stop
llamadeck litellm restart
llamadeck litellm install
llamadeck litellm update
llamadeck litellm test
llamadeck litellm models
llamadeck litellm logs [--tail <count>] [--follow]
llamadeck litellm config get
llamadeck litellm config validate --file <path>
llamadeck litellm config set --file <path>
llamadeck status
llamadeck app show
llamadeck --version
```

`template get` without a selector is equivalent to `template list`. Resolution prefers an exact ID, then a case-insensitive exact name. Duplicate names require an ID.

## Template documents

A create document accepts:

```json
{
  "id": "optional-stable-id",
  "name": "Required display name",
  "description": "Optional description",
  "backendVersion": "optional-pinned-backend",
  "modelPath": "C:\\models\\model.gguf",
  "serverPort": 8080,
  "args": {
    "--ctx-size": 8192,
    "--flash-attn": "auto"
  },
  "launchMode": "api",
  "pricing": {
    "inputCostPerMillion": 0,
    "cacheCostPerMillion": 0,
    "outputCostPerMillion": 0
  }
}
```

Rules:

- `name` is the only required create field.
- `serverPort` defaults to `8080` and must be from 1 through 65535.
- `launchMode` defaults to `chat` and accepts `chat` or `api`.
- Argument values accept strings, finite numbers, booleans, or null.
- An explicit ID may contain letters, numbers, periods, underscores, and hyphens, must start with a letter or number, and must be at most 128 characters.
- Create documents reject unknown fields.
- Update documents accept only mutable fields and reject `id`, timestamps, and unknown fields.
- Update `args` replaces the whole map rather than merging individual keys.

Use a partial update document such as:

```json
{
  "serverPort": 8090,
  "description": null
}
```

## Validation

Validation checks:

- JSON structure and field constraints
- Model-file resolution
- Backend resolution
- Conflicts with ports used by running templates
- Known backend argument types, ranges, and options
- Deprecated or unknown arguments as warnings

Example:

```powershell
$raw = llamadeck template validate $templateId
$exitCode = $LASTEXITCODE
$validation = $raw | ConvertFrom-Json

if (-not $validation.valid) {
  $validation.errors
}
```

Exit code 2 is expected for a well-formed validation response whose `valid` property is false.

## Start, wait, use, stop

```powershell
$templates = llamadeck template get | ConvertFrom-Json
$template = $templates | Where-Object id -eq 'my-template-id'

$validationRaw = llamadeck template validate $template.id
$validation = $validationRaw | ConvertFrom-Json
if (-not $validation.valid) {
  throw ($validation.errors -join '; ')
}

$started = llamadeck template start $template.id | ConvertFrom-Json
$ready = llamadeck template wait $template.id --ready --timeout 180 | ConvertFrom-Json

# Use $ready.url with an OpenAI-compatible client.

llamadeck template stop $template.id | ConvertFrom-Json
```

Check `llamadeck status` first and reuse an already-running endpoint rather than treating an already-running response as a reason to start another process.

## Logs

Snapshot result:

```json
{
  "id": "template-id",
  "name": "Template name",
  "events": [
    {
      "sequence": 1,
      "id": "template-id",
      "stream": "system",
      "text": "Process started.\n",
      "timestamp": "2026-07-20T00:00:00.000Z"
    }
  ],
  "nextCursor": 1,
  "hasMore": false,
  "running": true
}
```

`stream` is `stdout`, `stderr`, or `system`. Follow mode prints each event object as a separate line:

```powershell
llamadeck template logs $templateId --tail 100 --follow |
  ForEach-Object { $_ | ConvertFrom-Json }
```

## Backend behavior

`backend list` returns:

```json
{
  "active": "b1234",
  "backends": [
    {
      "name": "b1234",
      "displayName": "b1234 · CUDA",
      "flavor": "cuda",
      "buildMode": "parallel",
      "path": "C:\\backends\\b1234",
      "hasCommands": true,
      "exe": "bin\\llama-server.exe",
      "active": true
    }
  ]
}
```

Use the backend `name` for automation. Changing the active backend affects only templates without a pinned `backendVersion`.

## LiteLLM

Inspect the managed proxy before changing it:

```powershell
$status = llamadeck litellm status | ConvertFrom-Json
if (-not $status.running) {
  $status = llamadeck litellm start | ConvertFrom-Json
}

$test = llamadeck litellm test | ConvertFrom-Json
$models = llamadeck litellm models | ConvertFrom-Json
```

`status.settings.apiKeyConfigured` reports only whether a saved proxy key exists. No CLI result returns the key.

Validate and save config from a file:

```powershell
$raw = llamadeck litellm config validate --file .\litellm.yaml
$exitCode = $LASTEXITCODE
$validation = $raw | ConvertFrom-Json
if ($validation.valid) {
  $saved = llamadeck litellm config set --file .\litellm.yaml | ConvertFrom-Json
}
```

Invalid validation and set attempts return structured diagnostics and exit 2. Successful sets report `restartRequired`; do not assume the running process has reloaded the file.

`litellm config get` returns `{ path, text, redacted, valid, diagnostics }`. Sensitive YAML values are replaced with `<redacted>`, and invalid YAML text is withheld if it cannot be safely parsed. Never write that inspection text back as the active config.

LiteLLM log snapshots return `{ events, nextCursor, hasMore, running }`. Each event contains `sequence`, `timestamp`, and `text`. Follow mode emits each event as NDJSON:

```powershell
llamadeck litellm logs --tail 100 --follow |
  ForEach-Object { $_ | ConvertFrom-Json }
```

Install and update use the system Python environment detected by LlamaDeck. Treat them as explicit provisioning changes, not routine status checks.

## Transport behavior

The installed PowerShell client talks to the running Electron main process over an authenticated per-user named pipe. It starts LlamaDeck when no endpoint exists. The CLI does not open a control TCP port.

The model itself remains available on the template's configured public port after readiness succeeds.
