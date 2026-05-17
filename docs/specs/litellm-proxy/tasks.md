# LiteLLM Proxy Tasks

- DONE: Add LiteLLM settings and manager types while preserving backward compatibility for local templates.
- DONE: Add main-process LiteLLM settings persistence, connection testing, and remote model listing for the managed local proxy.
- DONE: Expose LiteLLM manager APIs through preload and renderer typings.
- DONE: Extend renderer bootstrap/state for LiteLLM settings and remote model options.
- DONE: Add a dedicated LiteLLM navigation page and remove the old LiteLLM section from the general Settings page.
- DONE: Add system-Python-based LiteLLM detection plus install and update actions in the LiteLLM page.
- DONE: Add app-managed LiteLLM runtime settings, config persistence, and start/stop proxy controls.
- DONE: Collapse LiteLLM to the app-managed local proxy path and remove the separate external connection controls.
- DONE: Remove the LiteLLM provider option from the template editor so templates stay local-only.
- DONE: Remove the remaining LiteLLM-template execution path from cards, the dedicated chat route, preload, and main IPC.
- DONE: Validate with `npm run build` and update handoff notes.