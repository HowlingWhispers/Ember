# Ember architecture (initial foundation)

Ember is a **new application**, not a Speculus skin and not a Fabula frontend. Its freeform text input must remain primary.

## Current, implemented

1. `server/index.js`: loopback-bound Node session gateway; POST launch redeems an Orbis ticket and every protected request rechecks the linked Orbis session.
2. `src/bootstrap.js`: fetches a server-validated Orbis launch context before loading the UI outside localhost.
3. `src/engine.js`: immutable local story and journal transitions, bounded demo clock, strict persisted-state validation, and separate character/world modes.
4. `src/storage.js`: Orbis user + record + mode scoped browser autosave and portable JSON backup.
5. `src/app.js`: storybook view, world rail, writing desk, preferences, and explicit unconnected-feature affordances.
6. `src/styles.css`: standalone Lamplight/Daylight visual system and responsive layout.

Orbis **now validates launch identity and source record access**, but does not yet hydrate Ember's world panels with canon or supply NAI narration. In localhost preview, example lore remains explicitly noncanonical sample text. Preview Wait only changes a local clock.

## Proposed provider architecture (not implemented)

- Player input -> Ember turn validation -> narration adapter (NovelAI, on a protected server endpoint) -> pending turn -> accepted response + event proposal.
- Ember should verify proposed events before committing state. Provider prose is not authoritative facts.
- Orbis launch/session validation is implemented. NovelAI generation goes Ember browser -> Ember authenticated server -> Orbis trusted bridge -> encrypted user credential -> NovelAI, with no credential leaving Orbis. Canonical record hydration and knowledge-filtered world projections remain unimplemented.
- A future mission evaluator (Kilo or a tested NAI structured pass) may **propose** mission state changes, but only verified event evidence can commit them.
- Fabula may later be designed as a world simulation module, but must not be described as currently operational.

## Invariants

- Freeform roleplay is allowed without choosing a menu action.
- No invisible quest completion from AI prose alone.
- No unknown travel links are assumed to exist.
- No cross-imports from Speculus V1–V4; no Fabula runtime dependency.
- Save data has a version and is validated before restore. Unsupported versions fail rather than silently corrupting the story.
- Third-party provider secrets never go into client-side bundles or localStorage.
