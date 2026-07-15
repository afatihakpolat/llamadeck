# Smooth Update Path Requirements

## Problem Statement
When LlamaDeck updates via the existing NSIS installer, Windows invalidates the user's pinned taskbar icon and Start-menu shortcuts. The user has to re-pin the app after every update. The `docs/HANDOFF.md` rename caveat (`CHANGELOG.md` 1.1.5 era) already flags this: the installer identity, taskbar pins, and shortcuts still move to the new install rather than migrating in place.

## Goal
Make app updates seamless for Windows users:

1. Update checks happen inside the running app.
2. Updates download in the background.
3. Updates install into the same install directory as the current version, preserving the Windows taskbar pin and Start-menu shortcut.
4. The user restarts at their convenience; no browser, no double-click, no repin.

## Non-Goals
- Auto-migrating the install path of existing users (current user accepts one-time repin).
- Code signing or publisher-name changes (out of scope for this feature).
- MSIX/AppX packaging (much larger architectural change; deferred).
- Linux/macOS update flow (Windows-only feature; cross-platform Electron-updater is wired but Windows is the supported target).
- Adding delta updates or differential patching.

## Actors
- Windows desktop user with LlamaDeck pinned to the taskbar.
- Windows desktop user who launches LlamaDeck from a Start-menu shortcut.

## Use Cases
- A user keeps the app pinned to the taskbar and wants the pin to survive every update.
- A user runs LlamaDeck and wants to be notified when a new release is available without checking the GitHub releases page.
- A user wants to defer the restart until they finish their current session.
- A user wants the update to happen silently and only prompt at the end.

## Functional Requirements
- The app must check for new releases on launch and on a user-triggered "Check for updates" action.
- The app must surface the available release (version, release notes, optional download progress) in the UI without forcing a restart.
- The user must be able to choose **Download and install** or **Skip this version**.
- Once downloaded, the app must install the update in the background and prompt the user to restart at their convenience.
- The install must write into the same `%LOCALAPPDATA%\Programs\llamadeck` directory so the existing taskbar pin and shortcut continue to point at the new binary.
- The Settings page must expose:
  - Current version vs. latest version.
  - A "Check for updates" button.
  - A "Download update" / "Restart to install" button gated on download state.
  - The download progress as a percentage while in progress.
  - Release notes (markdown) for the latest available release.
- Release checks must not block the UI; failures must show a non-modal message and a manual retry path.
- Auto-update behavior must be controllable from Settings:
  - "Check on launch" toggle (default: on).
  - "Auto-download" toggle (default: off — explicit user confirmation required).
- The renderer must not perform file I/O; all update IPC flows through the main process.

## Non-Functional Requirements
- Update checks must time out within 10 seconds and fail gracefully.
- The main process must persist the "last seen release tag" and "skip version" choice in `app.getPath('userData')` so it survives restart.
- The update download must not interfere with llama.cpp server runs, model downloads, or LiteLLM proxy operations.
- The implementation must not break existing packaged builds that are still installed in custom paths (they continue to receive updates through the NSIS flow until reinstalled; new installs use the locked path).
- All update state changes must broadcast to the renderer through existing IPC broadcast patterns.

## Constraints
- `electron-updater` is already a declared dependency but unused; reuse it rather than introducing a new update library.
- The NSIS install path must be locked (`allowToChangeInstallationDirectory: false`) so Windows can match the exe identity between updates.
- The existing `app.setAppUserModelId('com.llamadeck.app')` call in `src/main/index.ts` must remain the single source of truth for the AUMID.
- Existing source-build update flow (Check Now / Build From Source for llama.cpp backends) must remain unchanged. This feature addresses the **Electron app itself** updating, not llama.cpp backends.
- Updates must not run while a source build, model download, or template launch is active.

## Acceptance Criteria
- A user with the app pinned to the taskbar who updates to a newer version keeps the same pinned icon and does not need to repin.
- A user can open Settings, see "Update available: v1.2.0", click "Download", watch the progress bar fill, and see "Restart to install" appear when the download completes.
- Clicking "Restart to install" quits the app, applies the update, and relaunches into the new version.
- Turning off "Check on launch" stops automatic release checks but leaves manual checking available.
- The NSIS installer no longer offers a path picker on new installs.
- `npm run build`, `npm run package`, and `npm run test:run` all pass.
- A code-signed installer update from v1.1.5 to v1.2.0 preserves the existing taskbar pin and Start-menu shortcut on a real Windows install.

## Assumptions
- Existing users accept a one-time repin on the next manual reinstall; this feature does not retroactively migrate their install path.
- The `electron-updater` GitHub provider configuration is sufficient; a custom update server is not needed.
- The user publishes releases as GitHub Releases (existing CI workflow already does this per `AGENTS.md`).
- The app is published under stable `appId: com.llamadeck.app` and a stable productName `LlamaDeck`.