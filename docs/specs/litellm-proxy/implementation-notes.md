# LiteLLM Proxy Implementation Notes

- Local llama.cpp usage remains the default behavior for backward compatibility.
- The current implementation keeps a single app-managed local LiteLLM proxy runtime and does not expose a separate external LiteLLM connection profile.
- The first implementation assumes OpenAI-compatible LiteLLM endpoints for model listing.
- The dedicated LiteLLM page now owns install/update checks, local proxy runtime settings, local proxy test/model actions, config editing, and logs.
- The local manager uses the detected system Python runtime and installs LiteLLM with `python -m pip install litellm[proxy]` semantics.
- Runtime host, port, and log-level edits are rejected while the proxy is running to avoid mismatching the saved local URL and the live process.
- Managed proxy startup waits for a LiteLLM-shaped `/v1/models` response before reporting success.
- The default generated LiteLLM config intentionally omits a master key so a fresh local install works immediately without hidden authorization coupling.
- The managed LiteLLM host defaults to `127.0.0.1` and accepts IP addresses or hostnames, including `0.0.0.0` for all IPv4 interfaces and `::` for all IPv6 interfaces. The selected host is saved and passed to LiteLLM's `--host` option. LlamaDeck connects through `127.0.0.1` for `0.0.0.0`, through `::1` for `::`, and through the selected host for a specific interface. `localhost` retains its existing normalization to `127.0.0.1`.
- The template editor is now local-only; LiteLLM is served from its own page rather than represented as a template provider.
- Template load/save/import now normalize template JSON to strip removed LiteLLM-only fields so older exports cannot resurrect the deleted provider path.
- Cards without a valid local model path now surface missing configuration instead of appearing ready to launch.
- Managed LiteLLM startup must invoke LiteLLM's callable server entry point rather than `python -m litellm`, because the installed package does not expose `litellm.__main__`.
- Real LiteLLM configs can take longer than 5 seconds to pass the `/v1/models` readiness probe, so Hexllama now allows a 30-second startup window before treating the launch as failed.
- The managed LiteLLM runtime settings now include a saved local API key so loopback proxy test/model-list requests can authenticate without exposing an editable external base URL.
- Managed LiteLLM startup now strips an inherited `LITELLM_MASTER_KEY` from the child process environment when the saved config disables auth, because the user's shell environment can otherwise silently re-enable proxy auth despite `disable_auth: true` in the YAML.
- Closing the Electron app now explicitly stops the managed LiteLLM child process during `before-quit`, so the loopback proxy does not remain running after Hexllama exits.