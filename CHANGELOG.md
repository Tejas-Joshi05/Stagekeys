# Changelog

Stagekeys follows semantic versioning. Deck files carry their own `schemaVersion`.

## 0.3.0 (unreleased)

Deck schema is now version 2. Decks from 0.1.0 and 0.2.0 open unchanged and are saved as version 2; a deck saved by 0.3.0 does not open in older versions.

### Sound input

- **Sound input**: animations can react to a microphone or line input. Off by default; switch it on in the MIDI & sound tab, with the toolbar button, ⇧⌘L, L during a show, or a mapped key. The sound is only measured, never recorded. Choose the input device in the same tab.
- **Sensitivity slider**, from "as stiff as it gets" (only loud sound moves anything, slowly) to "as sensitive as it gets" (a whisper fills the meter, instantly). It changes gain, noise gate, attack, release and how easily beats fire together. Map a knob to **Set sound sensitivity** to ride it live.
- A live meter (overall, low, mid, high and a beat lamp) in the MIDI & sound tab and in the presenter view, which also says if the input is blocked or missing.
- Any numeric animation setting can follow the sound: bind it to loudness, bass, middle, treble or beats under "MIDI and sound bindings". For example, bind the garden's Wind to loudness.

### New animations

- **ASCII vignette**: a frame of ASCII ink around the slide, in two inks like the garden. Eleven shapes for the opening (oval, circle, box, diamond, hexagon, triangle, star, heart, letterbox, curtains, corners), six glyph sets, and it can fill the middle instead of the edge. It answers sound and MIDI differently:
  - sound moves the whole frame in the main ink: breathe, close in, open up, shiver or equaliser (bass from below, treble from above), plus a kick on beats;
  - keys leave local marks in a third ink: a bite where the key sits (held keys keep their bite, harder hits bite deeper), a ripple, a flash or an iris;
  - pitch bend slides the opening sideways and the mod wheel makes the edge restless.
- **MIDI readout**: the two numbers a key really sends, "which key" and "how hard", live, with ASCII bars. It can also show the raw bytes. Made for the "it only sends two numbers" moment.

### Fixes

- **Settings were being reset.** Changing one setting through the app (toggling the piano with P, showing the keys picture, teaching the pads) quietly put the rest of that group back to its defaults, so the piano's volume and sound, or the keys picture's corner, could snap back. Only the setting that was changed is now touched.
- A MIDI connection that was stopped while still starting (a show beginning or ending in that instant) could stay attached, so every key press would fire twice afterwards. It now lets go.
- Piano: pressing or releasing a key that was sounding more than once could leave one of its notes ringing.
- MIDI Learn on a knob now makes a continuous mapping for every action that takes a value, not only "Set animation parameter".

### Not verified

- Sound input is tested end to end with Chromium's built-in fake microphone (open the device, measure it, hand it from the editor to the stage and back). It has not been tried with a physical microphone in the installed app, where macOS asks for permission, and not on Windows.

## 0.2.0

Deck schema stays at version 1; decks from 0.1.0 open unchanged.

### Riso animations from tejasjoshi.vercel.app

- **ASCII garden**: the website's live ASCII plants (tulip, maple, lily, branch, squill, ficus, rowan), drawn as GPU glyph particles in two inks. They grow in from the stem, a key press sends a ripple of flickering glyphs out from that key, a mapped trigger grows the next plant with the website's centre-out ripple, held keys thicken the ink, pitch bend leans the plant and the mod wheel (bound to Wind) blows it about. Birds fly past now and then.
- **Pressed flowers**: the pressed riso flowers bloom in where you play, as on the website's opening screen. Each key has its own flower, velocity sets the size, letting go opens it out (unless the sustain pedal is down) and a mapped trigger blooms the whole bouquet.
- New animations pick inks that suit the slide they are placed on.

### MPK mini IV

- **Keys picture**: a small MPK mini IV that lights up with held keys, pads, knob positions, both wheels and the sustain pedal. It can be shown in the editor, in the presenter view and on the audience screen, in any corner. Toggle with ⇧⌘K, K during a show, or a mapped key.
- **Controller map** replaces the mapping list. With the Mapping tab open, pressing any pad, key or knob chooses it on a picture of the controller (or click it); then pick what it does. Mapped controls are marked; slide-only ones in a different ink. Every mapping is also listed as a plain sentence ("Pad 1 ⟶ Next slide").
- Teach Stagekeys which notes your pads send and which CCs your knobs send, from the MIDI & sound tab.

### Piano sound

- Optional piano: each key plays a note through the Mac's output. Felt, grand and electric voices, volume, sustain pedal, keys that trigger a mapping can stay silent, pads silent by default. Toggle with ⇧⌘P, P during a show, or a mapped key. Off by default.

### Look

- New "night riso" interface: warm dark ground, cream type in Familjen Grotesk with IBM Plex Mono for MIDI data, and the website's rose and leaf inks for selection and live state. Chosen things carry a rose second ink printed slightly off register.
- The welcome screen grows the ASCII plants live.

### Animation fixes

- Editing an animation's colour, wind, size and similar settings no longer restarts it (the garden used to grow again from the stem on every change). Only settings that change its layout rebuild it; animations declare these with `rebuildOn`.
- Choosing another plant in the editor grows it with the plant-change ripple instead of restarting.
- Pressed flowers: pressing the same key again opens out the old flower instead of stacking a copy on top; letting go mid-bloom no longer makes the flower jump; velocity scales each flower directly, so Flower size works.
- ASCII garden: the Wind setting works (the mod wheel blows harder on top of it); full pitch bend and wind no longer push the plant out of its box; key ripples are easier to see.
- A setting that follows a MIDI binding is shown as "Follows velocity" (or the knob) instead of a field that seems to do nothing.

### Show reliability

- Before the first slide, the stage decodes every image and draws every slide once off screen, so nothing pops in or stutters the first time it is shown (about half a second for a ten-slide deck).
- Images larger than 3840 pixels are scaled down when loaded: less memory and faster uploads, no visible difference on a 1920×1080 slide.
- The piano's audio engine starts with the show instead of on the first note.
- Measured on this Mac, 60 seconds of constant MIDI with 40 slide changes, piano and keys picture on: median frame 8.3 ms, worst 17 ms, no frame over 20 ms, memory flat.
- `docs/SHOW_DAY.md`: a checklist for the day of the talk.

### Settings

- App settings (piano, keys picture, controller layout) are saved in `settings.json` in the app data folder and shared live between the editor and the stage window.

## 0.1.0

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
