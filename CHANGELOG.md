# Changelog

Stagekeys follows semantic versioning. Deck files carry their own `schemaVersion`.

## 0.1.0 (unreleased)

First working build. Deck schema version 1.

### Foundation

- Electron + Vite + React + TypeScript (strict) scaffold with a sandboxed, context-isolated renderer and a typed preload bridge. Every IPC call is validated with zod in main.
- Central action system: keyboard shortcuts, MIDI mappings, menu items and buttons all dispatch the same typed actions.
- Deck model with zod schema, migration framework and folder bundles (`deck.json`, `assets/`, `backups/`).
- Atomic saves, autosave every 5 seconds, timestamped backups (last 20), draft bundles for unsaved decks, and restore-from-backup when a deck cannot be read.
- File logging with a Help → Open Log Folder menu item.

### MIDI

- Device list, pick one device or listen to all, hot-plug with automatic reconnect by device name.
- Parsing of note on/off (velocity 0 as note off), CC, pitch bend and sustain.
- Throttled MIDI monitor, mock MIDI source, and a virtual keyboard in development builds.

### Editor

- Slide list with thumbnails: add, duplicate, delete, drag to reorder, rename.
- Canvas with text, rectangle, ellipse, line, image and animation elements; select, multi-select, marquee, move with snapping guides, resize, rotate, z-order, lock, hide, copy/paste/duplicate, arrow-key nudging.
- Properties panel, speaker notes, bundled open-licence fonts (Inter, Space Grotesk, JetBrains Mono) plus system fonts.
- Undo/redo for every edit, stored as patches.

### Presenting

- Fullscreen stage window on a chosen display, with cut, fade, slide and zoom transitions and a black screen toggle.
- Presenter view: current and next slide, notes, timer, clock, MIDI monitor and device status.
- Keyboard fallback (arrows, space, Esc, B, H, Home) independent of MIDI.
- Show-safe mode: animation errors are caught and skipped, no dialogs during a show, display sleep blocked, stage renderer reloaded on the same slide if it dies.
- Rehearsal mode with an on-stage timer and a per-slide timing report.

### Mapping

- MIDI Learn, triggers (note on/off, CC above/below, CC value, sustain down/up), filters (device, channel, note range, velocity range), value curves, per-slide scope that wins over global, named keyboard zones, and JSON import/export.

### Animations

- Registry where an animation is one file plus one registry line, with editor controls generated from its zod schema and MIDI bindings for numeric parameters.
- Built-in: Bloom, Pulse, Ripple, Text reveal, Step sequence.

### Export and diagnostics

- Export all slides as PNG files or a single PDF.
- FPS overlay (Cmd/Ctrl+Shift+F) with MIDI-to-frame latency; latency logged in development.

### Install

- App icon (`build/icon.svg`) and `pnpm install-app`, which installs `/Applications/Stagekeys.app` with a Desktop shortcut.

### Known gaps

- Not yet tried with a physical MIDI keyboard or a second display.
- Windows is untested.
- The packaged app is unsigned.
