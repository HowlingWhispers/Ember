# Ember 🔥

**Howling Whispers Ember** is a standalone, freeform, living-adventure application. The player writes naturally; systems support the world without forcing quests, dialogue trees, or visible rails.

## First playable shell

This repository currently contains an **offline local preview**, not a connected AI simulator.

- Storybook reader, Action/Speech/Thought writing desk, and Here / Places / People / Journal / Almanac world rail
- Lamplight and Daylight themes, adjustable story text size, responsive mobile view
- Persistent local story, journal notes, and a preview world clock
- JSON save/export/import with schema validation
- No fabricated NovelAI replies, mission completions, travel routes, or Orbis canon

Open the application using a local HTTP server (required for browser ES modules):

```sh
python3 -m http.server 5173
# open http://localhost:5173
```

Or run `npx serve .` if you already have it installed.

```sh
npm test
npm run check
```

Node.js 22+ is recommended. There are **no npm dependencies**, installation steps, or build artifacts yet.

## Architectural boundaries

- **Ember** owns its own interface, local state, persistence, and future orchestration.
- **NovelAI** is a *planned* narration provider, **not connected**. Its credentials must not be put in browser storage or client source.
- **Orbis** is a *planned* authenticated source of canon and knowledge. The preview labels sample references as such.
- **Kilo** is an *optional future* mission-generation/evaluation provider, not a running service here.
- **Fabula** is dormant and planning-stage. There is no Fabula dependency.
- **Speculus V1–V4** are not imported or modified.

The original Claude HTML mockup is the **visual reference**, not a mandate to reuse Speculus runtime internals. See [architecture](docs/ARCHITECTURE.md) and [next milestones](docs/ROADMAP.md).

## Privacy

The preview saves in your browser's local storage. Export a JSON backup if you need to move or preserve a story. Do not put secrets or real NovelAI credentials into the preview; no backend authentication exists yet.
