# Ember architecture (initial foundation)

Ember is a **new application**, not a Speculus skin and not a Fabula frontend. Its freeform text input must remain primary.

## Current, implemented

1. `src/engine.js`: immutable local story and journal transitions, bounded demo clock, and strict persisted-state validation.
2. `src/storage.js`: namespaced browser autosave and portable JSON backup.
3. `src/app.js`: storybook view, world rail, writing desk, preferences, and explicit unconnected-feature affordances.
4. `src/styles.css`: standalone Lamplight/Daylight visual system and responsive layout.

All sample lore references in this build are **concept-preview labels**, not live Orbis data, authoritative world state, or proof of what the player knows. Time changes from the preview Wait control are local demo state only.

## Proposed provider architecture (not implemented)

- Player input -> Ember turn validation -> narration adapter (NovelAI, on a protected server endpoint) -> pending turn -> accepted response + event proposal.
- Ember should verify proposed events before committing state. Provider prose is not authoritative facts.
- Orbis connector must be authenticated and knowledge-filtered: canonical entries remain distinguishable from story-local changes.
- A future mission evaluator (Kilo or a tested NAI structured pass) may **propose** mission state changes, but only verified event evidence can commit them.
- Fabula may later be designed as a world simulation module, but must not be described as currently operational.

## Invariants

- Freeform roleplay is allowed without choosing a menu action.
- No invisible quest completion from AI prose alone.
- No unknown travel links are assumed to exist.
- No cross-imports from Speculus V1–V4; no Fabula runtime dependency.
- Save data has a version and is validated before restore. Unsupported versions fail rather than silently corrupting the story.
- Third-party provider secrets never go into client-side bundles or localStorage.
