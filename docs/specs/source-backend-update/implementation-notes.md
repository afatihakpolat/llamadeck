# Source Backend Update Implementation Notes

- The configured backend folder is assumed to be the llama.cpp repo root for source updates.
- Installed backend folders can coexist under that repo root because backend discovery already filters to directories containing runnable executables.
- The source-build helper script is written at runtime into Electron `userData` because the packaged app currently only includes built `out/*` assets.
- Update checks use the latest upstream `b####` git tag, and source builds now target that exact tag instead of an arbitrary branch head.
- The build result is labeled from the checked-out tag and exposed through the existing backend display-name path.
- Post-build template migration only rewrites templates that were already pinned to a specific backend version; unpinned templates continue following the active backend implicitly.
- Cancelled source updates emit cancelled progress and return a non-error cancelled result so the renderer can stop quietly without showing a failure alert.
- After a successful source build, the main process runs `generateCommandsSchema` against the newly built backend at progress 95 (`generating-schema`), writes `<backend>/generated.json`, and then jumps to 100 (`done`). Generation failures are logged but do not fail the build — the build itself is the source of truth.
