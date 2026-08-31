# Knowledge

Durable lessons, toolchain traps, and non-obvious root causes. Add only facts that will matter to future sessions.

## Toolchain Traps

- **This checkout is decoupled from the original `andersondanieln/hexllama` repo (2026-08-23).** The `upstream` remote was intentionally removed; `origin` = `afatihakpolat/llamadeck` is the only remote, and `gh` commands (`gh run list`, `gh release list`, `gh run watch`) now resolve to it without flags. Do not re-add an `upstream` remote — with two remotes present, `gh` silently targeted the foreign one and reported stale runs/releases (a repo-local `.config/gh/config.yml` did not override the git inference on gh 2.89, so a single remote is the only reliable fix).
- **`docs` markdown files have mixed/CRLF line endings.** Multi-line `edit`-tool matches against `docs/HANDOFF.md` can fail with "oldString not found" even when the text looks identical, because the file mixes CRLF and lone-LF line endings. Verify with a byte/char dump (`[System.IO.File]::ReadAllText` + hex) before assuming the text differs; for surgical fixes, replace at the byte level from PowerShell.

## Runtime Concurrency and Responsiveness

- **Never run recurring child-process or network checks synchronously in Electron's main process.** LiteLLM status polling previously used `execFileSync` for Python and `pip show`, while startup update checks used synchronous git commands; either could stall window event handling. Use asynchronous commands with bounded timeouts, cache slow status, and deduplicate concurrent refreshes.
- **A child process's late `error` or `exit` event must only clean up the same process instance still registered for that template.** An immediate stop-then-start can otherwise let the old process delete the new process from `runningProcesses`, close its proxy, finalize its usage session, and send a stale idle state. Guard cleanup by process identity, serialize stopping with a dedicated state set, and include the PID in exit events so the renderer can reject stale events too.
