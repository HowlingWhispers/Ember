# Ember native Asset Library

**Design:** EMBER-AL-001 · **Repository:** HowlingWhispers/Ember · **Ownership:** Ember only

## Current implementation

- `src/asset-import.js`: Character Card V2 JSON/PNG and standalone JSON lorebook import adapters. Imports preserve original source bytes and JSON metadata. No Chatty or Orbis imports.
- `src/asset-store.js`: browser IndexedDB asset records, account/local profile scope, deduplication by SHA-256, independent per-story asset bindings.
- `src/asset-backup.js`: portable backup and restore of the original bytes in the local library. Backups are opt-in and never transmitted to servers.
- `src/lore-engine.js`: bounded, deterministic keyword matching, selective secondary triggers, constant entries, probability checks, recursion cap, token-budget approximation, diagnostic results.
- `src/library-ui.js`, `src/library.css`: My Library browser UI, separate Characters and Lorebooks sections, previews, source export, rename, delete, backup and restore, per-story attach/disable, lore trigger diagnostics and greeting selection.
- `src/app.js`: opens a new local story with the chosen imported greeting, attaches the character, and preserves its selected scenario in story metadata.

## Provenance and storage

Each imported asset is stored in this browser profile as an IndexedDB record. Its original bytes, parsed source object, normalized Ember fields and original filename are retained. Renaming the Ember library label does not mutate the source file. Duplicate imports of identical bytes reuse the existing record.

An imported lorebook is **not** a V2 character card. Each format has its own parser. Character Card V2 may have an embedded `character_book`; it is retained as part of that character, but standalone lorebooks are independent library assets.

The story itself continues to use its existing `localStorage` save format. Existing stories are not migrated or reset by the new asset database. A browser-data wipe can delete local stories and assets. Library backups and existing story exports are separate; do both before clearing site data.

## Security boundaries

Imported prompts, dialogue, metadata and lore are untrusted narrative data, not application instructions. Imported files never execute code. The UI escapes HTML when displaying source text. The parser validates supported JSON shapes, metadata, PNG structure and CRCs, and size limits. Referenced external portrait URLs are not downloaded automatically.

Source-specific lore fields not normalized into runtime behavior are preserved in `original` but do **not** implicitly become supported behavior. The current lore tokenizer is a rough estimate (Unicode character count divided by four), not provider-accurate tokenization.

## Current limitations and next engineering gates

1. **No complete standalone AI provider:** Ember's online runtime still authenticates via Orbis and routes NovelAI generation through Orbis. Importing and organizing assets does not call Orbis, but this is not yet an Orbis-independent browser service.
2. **No imported AI context in live generation:** The library can attach assets and run local lore activation diagnostics. The current provider bridge does not accept full imported character and lore contexts. Do not label story-asset attachments as influencing AI until Ember owns and verifies its generation pipeline.
3. **Editing:** Labels and assignments are editable. Full authoring/editing of imported character definitions and individual lore entries, together with edited-source export, remain to implement.
4. **Lorebook parity:** Common keyword/constant/selective/probability/budget/recursion behavior exists, but advanced triggers such as regex keys, inclusion groups, role/position routing, cooldown/sticky logic and provider-accurate token budgets need dedicated compatibility tests before declaring full SillyTavern parity.
5. **Browser QA:** GitHub CI covers parser and pure activation tests, but desktop/mobile dialog behavior, IndexedDB transactions, local backup restoration and genuine uploaded fixtures require end-to-end/manual verification. Tests of the actual examples should be performed locally without publishing third-party material to the repo.
6. **Story snapshotting:** The binding records currently reference library assets by ID; story-specific immutable snapshots and cleanup of deleted-asset references remain planned.
7. **Profile migration:** The current online store is scoped to Ember's existing Orbis user ID. Any future standalone account system must explicitly migrate or remap local library scopes, without silently dropping records.

## Next recommended milestones

- Complete IndexedDB/browser integration testing and actual uploaded-file QA before live deployment.
- Implement full character and lorebook editing plus edited-copy export.
- Implement the standalone Ember provider/context compiler and connect selected assets to generation, without extending Orbis's app-specific responsibilities.
- Verify true offline/standalone access, account identity migration and story/asset portability.

## Release discipline

Commit and CI passing are **not** deployment or user acceptance. Kilo handles operational deployment only after authorization. Keep the existing server security boundaries until the separate standalone auth/provider migration is approved and verified.
