# Handoff

## Completed
- Replaced the old release-download update flow with an in-app Windows source-build flow for llama.cpp.
- Added main-process orchestration that fetches the latest upstream `b####` tag, checks out that tag, configures CMake/CUDA tooling, builds into a versioned backend folder, and refreshes the renderer snapshot on success.
- Updated Settings and the update banner to trigger source builds, show phase-based progress, support cancel, and refresh backends/templates/active backend after success.
- Preserved existing versioned backend folders and repointed pinned templates to the newly built backend automatically.
- Added a dedicated LiteLLM manager flow beside the local llama.cpp template workflow.
- Added a dedicated LiteLLM navigation page with system-Python detection, LiteLLM install/update actions, app-managed runtime settings, config editing, start/stop controls, and runtime logs.
- Simplified LiteLLM to a loopback-only app-managed proxy path, removed the separate external connection controls, and kept local model discovery and chat routed through the managed local proxy.
- Added local proxy testing and remote model discovery for the managed LiteLLM proxy.
- Removed the LiteLLM provider option from the template modal so template creation is local-only again; LiteLLM is managed separately from the LiteLLM page.
- Kept existing local templates working unchanged while keeping new template creation local-only.
- Removed the remaining LiteLLM-template code paths from cards, the dedicated chat route, preload, shared template types, and main IPC.
- Normalized loaded, saved, and imported templates to strip removed LiteLLM-only fields, and made invalid legacy templates show missing configuration instead of appearing ready to start.
- Removed the stale external LiteLLM settings API surface from preload, renderer typings, and unused main-process helpers.
- Fixed LiteLLM proxy startup to use LiteLLM's actual Python entry point instead of the invalid `python -m litellm` path.
- Increased the LiteLLM readiness timeout from 5 seconds to 30 seconds so slower proxy startup is not killed prematurely.
- Added a configurable API key to the managed LiteLLM runtime settings so Test Local Proxy and Refresh Models can authenticate against the loopback proxy when local auth is enabled.
- Fixed managed LiteLLM no-auth startup to ignore an inherited `LITELLM_MASTER_KEY` environment variable when the saved config sets `general_settings.disable_auth: true`, matching the user's working local script.
- Added an app shutdown hook so closing Hexllama also stops the managed LiteLLM proxy instead of leaving the child process running.
- Added a persisted Light/Dark/System theme setting, boot-time theme hydration, and a full dark token set so the renderer supports a proper dark mode instead of light-only colors.
- Updated chat windows and the Electron window bootstrap path so theme changes propagate across windows and dark mode no longer starts from a hardcoded light background when the OS theme already matches the app theme.
- Rebranded the app from Hexllama to LlamaDeck across the packaged app name, visible UI, window titles, and README branding.
- Added a main-process compatibility bootstrap so packaged upgrades keep using the legacy Hexllama user-data directory when it already exists, preserving templates, folder settings, LiteLLM settings, and renderer local storage through the rename.
- Added a persisted minimize-to-tray window behavior setting with a Settings toggle; when enabled, clicking the main window X hides LlamaDeck to a tray icon with reopen and quit actions instead of closing the app.

## Verification
- `npm run build`
- `npm run build` after renderer/source-update review fixes
- `npm run build` after LiteLLM provider implementation and review fixes
- `npm run build` after the dedicated LiteLLM manager page and local proxy control flow
- `npm run build` after removing the remaining LiteLLM-template runtime path
- `npm run build` after normalizing legacy templates and removing the stale LiteLLM settings API surface
- `npm run build` after fixing LiteLLM startup entry-point and readiness timeout handling
- `npm run build` after adding managed LiteLLM API key support for proxy test and model listing
- `npm run build` after making managed LiteLLM startup ignore inherited master-key auth in no-auth mode
- `npm run build` after adding managed LiteLLM shutdown cleanup on app exit
- `npm run build` after implementing persisted dark mode, cross-window theme sync, and dark-aware window bootstrap colors
- `npm run build` after renaming the app to LlamaDeck and adding legacy user-data compatibility for packaged upgrades
- `npm run build` after adding the persisted minimize-to-tray main-window behavior and Settings toggle

## Next Recommended Check
- Manual smoke test in the running app: point the backend folder at a llama.cpp repo, run "Check Now", trigger "Build From Source", confirm a new `b####` folder appears without deleting older builds, confirm pinned templates move to the new backend, and confirm cancel stops without an error alert.
- Manual smoke test for LiteLLM manager: open the LiteLLM page, confirm Python detection, install or update LiteLLM if needed, save the default config, set a local proxy API key if your config requires auth, start the proxy, test the local proxy, refresh remote models, and confirm a local template still starts against a local backend as before.
- Manual smoke test for theming: switch between Light, Dark, and System in Settings, open a chat window, confirm the chat window follows the same theme, and if using System, toggle the OS theme while both windows stay open.
- Manual smoke test for tray behavior: enable "Minimize To Tray" in Settings, click the main window X, confirm the app hides and shows a tray icon, restore it from the tray icon/menu, and confirm choosing Quit from the tray still shuts down managed processes.
- Residual polish gap: when the saved app theme differs from the OS theme, a cold-open main window or newly opened chat window can still flash the OS-based background before renderer hydration applies the saved theme.
- Rename caveat: packaged upgrades preserve the legacy Hexllama data directory, but the installer identity, taskbar pins, and shortcuts still move to the new LlamaDeck identity rather than migrating in place.
