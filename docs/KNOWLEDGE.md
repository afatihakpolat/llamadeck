# Knowledge

Durable lessons, toolchain traps, and non-obvious root causes. Add only facts that will matter to future sessions.

## Toolchain Traps

- **`gh` CLI targets the wrong remote in this repo.** This checkout has two GitHub remotes: `origin` = `afatihakpolat/llamadeck` (the release repo) and `upstream` = `andersondanieln/hexllama`. `gh` commands (`gh run list`, `gh release list`, `gh run watch`) default to `upstream`, so they silently report stale/foreign runs and releases. Always pass `--repo afatihakpolat/llamadeck` (or `-R afatihakpolat/llamadeck`) for repo-targeted `gh` operations, and prefer `git ls-remote origin <ref>` to confirm what actually landed on the release repo.
- **`docs` markdown files have mixed/CRLF line endings.** Multi-line `edit`-tool matches against `docs/HANDOFF.md` can fail with "oldString not found" even when the text looks identical, because the file mixes CRLF and lone-LF line endings. Verify with a byte/char dump (`[System.IO.File]::ReadAllText` + hex) before assuming the text differs; for surgical fixes, replace at the byte level from PowerShell.
