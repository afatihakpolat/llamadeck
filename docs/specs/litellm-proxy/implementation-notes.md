# LiteLLM Proxy Implementation Notes

- Local llama.cpp usage remains the default behavior for backward compatibility.
- The current implementation keeps a single app-managed local LiteLLM proxy runtime and does not expose a separate external LiteLLM connection profile.
- The first implementation assumes OpenAI-compatible LiteLLM endpoints for model listing.
- The dedicated LiteLLM page now owns install/update checks, local proxy runtime settings, local proxy test/model actions, config editing, and logs.
- The local manager uses the detected system Python runtime and installs LiteLLM with `python -m pip install litellm[proxy]` semantics.
- Runtime host, port, and log-level edits are rejected while the proxy is running to avoid mismatching the saved local URL and the live process.
- Managed proxy startup waits for a LiteLLM-shaped `/v1/models` response before reporting success.
- The default generated LiteLLM config intentionally omits a master key so a fresh local install works immediately without hidden authorization coupling.
- Hexllama always talks to the managed LiteLLM proxy through loopback and normalizes the saved host to `127.0.0.1`.
- The template editor is now local-only; LiteLLM is served from its own page rather than represented as a template provider.
- Template load/save/import now normalize template JSON to strip removed LiteLLM-only fields so older exports cannot resurrect the deleted provider path.
- Cards without a valid local model path now surface missing configuration instead of appearing ready to launch.