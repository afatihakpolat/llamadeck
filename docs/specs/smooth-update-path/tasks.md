# Smooth Update Path Tasks

Status legend: `TODO` (not started) · `IN_PROGRESS` (active) · `DONE` (complete) · `BLOCKED` (waiting on something)

## Phase 1: Schema and types

- [TODO] **T1.1** — Add `src/shared/update.ts` with `UpdateStatus`, `UpdateInfo`, `UpdateProgress`, `UpdateState`, `UpdatePreferences` types and matching Zod schemas.
- [TODO] **T1.2** — Add `src/shared/__tests__/update.test.ts` with schema-validation tests for valid and malformed preference payloads.

## Phase 2: Settings persistence

- [TODO] **T2.1** — Create `src/main/updateSettings.ts` exporting `loadUpdateSettings()`, `saveUpdateSettings(prefs)`, and `defaultUpdatePreferences()`. Use atomic write pattern (writeFileSync tmp + renameSync) per repo convention. Resolve path via `join(app.getPath('userData'), 'update-settings.json')`.
- [TODO] **T2.2** — Add `src/main/__tests__/updateSettings.test.ts`: defaults-on-missing-file, atomic write behavior, Zod rejection on invalid input, mkdir-recursive for parent dirs.

## Phase 3: Update manager (main process)

- [TODO] **T3.0** — Extract `hasActiveTransfers()` from `src/main/ipc.ts:2208` into a new shared module `src/main/activeWork.ts`. The existing helper closes over module-level state (`sourceUpdateJob`, `cancelBackendDl`, `downloadTasks`); move those state containers into the new module so both `updateManager` and the existing IPC handler can call a single `hasActiveWork()` function. Update the IPC handler's existing call site at `src/main/ipc.ts:2209` to use the extracted helper. Add `src/main/__tests__/activeWork.test.ts` covering: source update in progress, backend download in progress, model download active, and the no-active-work baseline.
- [TODO] **T3.1** — Create `src/main/updateManager.ts` exporting `initUpdateManager()`, `getUpdateState()`, `checkForUpdates()`, `downloadUpdate()`, `quitAndInstall()`, `setPreferences()`. Wrap `electron-updater` events into an internal `UpdateState` and broadcast via `broadcastToRenderer('update:state-changed', state)` (matches existing pattern at `src/main/ipc.ts:1368`).
- [TODO] **T3.2** — Wire `electron-updater` to use the GitHub provider via the `publish` block in `electron-builder.yml` (Phase 5). Disable auto-download-on-launch; `checkForUpdates()` only checks.
- [TODO] **T3.3** — Implement skip-version logic: if `available.version === preferences.skippedVersion`, treat as `not-available` without broadcasting `available`.
- [TODO] **T3.4** — Implement active-work guard: before `checkForUpdates()` and `downloadUpdate()`, import and call `hasActiveWork()` from `src/main/activeWork.ts` and reject with a structured error if true.
- [TODO] **T3.5** — Add `src/main/__tests__/updateManager.test.ts` with mocked `electron-updater`: state transitions per event, skip-version behavior, active-work blocking (using the extracted `activeWork` module), preference application.

## Phase 4: IPC and preload

- [TODO] **T4.1** — In `src/main/ipc.ts`, register five new handlers: `update:get-state`, `update:check`, `update:download`, `update:install-and-restart`, `update:set-preferences`. Each delegates to `updateManager`. Follow existing handler conventions (Zod validation at the IPC boundary per repo convention).
- [TODO] **T4.2** — In `src/preload/index.ts`, expose `window.api.update.{getState, check, download, installAndRestart, setPreferences, onStateChanged}` matching the design in `design.md`. Reuse existing `getAppVersion` (preload line 65).

## Phase 5: Build configuration

- [TODO] **T5.1** — In `electron-builder.yml`, set `nsis.allowToChangeInstallationDirectory: false` and add the `publish` block (provider: github, owner `afatihakpolat`, repo `llamadeck` per `https://github.com/afatihakpolat/llamadeck`). Verify with `npm run package` on a clean clone that the NSIS dialog no longer shows the path picker.

## Phase 6: Main process bootstrap

- [TODO] **T6.1** — In `src/main/index.ts`, after `electronApp.setAppUserModelId('com.llamadeck.app')` (line 139) and before `BrowserWindow` creation, call `initUpdateManager()`.
- [TODO] **T6.2** — After init, if `preferences.checkOnLaunch` is true, schedule a non-blocking `checkForUpdates()` (use `setImmediate` or `setTimeout(0)` so window creation is not delayed).

## Phase 7: Renderer state

- [TODO] **T7.1** — Add an `update` slice to `src/renderer/src/store/useStore.ts` with `state`, `preferences`, and actions `setUpdateState`, `setUpdatePreferences`, `check`, `download`, `installAndRestart`. Subscribe to `window.api.update.onStateChanged` on app mount and dispatch `setUpdateState`.
- [TODO] **T7.2** — Add `src/renderer/src/__tests__/updateStore.test.ts` with slice tests for state transitions and preference persistence.

## Phase 8: Renderer UI

- [TODO] **T8.1** — Create `src/renderer/src/components/UpdateSettings.tsx`. Pure presentation. Renders current version, latest version (when known), "Check for updates" button, "Download" / "Restart to install" button (gated on state), progress bar (when `downloading`), release notes (when `available`), error message (when `error`), and the "Check on launch" / "Auto-download" toggles.
- [TODO] **T8.2** — In `src/renderer/src/components/SettingsView.tsx`, add an **Updates** section that mounts `UpdateSettings`. Match the existing layout (cards, section headers) of Settings.
- [TODO] **T8.3** — In `src/renderer/src/styles/global.css`, add `.update-settings` and `.update-progress` styles. Reuse existing tokens (no new colors). Reuse the `.update-banner` button look for consistency.

## Phase 9: Documentation

- [TODO] **T9.1** — Update `docs/HANDOFF.md`:
  - Add to **Completed**: each shipped item from phases above.
  - Add to **Verification**: `npm run build`, `npm run package`, `npm run test:run` outputs.
  - Add a **Next Recommended Check** entry: manual smoke test for the in-app update flow on a packaged build, plus a regression check that the existing source-build (llama.cpp) update flow still works.
  - Remove the rename caveat from line 107 (no longer accurate once `allowToChangeInstallationDirectory: false` ships and electron-updater is wired).
- [TODO] **T9.2** — Update `CHANGELOG.md` `[Unreleased]` section with the new feature, naming `electron-updater`, the locked install path, and the user-visible behavior.
- [TODO] **T9.3** — Update `AGENTS.md` Known Patterns section: add an entry documenting that in-app updates use `electron-updater` against the GitHub publish block in `electron-builder.yml`, and that the NSIS path is now locked.

## Phase 10: Verification

Order matters within this phase: T10.6 (release workflow compatibility) must run before T10.4 (full taskbar-pin smoke test) because T10.4 assumes a release is available.

- [TODO] **T10.1** — `npm run test:run` — all tests pass, including the new ones.
- [TODO] **T10.2** — `npm run build` — clean build, no TypeScript errors.
- [TODO] **T10.3** — `npm run package` — produces NSIS installer and zip; verify the NSIS dialog no longer shows the path picker.
- [TODO] **T10.5** — Regression: confirm the existing llama.cpp source-build "Check Now" / "Build From Source" flow still works end-to-end.
- [TODO] **T10.6** — Release workflow compatibility check. The existing `.github/workflows/build.yml` already creates GitHub Releases with the Windows artifacts attached (`softprops/action-gh-release@v2`, uploads `dist/*.exe` and `dist/*.zip`). Verify the workflow produces a release that `electron-updater` can consume end-to-end:
  1. Trigger a manual `workflow_dispatch` run on the branch containing this feature.
  2. Wait for the `create-release` and `build` jobs to complete.
  3. Confirm the produced release at `https://github.com/afatihakpolat/llamadeck/releases/tag/<new-tag>` has:
     - The new tag is published (not draft).
     - At least one `LlamaDeck-Setup-<version>.exe` (NSIS installer) attached.
     - `generate_release_notes: true` populated the body (or the body has meaningful content).
  4. From a clean test machine (or VM), install the previously-shipped packaged build (e.g. v1.1.5 from the prior release).
  5. Launch the installed build, open Settings → Updates, confirm it detects the new release.
  6. Confirm the auto-detected version matches the tag.
  7. If any step fails, capture the failure mode and add a fix-up task before T10.4.
- [TODO] **T10.4** — Manual smoke test on a real Windows install (run after T10.6 succeeds):
  1. Install v1.1.5 manually via NSIS, pin to taskbar.
  2. Confirm T10.6 has produced a release for the new version.
  3. Launch v1.1.5, open Settings → Updates, confirm "Update available: v1.2.0".
  4. Click Download, watch progress, click Restart to install.
  5. Confirm app relaunches into v1.2.0 and the taskbar pin survives.
  6. Verify Start-menu shortcut still works.

## Out of scope (deferred)
- Auto-migration of existing installs to the new path.
- MSIX/AppX packaging.
- Code signing integration.
- Linux/macOS update flow.

## Review notes (this doc)
- T3.0 added: extract `hasActiveTransfers()` to `src/main/activeWork.ts` so both `updateManager` and the existing IPC handler call site share a single `hasActiveWork()` function.
- T3.4 was originally written against a helper called `hasActiveWork()`; corrected to `hasActiveTransfers()` (at `src/main/ipc.ts:2208`) and flagged as needing either reuse or extraction. Decision: extract (T3.0).
- T5.1 publish-block owner is now `afatihakpolat/llamadeck` (confirmed by user). Note: the local checkout folder is still named `hexllama` but the GitHub repo is `llamadeck`.
- T7.1 was written assuming `src/renderer/src/store/index.ts`; corrected to `useStore.ts` (the actual existing file).
- T10.6 added to verify the existing release workflow at `.github/workflows/build.yml` is compatible with `electron-updater` end-to-end before T10.4.
- See `docs/superpowers/specs/smooth-update-path/design.md` for design-level corrections (line-number fixes, naming-conflict note for `checkUpdates`).