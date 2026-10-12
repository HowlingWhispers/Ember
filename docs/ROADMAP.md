# Development sequence

## M0: standalone browser shell (this commit series)

- Responsive storybook layout and optional world rail
- Local immutable history, typed writing modes, autosave, JSON export/import
- Preview-only world clock and journal notes
- Clearly marked boundaries for unconnected NovelAI, Orbis, and travel

## M1: secure narration

- Protected backend session/auth and a NovelAI provider adapter
- Turn IDs, retries, timeout and cancellation, error states, length controls
- No invented provider success; tests with simulated provider failures
- Consentful storage, story branches and regeneration that replace the chosen turn

## M2: world persistence

- Orbis authenticated read access and player-knowledge filtering
- Here/Places/People/Almanac projections from evidence-based story state
- Validated travel, time movement, and journal event reconciliation

## M3: organic mission system

- Quest proposals generated organically from narration and verified events
- Progress and completion tracked from state changes, never a narrator claim alone
- Hidden / organic journal / optional explicit tracking display
- Evaluate NovelAI-only reliability before committing to a separate Kilo worker

## M4: living-world simulation

- NPC routines, weather, world events, factions and consequences
- Define ownership of possible future Fabula components only when designed and implemented
