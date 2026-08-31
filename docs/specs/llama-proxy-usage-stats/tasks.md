# Llama Proxy Usage Stats Tasks

- DONE: Locked the v1 counted scope to proxied `/v1/chat/completions` and `/v1/completions`; other `/v1/*` requests are forwarded and recorded as non-exact rows unless llama.cpp returns exact `usage` or `timings`.
- DONE: Added shared usage/proxy type definitions in `src/shared/types.ts` and created focused main-process helper modules in `src/main/llamaProxy.ts`, `src/main/usageLedger.ts`, and `src/main/runtimePorts.ts`.
- DONE: Updated the main launch and stop flow in `src/main/ipc.ts` so `template.serverPort` is now the proxy port and the upstream `llama-server` runs on a hidden loopback port.
- DONE: Implemented tracked API forwarding plus exact `usage` and `timings` extraction for supported JSON and streaming responses in `src/main/llamaProxy.ts`.
- DONE: Persisted normalized request records under Electron `userData`, rebuild rollups at startup, and exposed live-session plus historical snapshot helpers from the main process.
- DONE: Exposed usage snapshot methods and live update subscriptions through `src/preload/index.ts` and `src/renderer/src/env.d.ts`.
- DONE: Added a dedicated renderer page in `src/renderer/src/components/UsageStatsView.tsx` and wired it through `src/renderer/src/App.tsx` and `src/renderer/src/components/Sidebar.tsx`.
- DONE: Kept renderer usage query/load state local to `UsageStatsView.tsx` instead of extending Zustand, to avoid broad store churn for a page-scoped feature.
- DONE: Added shared `UsageCostSettings` types plus main-process persistence for app-wide cost settings and exposed get/save IPC methods through preload and renderer typings.
- DONE: Added a `Cost` tab inside `src/renderer/src/components/UsageStatsView.tsx` that lets the user define input/cache/output rates and derives cost analysis from the existing summary, session, template, day, and recent-request rollups.
- IN_PROGRESS: Validate the pricing flow with `npm run build` and a manual smoke test that changes rates, reloads the app, and confirms persisted settings plus recalculated cost totals.
- DONE: Added automated coverage for response extraction, query-bearing endpoint tracking, fragmented streaming usage, bounded large responses, proxy backpressure/disconnect behavior, and asynchronous coalesced session persistence.
- IN_PROGRESS: Add focused coverage for the remaining port/legacy-ledger helpers and complete a manual API smoke test against a real llama.cpp server in the running app.
- DONE: Updated `docs/HANDOFF.md` and `docs/specs/llama-proxy-usage-stats/implementation-notes.md` with implementation findings, open issues, and the next recommended execution step.
