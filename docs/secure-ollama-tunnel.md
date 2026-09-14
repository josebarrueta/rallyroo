# Secure production Ollama tunnel

Production schedule-draft extraction reaches the Mac-hosted Ollama runtime through a
dedicated Cloudflare Tunnel. Ollama remains bound to `127.0.0.1:11434`; neither the
Mac nor Google Cloud exposes an inbound origin port.

## Security boundaries

1. `ollama.rallyroo.dev/api/chat` is a path-scoped Cloudflare Access self-hosted
   application with no human allow policy. Its only policy is **Service Auth** for the
   dedicated `rallyroo-prod-api-to-ollama` service token.
2. The dedicated tunnel publishes only the exact `^/api/chat$` path. Every other path
   terminates at the tunnel's `http_status:404` catch-all and cannot reach Ollama.
3. **Protect with Access** is enabled on the tunnel route. `cloudflared` validates the
   `Cf-Access-Jwt-Assertion` against the Access application's audience and Rallyroo's
   Cloudflare team before proxying to the loopback origin.
4. The API reads the service-token pair from a read-only Kubernetes Secret volume and
   sends it as `CF-Access-Client-Id` and `CF-Access-Client-Secret`. The pair is not in
   a ConfigMap, image, Git repository, Terraform state, or Mac tunnel configuration.
5. Ollama remains optional. Tunnel, Access, Mac, or provider failure makes draft
   extraction unavailable but does not affect manual Event or Reminder behavior.

Do not use a Cloudflare Quick Tunnel. Do not set `OLLAMA_HOST=0.0.0.0`. Do not add an
`Allow` or `Bypass` policy, and do not reuse the production API ingress tunnel or its
token.

## Cloudflare provisioning order

Create the Access protection before publishing the hostname:

1. In **Zero Trust → Access controls → Service credentials → Service Tokens**, create
   `rallyroo-prod-api-to-ollama`. Store its one-time Client ID and Client Secret in the
   `rallyroo-prod` 1Password vault as item `rallyroo-ollama-access`, fields
   `OLLAMA_CF_ACCESS_CLIENT_ID` and `OLLAMA_CF_ACCESS_CLIENT_SECRET`.
2. In **Zero Trust → Access controls → Applications**, create a self-hosted application
   for `ollama.rallyroo.dev` with exact application path `/api/chat` (the dashboard may
   display `api/chat`; do not use a wildcard or regular expression). Enable the 401
   response for Service Auth and add exactly one Service Auth policy that includes only
   `rallyroo-prod-api-to-ollama`. Leaving the path empty protects the whole hostname and
   prevents excluded tunnel paths from returning 404. Record the AUD tag and team name.
3. In **Networking → Tunnels**, create a separate tunnel named
   `rallyroo-mac-ollama`. Add a published application route for
   `ollama.rallyroo.dev`, path `^/api/chat$`, service
   `http://127.0.0.1:11434`. Under HTTP settings, set **HTTP Host Header** to
   `127.0.0.1:11434`; Ollama rejects the public hostname with HTTP 403. Enable
   **Protect with Access** using the team name and AUD tag from step 2. Retain the final
   `http_status:404` catch-all.
4. Copy the tunnel token and run `deploy/mac/install-ollama-tunnel.sh` on the Mac. The
   script stores the token in a mode-0600 file, installs a user LaunchAgent, verifies
   Ollama is loopback-only, and rejects an endpoint that does not deny an unauthenticated
   request or expose only the intended path.

The tunnel token authorizes this Mac to attach to the dedicated tunnel; it is not the
Access service token and must never be placed in the Kubernetes API pod.

## Production handoff

Normally, do not configure `providerSecrets.ollamaAccess` until the 1Password
Operator has created `Secret/rallyroo-ollama-access` with exactly the two expected
keys. If account quota blocks synchronization, a temporary manually created Secret is
acceptable only while the Operator is paused. Mark it for 1Password handoff, verify
its key names without displaying values, and replace it with Operator ownership as
soon as quota resets.

The production API configuration is:

```text
OLLAMA_BASE_URL=https://ollama.rallyroo.dev
OLLAMA_MODEL=qwen3.8:27b-mlx
OLLAMA_CF_ACCESS_CLIENT_ID_FILE=/run/secrets/ollama-access/client-id
OLLAMA_CF_ACCESS_CLIENT_SECRET_FILE=/run/secrets/ollama-access/client-secret
```

After rollout, verify without printing credentials:

- unauthenticated `POST https://ollama.rallyroo.dev/api/chat` returns 401 or 403;
- an authenticated request from the API pod reaches only `/api/chat`;
- `/api/tags`, `/api/pull`, and `/` return 404 through the public hostname;
- a real parent schedule-draft request succeeds;
- stopping the Mac tunnel yields the normal provider-unavailable response while API
  `/health` and `/ready` remain healthy.

## Rotation and shutdown

Rotate the Access service-token secret with a grace period, update the 1Password item,
wait for Operator synchronization and API rollout, verify, then expire the old secret.
Set a Cloudflare expiration alert for the service token.

To stop the Mac tunnel:

```bash
launchctl bootout "gui/$(id -u)/dev.rallyroo.ollama-tunnel"
```

Delete the Access service token to revoke API access immediately. Deleting or pausing
the tunnel additionally removes network reachability; Ollama remains locally usable.
