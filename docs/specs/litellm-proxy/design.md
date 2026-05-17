# LiteLLM Proxy Design

## Solution Summary
Keep the template flow local-only for llama.cpp model serving, and add a dedicated LiteLLM manager page that can inspect the system Python runtime, install or update LiteLLM, persist a local proxy config file, start or stop a loopback-only managed LiteLLM process, and use that local proxy for model discovery.

## Architecture Overview
- Main process owns LiteLLM local manager settings persistence, Python/LiteLLM detection, install/update commands, local proxy lifecycle, connection tests, and remote model discovery.
- Preload exposes a typed LiteLLM API to the renderer.
- Renderer gets a dedicated LiteLLM navigation page.
- Create Modal stays focused on local template fields.

## Affected Modules
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/env.d.ts`
- `src/renderer/src/store/useStore.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/LiteLlmView.tsx`
- `src/renderer/src/components/SettingsView.tsx`
- `src/renderer/src/components/CreateModal.tsx`

## Data Model Changes
- Add LiteLLM manager types for install status, runtime settings, config text, process status, and recent logs.

## Runtime Flow
1. App bootstraps local manager settings and config text.
2. The LiteLLM page checks the system Python runtime, detects LiteLLM installation status, and fetches the latest PyPI version when relevant.
3. The LiteLLM page lets the user install or update LiteLLM through the detected system Python runtime.
4. The LiteLLM page lets the user edit and save the app-managed LiteLLM `config.yaml`.
5. The LiteLLM page lets the user start and stop a managed local LiteLLM proxy process.
6. Hexllama always talks to the managed local LiteLLM proxy through loopback, and the LiteLLM page lets the user test the proxy and refresh remote model options.
7. Create Modal continues through the existing local backend/model execution path only.

## IPC/API Changes
- Add `get-litellm-manager`.
- Add `save-litellm-manager-settings`.
- Add `save-litellm-config`.
- Add `install-litellm`.
- Add `update-litellm`.
- Add `start-litellm-proxy`.
- Add `stop-litellm-proxy`.
- Add `get-litellm-settings`.
- Add `save-litellm-settings`.
- Add `test-litellm-connection`.
- Add `list-litellm-models`.

## Persistence
- Store LiteLLM manager runtime settings in a second JSON file under Electron `userData`.
- Store the managed LiteLLM proxy config as an app-owned `config.yaml` under Electron `userData`.
- Store the managed proxy endpoint implicitly from the saved loopback host and port rather than exposing a separate renderer-editable connection profile.

## UI Decisions
- Keep local backend controls in Settings exactly where they are.
- Remove the old LiteLLM section from the general Settings page.
- Add a separate LiteLLM navigation entry and page.
- Put install/update/runtime controls, local proxy test/model actions, config editing, and logs on the LiteLLM page.
- Keep Create Modal local-only and explain that LiteLLM is managed from the LiteLLM page instead of the template editor.

## Failure Handling
- Invalid LiteLLM settings return structured `{ success: false, error }` responses.
- A failed model-list refresh must surface a clear error without breaking the rest of the LiteLLM manager page.
- Starting the managed LiteLLM process waits for the proxy to become reachable before reporting success.
- Changing managed host, port, or log level while the proxy is already running is rejected instead of silently desynchronizing the connection URL from the live process.
- The managed LiteLLM process is restricted to loopback-only host values so Hexllama does not expose an external endpoint path.

## Risks and Tradeoffs
- Managing LiteLLM through the user's system Python is simpler than shipping a bundled runtime, but it depends on Python being installed locally.

## Testing and Verification
- Run `npm run build`.
- Verify the LiteLLM page shows install/runtime status and config text.
- Verify install and update commands work against the detected local Python runtime.
- Verify starting the local proxy only reports success once the proxy is actually reachable.
- Verify local templates are unaffected.
- Verify LiteLLM model listing succeeds against the managed local proxy.
