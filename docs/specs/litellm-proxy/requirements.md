# LiteLLM Proxy Requirements

## Problem Statement
Hexllama still needs an in-app way to manage LiteLLM itself instead of sending users to an external shell for checking whether LiteLLM is installed, installing or updating it, editing the proxy config, and starting or stopping the proxy.

## Goal
Allow Hexllama to manage a loopback-only local LiteLLM proxy from the UI so users can install it, update it, edit its config, and run it locally, while keeping the template workflow focused on local llama.cpp model serving.

## Non-Goals
- Replacing or removing local llama.cpp workflows.
- Supporting arbitrary provider plugins in this implementation.
- Adding multi-profile provider management in the first implementation.
- Implementing non-OpenAI-compatible LiteLLM request formats.
- Bundling a private Python runtime inside the app in this implementation.

## Actors
- A desktop user who wants to keep using local llama.cpp templates.
- A desktop user who wants some templates to run through a LiteLLM proxy instead of a local backend.

## Use Cases
- A user checks whether Python and LiteLLM are available on the current computer.
- A user installs or updates LiteLLM from Hexllama through the detected system Python runtime.
- A user edits the LiteLLM `config.yaml` from a dedicated page in the app.
- A user starts and stops a local LiteLLM proxy from Hexllama.
- A user fetches the list of available remote models from the LiteLLM proxy.
- A user keeps local templates focused on local GGUF-backed llama.cpp serving.

## Functional Requirements
- The app must preserve the existing local llama.cpp template workflow.
- The app must provide a dedicated LiteLLM navigation page separate from the general llama.cpp settings page.
- The app must detect whether Python 3 is available on the current system.
- The app must detect whether LiteLLM is installed for the detected system Python runtime.
- The app must provide a UI action to install LiteLLM when it is missing.
- The app must provide a UI action to check for and apply LiteLLM updates when it is already installed.
- The app must provide UI controls for the local LiteLLM host, port, and log level.
- The app must persist a LiteLLM `config.yaml` file under app-managed storage and allow editing it from the UI.
- The app must support starting and stopping a managed local LiteLLM proxy process from the main process.
- The app must provide a way to test LiteLLM connectivity.
- The app must provide a way to fetch remote model identifiers from the LiteLLM proxy.
- The template editor must stay focused on local llama.cpp templates only.
- Hexllama must connect only to the app-managed local LiteLLM proxy on loopback, not to arbitrary external LiteLLM endpoints.

## Non-Functional Requirements
- Failures to connect to LiteLLM or list models must surface clear user-facing errors.
- Starting LiteLLM must not report success before the managed proxy is actually reachable.
- The app build must continue to pass after the implementation.

## Constraints
- The existing Electron IPC boundary remains the integration point between renderer and privileged operations.
- The LiteLLM integration targets an OpenAI-compatible proxy surface.
- The current local chat iframe flow is specific to llama.cpp web UI and cannot be reused unchanged for LiteLLM.
- The first local-manager implementation relies on the user's system Python runtime instead of shipping a bundled Python environment.
- The local manager binds LiteLLM to loopback-only addresses.

## Acceptance Criteria
- Users can open a dedicated LiteLLM page in the app.
- Users can see whether Python and LiteLLM are installed on the current computer.
- Users can install LiteLLM when it is missing and update it when a newer version is available.
- Users can save a LiteLLM runtime host, port, and config file from the app.
- Users can start and stop a managed local LiteLLM proxy from the app.
- Users can test the managed local LiteLLM proxy and refresh remote model options from the app.
- Existing local templates continue to run exactly as before.
- The template editor no longer offers LiteLLM as a provider option.
- `npm run build` succeeds after the implementation.

## Assumptions
- The LiteLLM proxy exposes OpenAI-compatible `/v1/models` and `/v1/chat/completions` endpoints.
- A single global LiteLLM proxy configuration is sufficient for the first implementation.
- The user's system Python environment is the supported install and update target for LiteLLM in this phase.