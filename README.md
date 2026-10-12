# Ember 🔥

**Howling Whispers Ember** is a standalone, freeform, living-adventure application. The player writes naturally; systems support the world without forcing quests, dialogue trees, or visible rails.

## First playable shell

This repository contains an **Orbis-authenticated Ember launch shell** and an offline localhost preview. AI narration and world simulation are not yet connected.

- Storybook reader, Action/Speech/Thought writing desk, and Here / Places / People / Journal / Almanac world rail
- Lamplight and Daylight themes, adjustable story text size, responsive mobile view
- Coda companion preview with original synthesized alert, silent mode, per-account custom MP3/WAV/OGG ringtone storage, and a Test Sound control
- Persistent local story, journal notes, and a preview world clock
- JSON save/export/import with schema validation
- No fabricated NovelAI replies, mission completions, travel routes, or Orbis canon

For an offline UI preview, use a local HTTP server (required for browser ES modules):

```sh
python3 -m http.server 5173
# open http://localhost:5173
```

Or run `npx serve .` if you already have it installed.

```sh
npm test
npm run check
```

Node.js 22+ is recommended. There are **no npm dependencies**. For live Orbis handoff, run the protected Node service according to [deployment](docs/DEPLOYMENT.md).

## Architectural boundaries

- **Ember** owns its own interface, local state, persistence, and future orchestration.
- **Coda** currently has a *notification UI preview* and local ringtone controls, not a listening or canon-saving agent. Custom files are stored in browser IndexedDB, not in the repository or on the server.
- **NovelAI** is a *planned* narration provider, **not connected**. Its credentials must not be put in browser storage or client source.
- **Orbis** now authorizes Ember launches and validates the linked Discord session. The deeper world-knowledge connector is still planned.
- **Kilo** is an *optional future* mission-generation/evaluation provider, not a running service here.
- **Fabula** is dormant and planning-stage. There is no Fabula dependency.
- **Speculus V1–V4** are not imported or modified.

The original Claude HTML mockup is the **visual reference**, not a mandate to reuse Speculus runtime internals. See [architecture](docs/ARCHITECTURE.md) and [next milestones](docs/ROADMAP.md).

## Privacy

Stories are saved in the browser under a scope derived from the Orbis user, selected record, and launch mode. Export JSON backups to preserve them. The protected Node service validates the Orbis session on each request; it does not yet provide cloud save storage or NovelAI narration.
