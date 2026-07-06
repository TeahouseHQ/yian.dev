# Reach the host LiteLLM proxy via its Tailscale IP, not `localhost`/bridge gateway

Sandcastle agents run inside Docker sandboxes and call an LLM through a **LiteLLM
proxy that runs on the host** (baked into the image as pi's `glm-5.1` provider —
`models.json`, copied to `~/.pi/agent/models.json` in the `Dockerfile`). The
provider URL points at the host's **Tailscale IP** `100.86.127.113:4000`, not `localhost:4000` or the Docker bridge gateway
(`host.docker.internal` / `172.17.0.1`).

This machine runs **rootless Docker**, where the usual host-loopback shortcuts do
not reach a host process bound the way this proxy is: from inside the container,
`localhost` is the container itself, and the bridge gateway address does not route
to the proxy. The host's Tailscale IP is a stable address the host answers on that
the container's bridge network _can_ route to, so **bridge → Tailscale IP is the
only working path** to the proxy. Hard-coding that IP in the provider config is the
decision.

The proxy **currently has no master key configured**, so authentication is
effectively open on the trusted Tailscale network. pi still requires `apiKey` to be
resolvable, so `.env.example` sets `LITELLM_API_KEY=sk-anything` — any non-empty
placeholder is accepted at request time.

## Consequences

- **The Tailscale IP is hard-coded** in the image (`models.json`) and referenced in
  `.sandcastle/.env.example` and the `Dockerfile`. If the host's Tailscale IP
  changes, or the proxy moves, these must be updated together and the image rebuilt.
- **No auth boundary at the proxy.** Security rests on the Tailscale network being
  trusted; the placeholder key is not a secret. If the proxy is ever exposed beyond
  Tailscale, a real master key must be configured and `LITELLM_API_KEY` threaded
  through as a genuine secret.
- **Host-dependent.** The sandbox cannot reach the LLM without the host's LiteLLM
  proxy running and reachable on Tailscale; this is a local-development assumption,
  not a portable/CI-ready one.
