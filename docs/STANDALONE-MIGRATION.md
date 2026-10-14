# Ember independent runtime migration (EMBER-STANDALONE-001)

**Owner:** ChatGPT, engineering and implementation. **Operations:** Kilo, deployment and runtime verification only.  
**Scope:** `HowlingWhispers/Ember` only. No Orbis or Chatty implementation dependency.  
**Decision:** Create temporary Ember guest profiles. Future HW-Landing/Portal will provide optional central identity and credential management, replacing *authentication only*, not Ember's roleplay runtime.

## Stable project invariant

The user must eventually be able to enter Ember directly, get a guest identity, import a Character Card V2 and a standalone lorebook, configure their own NovelAI key in Ember, and get an AI reply based on those local assets, **without any Orbis request**. NovelAI itself remains an online service. Imported character data and roleplay history stay private by default.

## Verified status at the beginning of migration

- Existing online app still requires an Orbis-issued session and routes `/ember/api/generate` through Orbis.
- Browser `src/storage.js` keys story saves by the Orbis user UUID, mode and linked launch asset; `src/asset-store.js` keys IndexedDB assets and attachments by an owner string. Replacing sessions without migration can **orphan browser records**.
- Character Cards V2, attached lorebooks and character books were not included in legacy provider generation, regardless of the status of the bridge mismatch error.
- `src/context-compiler.js` now builds character-scoped generation data, selected greeting, activated standalone and embedded lorebook entries and story history as a bounded prompt. Pure tests exist. It is not wired to a live generation API yet.
- `server/novelai.js` now provides direct bounded NovelAI generation, model allowlisting, timeout handling and sanitized errors. It does not read Orbis credentials and is not wired to live routes.
- `server/guest-vault.js` now provides durable cryptographically opaque guest tokens, server-only encrypted NovelAI settings, and verified absence of plaintext secrets on disk. It is not yet wired to HTTP routes.

## Stage A: guest identity and secure server routes

1. Behind an explicit server-side feature flag, initialize `createGuestVault` at startup. Provide a **persistent, private data directory** outside the web-served checkout, owned by the service user and mode 0700. The key is a separate 32-byte encryption secret configured in a root-protected environment, never committed.
2. Create a 256-bit opaque guest session token in a host-only `Secure; HttpOnly; SameSite=Lax; Path=/ember/` cookie in production. Never put it in a URL, JS variable or `localStorage`. Support opt-in session revocation and CSRF protection on mutating endpoints. No cookie/session value appears in logs. Set explicit rate limits.
3. The guest profile may read and manage only its own credential record. Expose a settings endpoint for key replacement/deletion and **masked/status-only** reads. No API may reveal the plaintext API key; only the provider adapter receives it in process.
4. On the guest-only path, serve the app and validate guest session without checking Orbis. Do not change old session behavior until the new path is ready. Distinguish guest and legacy modes explicitly; no ambiguous cross-mode session fallback.
5. A lost guest cookie is currently a lost **credential-vault reference**; don't promise account recovery without designing it. Warn users that browser clearing or using a new device may need reconfiguring NovelAI. A future optional Portal account may introduce recovery.

## Stage B: Ember-native generation

1. Resolve the selected V2 character and all enabled standalone lorebooks in browser storage. Include embedded V2 character book entries and chosen greeting; keep original source metadata preserved.
2. Build a context with Ember's compiler. Keep the latest player turn and a bounded history; expose activation/budget diagnostics for debug. Never treat imported card text as a server instruction or administrative policy.
3. Send the bounded **fiction context**, not browser secrets, to an authenticated Ember API. The Ember server validates origin, CSRF intent, maximum body size, current session, per-profile generation lock, prompt length and provider settings.
4. Use `server/novelai.js` directly from Ember with the decrypted in-process key. Never relay to Orbis. Respond with sanitized errors and valid nonempty narration. No automatic paid retries.
5. Remove the old provider bridge only after the new Ember path works end-to-end and is verified against a real provider.

## Stage C: non-destructive browser data transition

1. Provide separate **story and library backups** before the move. Ensure backup/restore works in the actual browser, not only unit tests.
2. During a controlled overlap period, recognize the former Orbis-scoped save **only while the user has a verified corresponding legacy session**. Never scan and silently import another user's data from shared-browser storage.
3. Preview exactly which story, character cards, lorebooks and attachments would be copied to the guest scope. Require confirmation.
4. Create **copies** in the new profile: preserve source bytes, asset IDs/links, story turns and journal. Migrate `launch` bindings into valid guest-native story state with explicit provenance; do not mutate the original story. Detect conflicts and stop rather than overwrite.
5. Verify imported counts, hashes, attachments, narrative greeting and story integrity. Keep old records until user has explicitly exported a backup and verified the new profile. Record migration provenance locally.
6. Never migrate encrypted Orbis API keys by reading them from the browser. The user adds their NovelAI key separately in Ember unless a future separately authorized secure key-transfer mechanism exists.

## Stage D: gradual rollout and verification

- **Unit tests:** key encryption/decryption, isolation, invalid session, malformed/oversized input, wrong key, missing settings, context budgets, V2 + lore activation, generated response contracts.
- **Integration tests:** persistent guest profile after service restart, cookie/origin protection, rate limits, multi-session behavior, no session leakage, local provider mock, proper failures, non-destructive migrations.
- **Browser tests:** desktop/mobile signup-free first load, re-entry, local V2 + lorebook import, selected greetings, settings, backup/restore, migration preview and conflicts, account/session isolation on shared devices.
- **Real provider smoke test:** one user-authorized NovelAI request with a known test card and lorebook. Verify that relevant content reaches the provider and a valid reply is received. Do not log user story text or keys.
- **Rollback:** keep existing Orbis-linked route and its records unchanged until the owner approves switching. A rollback must restore previous session flow without deleting guest profiles, credentials or browser data.

## Future Portal identity

The account service eventually lives behind HW-Landing as a shared portal. Guest profiles carry internal IDs independent of Orbis IDs. A future account-linking migration should add a mapping/claim flow while preserving each Ember profile and source data. Do not invent a second permanent Ember username/password system now.

**Security gate:** Do not deploy guest-provider endpoints until a full authenticated HTTP integration test and operational key-management/recovery procedure are in place. A green unit test is not production readiness.
