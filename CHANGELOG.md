# Changelog

Stagekeys follows semantic versioning. Deck files carry their own `schemaVersion`.

## 0.5.2 (unreleased)

### Transitions live between the slides

- The slide list shows each transition as a chip between the two slides it joins: a symbol, the name and the length (`◐ Fade · 0.4 s`; a dashed `│ Cut` when there is none). Click it to change the transition in place, with the same settings as before and a line saying what it looks like. It used to be a section of the Properties panel, where it was hard to tell which two slides it was between.
- The transition still belongs to the slide it leads into, so it moves with that slide when slides are reordered. The first slide has no chip.
- "Use on every slide" is now **Use everywhere**, in the same place.

## 0.5.1

### Fixed

- **One press no longer skips several slides.** The MPK mini IV appears as three MIDI ports (MIDI, DAW and Software), and with "All devices" selected one key press could arrive more than once; the log showed two "next slide" actions a few milliseconds apart. Two guards now apply:
  - the same message arriving from a second port within 25 ms is treated as an echo and dropped;
  - a one-off action (next, previous, go to, black screen, panic, and the piano, sound input and keys picture switches) cannot fire twice from MIDI within 140 ms. This also covers a bouncing pad, two mappings that both match one press, and a key that is mapped on its own and is also part of a chord.

### Asking first

- **Quitting with a deck that was never saved to a file** now asks: Save…, Close Without Saving, or Cancel. Closing without saving keeps it as a draft on the welcome screen, as before. Decks that already have a file are autosaved on the way out and are not asked about. The question is never asked during a show.
- **Deleting a draft** from the welcome screen asks first, with Cancel as the default.

## 0.5.0

Deck schema is now version 4 (chord triggers, more transitions). Older decks open unchanged and are saved as version 4. A deck saved by 0.5.0 does not open in 0.4.0.

### Chords

- **Map a chord**: several keys (or pads) held together act as one control. In the Mapping tab choose "Map a chord", hold the keys, let go, and pick what the chord does. The keys can also be typed ("C4 E4 G4" or "60 64 67").
- A chord fires on the key that completes it, at once, so it adds no delay. Options per chord: **In any octave** (C + E + G wherever they are played), **Only when no other key is held** (on by default, so playing through a chord in the middle of something bigger does not fire it), and **Keys land within** so many milliseconds (300 by default; 0 lets you hold some keys and add the last one whenever you like).
- When a chord completes, the chord fires and the single-key mapping of its last key does not. If two chords complete on the same key, the bigger one wins. Keys pressed on the way to the chord have already done whatever they do on their own, so avoid giving a chord's keys their own slide-changing mappings.
- A chord of pads is kept apart from the same notes on the keys (they arrive on different channels).
- Chords appear in the presenter view's "On this slide" list like any other mapping, and how hard the chord is played can drive an animation.

### Easier to find your way

- **Help inside the app**: press **?** or F1, use the **?** in the toolbar, or Help › Stagekeys Help. It explains the four steps (build, plug in, map, present) and lists every keyboard shortcut for the show and the editor. It never opens during a show.
- **A full guide**: `docs/GUIDE.md` explains every feature and how to use it. It is kept up to date with each change.
- **An empty slide says what to add**, and the welcome screen says in three lines how the app is used.
- **Each transition is described in a sentence** under the menu.
- **Mapping tab**: "Map a run of keys" and "Map a chord" are proper buttons with a line saying when to use them.

### Transitions

- **Going back plays the transition in reverse.** Leaving slide 4 for slide 3 plays the transition slide 4 arrived with, backwards: a cover uncovers, a zoom pulls back, ASCII rain rises, an iris closes. (Before, going back played the destination slide's own transition.)

- **Five ASCII transitions**: the old slide breaks into character cells that flicker through glyphs while the new slide shows through, so ASCII artwork on both slides appears to retype itself. The patterns: **ASCII dissolve** (scattered), **ASCII wipe** (across), **ASCII typewriter** (row by row), **ASCII rain** (columns falling) and **ASCII iris** (opening from the centre). Going back through the deck runs each pattern the other way. Per slide you can set the character size and the character set (riso, code, dots, binary, slashes, blocks). Inks are chosen to show on each slide's background.
- **Three plain ones**: Dip to black, Slide up and Cover.
- **Use on every slide** puts the current slide's transition on the whole deck in one undoable step.
- The ASCII transitions draw on the GPU from pooled cells: nothing is allocated after the first, and their cells are built during the pre-show warm-up. Measured at 120 fps on the development Mac with 1,296 cells.

## 0.4.0

Deck schema is now version 3 (the planned talk length). Older decks open unchanged and are saved as version 3.

### Help while presenting

- **Talk countdown**: set the planned length in minutes in the toolbar (next to the display picker). The presenter view counts down beside the timer, turns rose for the last tenth of the talk (at least the last minute), and shows how far over you are once time is up. Leave it empty for no countdown.
- **Reveal counter**: on slides with a Text reveal or Step sequence, the presenter view shows "revealed 2 of 5", then "all 5 revealed", so you know how many key presses are left before moving on.
- **On this slide**: under the notes, a plain list of what the controller does on the slide being shown: this slide's mappings, what each animation reacts to (keys, knobs, wheels, sound), then the mappings that work everywhere.
- **Pre-show checks**: when a show starts, quiet notices say if no MIDI keyboard is connected, if slides react to sound while sound input is off or cannot hear anything, if the deck uses animations this version does not have, or if mappings point at things that no longer exist. They never stop the show.
- **Notes size**: A− and A+ in the presenter view; remembered.

### A clearer editor

- **The toolbar no longer hides Present.** It used to scroll sideways without showing it, so on a normal-sized window Present and the save status were cut off. Everything now fits on one row, and on a narrow window the show buttons move to a second row instead of disappearing. The sound, piano and keys buttons carry labels on a wide window, and the talk length box is labelled.
- **An animation's own settings come first.** Selecting an animation used to show position, size and twelve arranging buttons before anything about the animation. Its settings are now at the top; "Position and size" and "Arrange" are below and can be folded away (folded by default for animations; the choice is remembered). Text and shapes follow the same order: content first.
- **Settings are grouped under headings** ("Shape", "Ink", "When there is sound", "When you press a key") instead of one list of twenty fields, for the animations that have many.
- **Sliders** for every setting with a range, next to the number box, and for opacity.
- **The Add animation menu says what each one does** in a few words.

### New animations

- **Note trails**: a piano roll that draws itself as you play. Each key sends up a bar from its place along the edge for as long as it is held, and the bar drifts away when you let go. Colours run from low notes to high; harder hits can be brighter or wider; bars can travel up or down.
- **Glyph burst**: every key throws a handful of glyphs into the air from where that key sits, and they tumble and fall back. Harder hits throw more, further. A mapped pad sets one off too, and optionally so does a clap or a beat in the sound input.

## 0.3.0

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

- Sound input is tested end to end with Chromium's built-in fake microphone (open the device, measure it, hand it from the editor to the stage and back). Tejas has since confirmed it works with a physical microphone in the installed app on macOS. It has not been tried on Windows.

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
