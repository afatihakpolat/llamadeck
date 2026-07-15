# Smooth Update Path Design

## Solution Summary
Wire `electron-updater` (already a declared dependency) into the main process, expose update state through a small IPC surface, render a Settings section that lets the user check, download, and install updates, and lock the NSIS installer to a fixed install path so the Windows taskbar pin survives reinstalls.

## Architecture Overview

```
+-----------------------------+         +-------------------------+
|  Renderer (Settings page)   |  IPC    |  Main process           |
|                             | <-----> |                         |
|  - Update section UI        |         |  - updateManager.ts     |
|  - state from store         |         |    (new)                |
+-----------------------------+         |  - electron-updater     |
                                        |  - app.setAppUserModelId|
                                        +-------------------------+
                                                  |
                                                  v
                                        +-------------------------+
                                        |  GitHub Releases        |
                                        |  (existing CI publish)  |
                                        +-------------------------+
```

The update manager is a thin wrapper around `electron-updater` that:
1. Configures the GitHub provider.
2. Surfaces `checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, and `error` events.
3. Persists user preferences (`checkOnLaunch`, `autoDownload`, `skipVersion`) to `userData/update-settings.json`.
4. Exposes a single `update:state-changed` broadcast to the renderer.

The renderer reads the broadcast state through a Zustand store slice and renders the Settings UI.

## Affected Modules/Components

### New files
- `src/main/updateManager.ts` — Wraps `electron-updater`. Pure logic + side effects. Exports `initUpdateManager()`, `getUpdateState()`, `checkForUpdates()`, `downloadUpdate()`, `quitAndInstall()`, `setPreferences()`.
- `src/main/updateSettings.ts` — Pure functions for read/write of `userData/update-settings.json` with Zod validation.
- `src/main/__tests__/updateManager.test.ts` — Unit tests with mocked `electron-updater` surface.
- `src/main/__tests__/updateSettings.test.ts` — Unit tests for settings persistence.
- `src/shared/update.ts` — Shared types: `UpdateState`, `UpdatePreferences`, `UpdateStatus`.

### Modified files
- `electron-builder.yml` — Set `nsis.allowToChangeInstallationDirectory: false` and add `publish` block for GitHub provider.
- `src/main/index.ts` — Call `initUpdateManager()` after `setAppUserModelId`, before `BrowserWindow` creation. On launch, if `checkOnLaunch` is on, trigger a non-blocking check.
- `src/main/ipc.ts` — Add handlers: `update:get-state`, `update:check`, `update:download`, `update:install-and-restart`, `update:set-preferences`. Reuse the existing `broadcastToRenderer` helper at `src/main/ipc.ts:1368` for state-change events.
- `src/preload/index.ts` — Expose `window.api.update.*` methods. Existing `getAppVersion` at line 65 is reused as-is.
- `src/renderer/src/store/useStore.ts` — Add update slice to the Zustand store (this is the existing store file; the design assumed `index.ts` which does not exist).
- `src/renderer/src/components/SettingsView.tsx` — Add the **Updates** section.
- `src/renderer/src/components/UpdateSettings.tsx` (new) — Pure presentation component for the Updates section.
- `src/renderer/src/styles/global.css` — Add `.update-settings` styles consistent with the existing `.update-banner` look.
- `package.json` — No new runtime deps.

## Data Flow

### Check for update
1. User clicks "Check for updates" in Settings.
2. Renderer calls `window.api.update.check()`.
3. Main calls `updateManager.checkForUpdates()`.
4. `electron-updater` hits GitHub Releases API.
5. Events `checking-for-update` → `update-available` or `update-not-available` → broadcast to renderer.
6. Renderer re-renders with new state.

### Download update
1. User clicks "Download" in Settings (only enabled when `update-available` and not yet downloaded).
2. Renderer calls `window.api.update.download()`.
3. Main calls `updateManager.downloadUpdate()`.
4. `download-progress` events fire with `percent` and `bytesPerSecond`.
5. On `update-downloaded`, broadcast new state. Renderer shows "Restart to install".

### Install update
1. User clicks "Restart to install".
2. Renderer calls `window.api.update.installAndRestart()`.
3. Main calls `updateManager.quitAndInstall()`.
4. `electron-updater` writes the new files into the same `%LOCALAPPDATA%\Programs\llamadeck` directory.
5. App exits. User relaunches into the new version.
6. Windows taskbar pin and Start-menu shortcut continue to point at the same exe path.

## API/Interface Changes

### Shared types (`src/shared/update.ts`)
```typescript
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  available?: UpdateInfo
  progress?: UpdateProgress
  error?: string
  lastCheckedAt?: string
}

export interface UpdatePreferences {
  checkOnLaunch: boolean
  autoDownload: boolean
  skippedVersion?: string
}
```

### IPC handlers (added in `src/main/ipc.ts`)
| Channel | Direction | Payload | Result |
|---|---|---|---|
| `update:get-state` | renderer→main | none | `UpdateState` |
| `update:check` | renderer→main | none | `UpdateState` (after check completes; error-tolerant) |
| `update:download` | renderer→main | none | `void` (broadcast handles state) |
| `update:install-and-restart` | renderer→main | none | app exits |
| `update:set-preferences` | renderer→main | `UpdatePreferences` | `UpdatePreferences` |

### Preload (`window.api.update`)
```typescript
update: {
  getState(): Promise<UpdateState>
  check(): Promise<void>
  download(): Promise<void>
  installAndRestart(): Promise<void>
  setPreferences(prefs: UpdatePreferences): Promise<UpdatePreferences>
  onStateChanged(handler: (state: UpdateState) => void): () => void
}
```

## Storage/Schema Changes

### `userData/update-settings.json`
```json
{
  "checkOnLaunch": true,
  "autoDownload": false,
  "skippedVersion": "1.2.0"
}
```
- Validated by Zod schema (`UpdatePreferencesSchema`).
- Written atomically (`writeFileSync(tmp)` + `renameSync(tmp, target)`) per repo convention.
- Created on first launch with defaults if missing.

### `electron-builder.yml`
Add `publish` block pointing at `https://github.com/afatihakpolat/llamadeck` (confirmed by user).

```yaml
nsis:
  allowToChangeInstallationDirectory: false
  perMachine: false
  oneClick: false
publish:
  provider: github
  owner: afatihakpolat
  repo: llamadeck
```

## Dependencies
- `electron-updater` (already declared in `package.json`, unused in code).
- `electron-log` — used internally by `electron-updater`; already a transitive dep. No explicit install needed.

## Edge Cases

| Case | Behavior |
|---|---|
| User on Linux/macOS dev build | `electron-updater` is a no-op on dev (`!app.isPackaged`). Update UI shows "Updates are only available in packaged builds". |
| User skips a version | `skippedVersion` persisted. Future checks compare `available.version === skippedVersion` and skip the prompt, but the user can still manually check. |
| Update check while source build / model download active | Block the check (return error: "Updates are blocked while another operation is in progress"). Reuse the existing `hasActiveTransfers()` helper at `src/main/ipc.ts:2208` (this helper is local to the IPC handler registration block; if it stays local, the same logic is duplicated in `updateManager.ts` or extracted to a shared helper). |
| Download fails mid-progress | `error` event broadcasts. UI shows "Download failed" with retry button. State stays in `error` until next check or manual retry. |
| User changes "Check on launch" toggle | Settings persist immediately; next launch honors the new value. |
| Update available but user on latest already-installed version | `update-not-available` event; UI shows "You're on the latest version". |
| User installs a new version via NSIS manually (not in-app) | `electron-updater` will see the new version on next check, mark it `update-not-available`, and skip the prompt. No conflict. |
| Naming conflict with existing `checkUpdates` IPC | The existing `checkUpdates` handler at `src/main/ipc.ts:2215` is for **llama.cpp source builds**. The new `update:check` handler is correctly namespaced under `update:*` and does not collide. Renderer code must use `window.api.update.check()` for app updates and `window.api.checkUpdates()` for backend updates. |

## Failure Handling

| Failure | Behavior |
|---|---|
| Network timeout during check | 10-second timeout (configurable). `error` state. Retry button. |
| GitHub rate-limit | `error` state with descriptive message ("GitHub API rate limit exceeded"). |
| Download interrupted | `update-downloaded` only fires on success. Mid-download failure → `error` state with retry. |
| Install fails | `electron-updater` logs to `electron-log`. App continues running old version. Error surfaced via dialog. |
| Corrupt `update-settings.json` | Zod validation fails; defaults are used; file is rewritten with defaults. |

## Observability/Testing

### Tests
- `updateManager.test.ts` — Mocks `electron-updater`. Verifies:
  - State transitions for each event.
  - Preference application.
  - Skip-version logic.
  - Blocked-during-active-work behavior.
- `updateSettings.test.ts` — Verifies:
  - Defaults on missing file.
  - Atomic write.
  - Zod rejection on invalid input.

### Logging
- `updateManager` logs state transitions via `console.log` prefix `[update]`.
- `electron-updater` writes to `electron-log` (default: `%APPDATA%\hexllama\logs\main.log`).

## Alternatives Considered

### A. MSIX/AppX packaging
- **Pro**: Windows preserves pins across AppX updates by design.
- **Con**: Requires code signing with a publisher-subject cert, full AppX manifest, sandboxing considerations, and the entire installer pipeline changes. Much larger feature.
- **Decision**: Deferred.

### B. Custom update server
- **Pro**: No GitHub dependency.
- **Con**: Adds hosting costs, breaks the existing release flow.
- **Decision**: Rejected. GitHub Releases already work.

### C. Migrate existing users on first launch
- **Pro**: Even existing users keep their pin.
- **Con**: Moving `%LOCALAPPDATA%\Programs\llamadeck` while the app is running is risky; would need a one-shot helper. User opted to accept a one-time repin.
- **Decision**: Rejected per user choice.

## Risks and Tradeoffs

| Risk | Mitigation |
|---|---|
| `electron-updater` reads `app.getVersion()` from `package.json`. Forgetting to bump the version means no updates are detected. | Document in CHANGELOG conventions. Existing release process already handles this. |
| Without code signing, Windows SmartScreen will warn on the in-app updater download. | Note in CHANGELOG; signing is out of scope. |
| Auto-download toggled on could surprise users with bandwidth use. | Default off. Visible in Settings. |
| `electron-updater` is heavyweight (~hundreds of KB of node_modules). | Already a declared dep; no bundle-size impact on renderer. |
| `allowToChangeInstallationDirectory: false` blocks power users from choosing custom paths. | Power users can still edit `%LOCALAPPDATA%\Programs\llamadeck` directly. Document in CHANGELOG. |
| A misbehaving `electron-updater` could brick installs (writes a partial update, then can't launch). | Rollback: ship the next release via the existing GitHub release workflow. Users on a bad version can manually download the prior NSIS installer from GitHub Releases and reinstall. Code-sign the binaries as a follow-up to mitigate SmartScreen during manual recovery. |
| Active-work coordination: the update flow must not race with llama.cpp source builds, model downloads, or running models. | Extract `hasActiveTransfers()` from `src/main/ipc.ts:2208` to `src/main/activeWork.ts` so both `updateManager` and the existing IPC handler call site share a single `hasActiveWork()` function. See tasks.md T3.0. |