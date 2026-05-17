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

## Verification
- `npm run build`
- `npm run build` after renderer/source-update review fixes
- `npm run build` after LiteLLM provider implementation and review fixes
- `npm run build` after the dedicated LiteLLM manager page and local proxy control flow
- `npm run build` after removing the remaining LiteLLM-template runtime path

## Next Recommended Check
- Manual smoke test in the running app: point the backend folder at a llama.cpp repo, run "Check Now", trigger "Build From Source", confirm a new `b####` folder appears without deleting older builds, confirm pinned templates move to the new backend, and confirm cancel stops without an error alert.
- Manual smoke test for LiteLLM manager: open the LiteLLM page, confirm Python detection, install or update LiteLLM if needed, save the default config, start the proxy, test the local proxy, refresh remote models, and confirm a local template still starts against a local backend as before.
