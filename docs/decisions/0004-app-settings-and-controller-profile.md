# 0004: App settings live outside decks, in one file owned by main

Date: 2026-11-14. Status: accepted.

## Context

The piano sound, the keys picture and the MPK mini's MIDI layout (pad notes, pad channel, knob CCs) are about this Mac and this controller, not about a talk. They must survive restarts, and a change made in one window (P pressed on the stage) must reach the other (the presenter view's toggle) at once.

## Decision

- `settings.json` in the app data folder, read and written only by main, with atomic writes like decks.
- The schema is in `src/ipc/settings.ts` (zod, every field defaulted). A damaged file falls back group by group, so a bad controller entry never turns the piano off.
- Renderers call `updateSettings(patch)`. Main merges, saves, and broadcasts the full settings to every window. Each window keeps a Zustand copy (`shared/settings.ts`).
- Mappings stay in the deck: they belong to the talk. The controller profile only decides how mappings are drawn and created (which note is "Pad 1").

## Consequences

- Toggling the piano or the keys picture never marks a deck as changed or adds an undo step.
- Moving a deck to another machine keeps its mappings; that machine's own controller settings apply.
- Piano audio plays in whichever window owns MIDI (editor while editing, stage during a show), so it never doubles.
