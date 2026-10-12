# Ember and Orbis deployment: single Discord login

**Repository code is not a live deployment.** Do not expose the existing static Ember
document root after removing HTTP Basic Auth. The entire `/ember/` tree must instead
be proxied to the Ember session-checking service.

## 1. Update Orbis

1. Pull `HowlingWhispers/HW-Orbis` onto the **Orbis** server.
2. Apply `server/migrations/031_ember_handoff.sql` to the existing Orbis PostgreSQL database.
3. Generate a secret, e.g. `openssl rand -hex 32`; configure the **same** value
   as `EMBER_BRIDGE_SECRET` in the private Orbis and Ember service environments.
4. Set Orbis `EMBER_LAUNCH_URL=https://thehowlingwhispers.com/ember/launch`.
5. Rebuild, test and restart the Orbis API and frontend using the established
   Orbis deployment procedure. Never put the bridge secret in Vite `VITE_*` variables.
6. Make sure the Orbis frontend's Content-Security-Policy `form-action` permits
   `https://thehowlingwhispers.com`. The launch uses a top-level HTML POST form,
   *not* a ticket in the query string.

Orbis session cookie stays host-only at `lib.thehowlingwhispers.com`. No session
cookie is sent to the Ember domain.

## 2. Start the protected Ember service

In `/srv/howling-whispers/ember`:

```sh
npm run check
npm test
# Load environment from a root-protected file, NOT a file served by nginx.
npm run start:api
```

Environment variables:

- `NODE_ENV=production`
- `EMBER_PORT=8794` (loopback only)
- `EMBER_BRIDGE_SECRET=<same secret as Orbis>`
- `ORBIS_INTERNAL_URL=http://127.0.0.1:8789` (actual Orbis API port)
- `ORBIS_WEB_ORIGIN=https://lib.thehowlingwhispers.com`

Use systemd or the existing process manager to run the server in production. Restart
the Ember service on server-code changes. Client files load from the synchronized
checkout without a build step.

## 3. Change the existing nginx routing

Keep the existing `/ember` -> `/ember/` redirect, but **replace the static
alias and nginx basic-auth directives for Ember** with a reverse proxy to the
loopback Ember service. Example inside the existing HTTPS vhost:

```nginx
location ^~ /ember/ {
    proxy_pass http://127.0.0.1:8794;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # NovelAI may take up to 90s plus Orbis bridge overhead.
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    client_max_body_size 100k;
}
```

This server protects HTML, JS, CSS and JSON APIs, not just the API endpoints.
Do **not** add `auth_basic` here. Retain external security headers and HTTPS.
The `/ember/launch` endpoint requires a valid Orbis-issued one-use ticket.
It accepts an explicit `Origin` exactly matching `ORBIS_WEB_ORIGIN`; if a
browser omits or redacts `Origin` during the cross-origin form POST, it
requires `Sec-Fetch-Site: same-site`, `Sec-Fetch-Mode: navigate` and
`Sec-Fetch-Dest: document`. Explicit foreign origins and missing metadata
are rejected; Orbis still validates and consumes the ticket. It responds with a
host-only `ember.sid` cookie (Secure, HttpOnly, SameSite=Lax, Path=/ember/)
and redirects to `/ember/`.

## 4. Verify before reopening the application

- Direct unauthenticated-to-Ember `GET /ember/` redirects to `https://lib.thehowlingwhispers.com/ember/connect`, where an existing Orbis Discord session immediately starts a **blank sandbox**, or missing sign-in uses the existing Discord flow.
- Orbis migration `032_ember_sandbox_launch.sql` and `public/ember-handoff.js` are required for this direct-entry flow. Rebuild Orbis before switching Ember to the new mode.
- Anonymous `GET /ember/src/app.js` and `GET /ember/assets/sounds/hey-listen.mp3` are denied.
- Authenticated `GET /ember/assets/sounds/hey-listen.mp3` returns MP3 bytes with `audio/mpeg`; the app CSP allows `media-src 'self' blob:`.
- Coda's Hey! Listen! clip can be selected and tested; only locally uploaded user ringtones stay in IndexedDB.
- Opening `/ember/` directly launches `mode=sandbox` with no attached world, NPCs, or starting narrator, **even if an earlier world/character Ember cookie exists**. Package launches redirect to `/ember/scene` so the main address remains the blank sandbox entry.
- Orbis Character button launches `mode=character`, without travel and quest controls.
- Orbis World button launches `mode=world`, with the optional world rail.
- A ticket cannot be redeemed twice and never appears in the URL.
- An authenticated world launch from a real browser succeeds with a redacted Origin only when Fetch Metadata indicates same-site top-level navigation.
- A foreign Origin remains forbidden, even when Fetch Metadata is otherwise valid.
- Changing to a different Orbis user does not open another user's local story.
- Orbis logout or expired session causes protected Ember requests to return 401.
- Restricted and private Orbis assets cannot be launched by unauthorized users.
- NovelAI narration now uses the signed-in player's *personal* encrypted credential in Orbis, through `POST /ember/api/generate` and `POST /api/internal/ember/generate`. Never add that key to Ember's environment or browser source.
- Test by signing in, opening the blank sandbox, entering "Hello" and confirming a returned narrator turn, without a second login. Test missing key, provider rate limit, retry, and expired Orbis session.

## Operational limitations

- Ember's browser session-token cache is **in memory** and is intentionally lost
  when the Ember process restarts. An authorized user can relaunch from Orbis.
- Linked grants expire after 8 hours, sooner if Orbis signs out or revokes access.
- Orbis must be reachable from Ember over its loopback internal API. If it's down,
  Ember fails closed.
- Periodic cleanup of expired rows can be done with
  `DELETE FROM ember_launch_tickets WHERE session_expires_at < now();`.
- Production rate limits on public handoff endpoints should be configured in nginx.

## Provider-generation rollout

After updating Orbis and Ember code, restart `orbis.service` and `ember.service` (after their usual build and test steps). Orbis must already have `ORBIS_CREDENTIAL_ENCRYPTION_KEY` and the user's own NovelAI key in Account settings. No new secret is needed beyond the existing Ember bridge secret. Keep nginx `/ember/` proxy read timeout at least 120 seconds; the upstream provider request times out at 90 seconds. The response is non-streaming in this first milestone. No story text or NovelAI key is logged by the new generation path. If the player has a previously saved unanswered turn from the local-only version, the composer shows **Generate reply** so they can continue without rewriting it.
