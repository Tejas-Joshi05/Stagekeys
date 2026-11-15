# Stagekeys architecture

Status: **approved and implemented** (2026-11-13, updated 2026-11-14 for 0.4.0). Keep this file up to date when the design moves.

Stagekeys is a slide editor and live presenter driven by a MIDI keyboard. It is used live on stage, so every design choice below prefers reliability over features.

## Confirmed decisions

| Topic        | Decision                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------- |
| Show machine | macOS. Code stays cross-platform, but Windows is **untested** until someone runs it there.    |
| MIDI sharing | Stagekeys is the only app listening to the keyboard during a show.                            |
| Text         | One style per text box. Rich runs can be added later through a schema migration.              |
| Git          | Commit and push only to `github.com/Tejas-Joshi05/Stagekeys`. One commit per confirmed phase. |

## Stack

Electron, Vite (via `electron-vite`), React, TypeScript strict, Zustand + Immer, zod, PixiJS v8, Vitest, Playwright, ESLint + Prettier, pnpm, `electron-builder` for packaging. Versions are the latest stable at scaffold time and pinned by the lockfile.

One extra dependency: `pdf-lib` for PDF export. Logging and ids are small in-house modules (`src/main/log.ts`, `shared/util.ts`), so there is less third-party code in the show path.

## Processes and windows

```
Main process (thin)
  windows, menus, dialogs, displays, file I/O, logging, sleep blocker
        |  typed preload bridge (contextIsolation, sandbox, no nodeIntegration)
        |
  +-----+--------------------+        relayed by main        +----------------------+
  | Control window           | <---------------------------> | Stage window         |
  | editor, then presenter   |   actions, show state, MIDI   | fullscreen, audience |
  | view during a show       |   monitor feed (throttled)    | owns the show engine |
  +--------------------------+                               +----------------------+
```

- **Control window**: the editor. When a show starts it switches to the presenter view (current slide, next slide, notes, timer, clock, MIDI monitor, device status).
- **Stage window**: fullscreen on the chosen display. During a show it **owns the show engine**: a frozen copy of the deck, MIDI input, the mapping engine, show state and the render loop.

Why the stage window owns the show: it is the one the audience sees. If the presenter view crashes or hangs, MIDI still drives the slides. The presenter view is only a subscriber, and keyboard fallback keys pressed in either window are sent to the stage as actions.

The two windows exchange small zod-validated messages that main relays (`show:message`). Nothing time-critical crosses that link: MIDI, mappings and rendering all happen inside the stage window. Main reads the slide index from the stage's status messages, so if the stage renderer dies main reloads it on the same slide. See `docs/decisions/0002-stage-window-owns-the-show.md`.

While editing, the control window owns MIDI (monitor, MIDI Learn, live preview). MIDI ownership passes to the stage window when a show starts and returns when it ends.

## Folder structure

```
src/
  main/                 thin main process
    index.ts            app lifecycle, single-instance lock
    windows.ts          control + stage windows, display selection
    ipc.ts              zod-validated IPC handlers
    deckFiles.ts        atomic writes, backups, recovery, asset copy
    menu.ts  log.ts  showSafe.ts
  preload/
    index.ts            the only bridge; exposes window.stagekeys
  ipc/
    contract.ts         channel names + request/response types shared by main and renderer
    settings.ts         app settings schema (piano, keys picture, controller profile)
  renderer/
    app/                shell, layout, error boundaries, routes (editor, presenter, stage)
    actions/            Action union, zod schema, dispatcher, keyboard shortcuts
    midi/               device access, hot-plug, parsing, event bus, input state, mock + virtual keyboard
    mapping/            mapping model, matching, curves, zones, MIDI Learn, import/export
    deck/               schema, migrations, store, commands (undo/redo), persistence client
    editor/             slide list, canvas tools, properties panel, notes
    render/             PixiJS slide renderer shared by editor, thumbnails, stage, export
    animations/         registry, host, built-ins (one file each), riso artwork and glyph atlas
    audio/              the optional piano (Web Audio voices), and sound input measured for animations
    presenter/          show engine, presenter view, transitions, rehearsal
    shared/             small utilities, the settings store
tests/
  e2e/                  Playwright Electron smoke tests
docs/
  ARCHITECTURE.md  ADDING_ANIMATIONS.md  decisions/
```

Each feature folder owns its state, types, UI and tests, and exports through an `index.ts`. Features import each other only through those index files. ESLint enforces the boundaries.

`actions/` is one folder more than the brief listed. The action system is central and belongs to no single feature, so it gets its own home instead of living in `shared/`.

## Action system

Every user-invocable thing is a typed `Action`, a discriminated union with a matching zod schema (mappings store actions in JSON, so they must validate).

```ts
type Action =
  | { type: 'nav.next' } | { type: 'nav.prev' }
  | { type: 'nav.goto'; index: number } | { type: 'nav.gotoNamed'; slideId: string }
  | { type: 'show.blackToggle' } | { type: 'show.panic' }
  | { type: 'anim.trigger'; elementId: string; value?: number }
  | { type: 'anim.setParam'; elementId: string; param: string; value: number }
  | { type: 'edit.undo' } | { type: 'edit.redo' } | ...   // editor and file actions
```

`dispatch(action, source)` is the single entry point, where `source` is `'keyboard' | 'midi' | 'ui' | 'system'`. Keyboard shortcuts, MIDI mappings and buttons are all just tables that produce actions. Handlers are registered by the feature that owns the behaviour. Every handler runs inside a try/catch that logs and never throws.

Deck edits (move, resize, retype) are **commands** inside `deck/`. Actions such as `edit.undo` or `edit.delete` invoke them. Continuous gestures such as a drag produce one coalesced command.

`show.panic` returns to a calm state: black screen off, all animations reset, transitions cancelled. It stays on the current slide, because losing your place mid-talk is worse than a stuck animation. `Home` goes to the first slide.

## Data model

Deck bundle on disk:

```
MyTalk.stagekeys/
  deck.json             the document, schemaVersion at the top
  assets/               images, named by content hash
  backups/              deck-<timestamp>.json, last 20 kept
```

Every deck lives in a bundle from the moment it is created. A new deck starts as a **draft** bundle in the app data folder (`drafts/`), so autosave and image import always have somewhere to write. Save As copies the bundle to the chosen location and removes the draft. Drafts that were edited but never saved are listed on the welcome screen.

```ts
Deck     { schemaVersion, meta, slides[], mappings[], zones[], assets }
Meta     { title, created, updated, canvas: { width: 1920, height: 1080 }, targetMinutes }
Slide    { id, name, background, elements[], notes, transition, mappings[] }
Element  = Text | Shape(rect | ellipse | line) | Image | Animation
           common: { id, name, x, y, width, height, rotation, opacity, locked, hidden }
Animation element { animationId, params, bindings[] }   // bindings: MIDI or sound source -> param, with curve and range
Mapping  { id, trigger, filters, action, curve?, enabled }
Zone     { id, name, colour, fromNote, toNote }
Asset    { id, file, mime, width, height }
```

**Load pipeline**: read JSON, read `schemaVersion`, run numbered migrations up to current, then zod-parse. Each migration is `(older: unknown) => newer` in its own file with its own test and a fixture deck. A deck from a newer app version is refused with a clear message and is never overwritten.

**Undo/redo**: each command is applied with Immer and stores its patches and inverse patches. History holds patches, not deck snapshots.

**Saving**:

- All writes go through main, serialised per deck, and are atomic: write a temp file in the same folder, fsync, rename.
- Autosave writes `deck.json` about every 5 seconds when the deck has changed.
- A timestamped backup is written on open and every couple of minutes while editing. The newest 20 are kept.
- Unsaved new decks autosave to their draft bundle. On launch, edited drafts are offered on the welcome screen. A draft that was never edited is removed when you move on.
- If `deck.json` cannot be read or parsed, the app offers the deck's backups instead of failing.
- Closing the window flushes pending saves first; if that fails you are asked before anything is lost.
- A failed save shows a persistent, clear error in the editor and keeps retrying. It is never swallowed.

## MIDI

```
Web MIDI -> parser -> event bus (ring buffer, no React) -> mapping engine -> dispatch(Action)
                              |                                 |
                              +-> input state (held notes, CCs, pitch bend, sustain)
                                        read by the render loop each frame
```

- The parser turns raw bytes into typed messages: note on/off (velocity 0 note-on becomes note-off), CC, pitch bend, sustain from CC 64.
- The bus is a plain emitter plus a ring buffer. Nothing in it touches React. Discrete actions such as "next slide" fire immediately on message arrival; continuous values land in the input state that the render loop reads in `requestAnimationFrame`.
- The MIDI monitor panel reads the ring buffer on a timer, about 10 times a second.
- Hot-plug uses the Web MIDI `statechange` event. A lost device raises a small non-blocking warning. Reconnection matches on device name and manufacturer, because ids can change after a replug.
- `MidiSource` is an interface with two implementations: Web MIDI and a mock. The mock feeds tests, the dev virtual keyboard and the Playwright smoke test.
- Latency is measured in dev mode from the MIDI message timestamp to the frame that first shows its effect.

**The MPK mini IV**: `midi/controller.ts` names each message's physical control (key, pad, knob, wheel, pedal) using the controller profile from settings: pads are notes on the pad channel, knobs are the profile's eight CCs. The keys picture (`midi/keysOverlay.ts`) is a plain canvas that redraws only when `MidiInputState.version` changes; the stage draws its own copy, and the presenter view draws a mirror fed by the stage's 10 Hz status message.

**Mapping editor**: the Mapping tab shows the controller. While it is open, a `ControlPicker` sits in the mapping engine ahead of the mappings: a press chooses that control in the editor and does nothing else. The editor polls the picker at 10 Hz, so no React render happens per message.

**Piano**: `audio/` subscribes to the bus after the mapping engine, so it can tell keys that triggered a mapping and keep them silent. It runs in whichever window owns MIDI, so it never doubles.

**Sound input**: `audio/input.ts` opens a microphone or line input into an analyser (never to the speakers, never recorded). `audio/levels.ts` shapes the raw loudness into level, bass, mid, treble and beat, each 0..1, according to one sensitivity setting. Render loops call `audioInput.read()`, which measures at most once per frame and returns the same mutable object; nothing renders in React per frame. Only the window that owns the show listens: the editor while editing, the stage during a show. See `docs/decisions/0005-sound-input.md`.

**Mapping resolution**: a message is matched against the current slide's mappings first, then global ones. If a per-slide mapping matches, global mappings for that same trigger are skipped.

**One press, one action**: `MidiService` drops a message whose exact bytes arrived from a different port within 25 ms (multi-port keyboards echo), and the mapping engine will not dispatch the same one-off action type (navigation, toggles) twice within 140 ms.

**Chords**: a `chord` trigger names two to ten notes. The mapping engine keeps a `ChordTracker` (which keys are down and since when, per channel; two typed arrays, no allocation per message) and a chord fires on the note-on that completes it, so there is no added latency. A completed chord takes precedence over single-key mappings matched by the same message, and the largest chord wins. Chord learning (`LearnSession.startChord`) gathers keys held together and finishes when they are all released; the editor polls it on a timer. See `docs/decisions/0006-chords.md`.

**Transitions**: `presenter/transitions.ts` is pure: poses for the slides that move (fade, dip, slide, slide up, cover, zoom) and, for the ASCII kinds, the order and look of each cell (`cellDelay`, `cellProgress`, `tileAlpha`, `glyphAlpha`, `glyphIndex`). `presenter/GlyphTransition.ts` draws the ASCII kinds: the outgoing slide is rendered once into a texture and destroyed; a pooled `ParticleContainer` of tiles shows that texture cell by cell over the live incoming slide, with a second container of glyph particles on top. Cells that are not turning are not touched. The pool is rebuilt only when the grid or character set changes, and is built ahead of time in `warmUp`. If anything fails, the slide cuts. Going back through the deck plays the transition of the slide being left in reverse: the same pose function run from 1 to 0 with the two slides in each other's roles, and for the ASCII kinds the cell order reversed.

## Rendering

One PixiJS renderer in `render/` turns a `Slide` into a scene, reconciling elements by id. It is used in four places: the editor canvas, thumbnails, the stage, and PNG/PDF export. What you edit is what you present.

- Editor selection handles, guides and snapping are an overlay on top of the shared scene.
- Text is rendered by Pixi. While a text box is being edited, a DOM text area is placed exactly over it and the result is written back on commit. Building a caret and selection inside WebGL would be fragile, so I am not doing that.
- Images are read by main (`asset:read`, restricted to the deck's `assets/` folder) and turned into textures in the renderer. No custom protocol is needed.
- The renderer always works in slide coordinates; only its resolution changes with the window size, so text stays sharp.
- A destroyed WebGL context cannot be reused, so each renderer gets its own `<canvas>` element.
- WebGL context loss is handled by rebuilding the scene from the deck.

## Animations

Each animation is one file exporting a definition, registered in one list:

```ts
defineAnimation({
  id, name, description,
  params: z.object({...}),          // defaults live in the schema; the properties panel is generated from it
  inputs: ['trigger', 'audio'],     // what it reacts to: MIDI inputs and/or sound
  setup(ctx)   -> state,            // ctx gives a root container and tracked resource helpers
  update(state, frame, inputs),
  teardown(state),
})
```

The riso animations (ASCII garden, Pressed flowers) use artwork bundled inline (`animations/assets/`, decoded at startup by `preloadArt`). The ASCII garden samples an ink-density map into a small canvas about 30 times a second and draws one GPU particle per glyph cell from a shared glyph atlas, two particle containers for the two inks. Shared artwork textures live for the whole app, so no instance can destroy a texture another is drawing with.

The ASCII vignette uses the same glyph particles for a frame around the slide. It is the model for reacting to two sources differently: sound (`inputs.audio`) moves the whole shape, while keys leave local marks in their own ink. It only writes the cells whose glyph changed.

Animations that are stepped through with key presses (Text reveal, Step sequence) also define `progress(state)`. The stage adds it up for the current slide and sends it in its 10 Hz status message, so the presenter view can show how many presses are left. `listensToSound(params)` lets the pre-show check know that an animation moves to sound by itself.

The animation host owns each instance's root container and destroys it with all children on slide change, whether or not `teardown` behaved. `setup`, `update` and `teardown` are each wrapped: an error is logged, that instance is switched off, and the show carries on.

## Settings

App settings (piano, keys picture, controller profile, sound input) live in `settings.json` in the app data folder, owned by main, written atomically, and broadcast to both windows on every change. They are about the machine and the controller, not the talk, so they are not in decks. See `docs/decisions/0004-app-settings-and-controller-profile.md`.

## Presenter view

Besides the slides, notes, timer and MIDI state, the presenter view shows a countdown against `meta.targetMinutes` (`presenter/preflight.ts`, `talkClock`), the reveal counter, and "On this slide": what the controller does on the slide being shown, built from the deck by `presenter/cheatSheet.ts` (mappings are put into words by `mapping/describe.ts`, which the mapping panel shares). When a show starts, `preflight` looks at the deck, MIDI and sound input and reports problems as notices. All of it is derived from the deck and the stage's status message; nothing here can hold up or stop the show.

## Show-safe mode

- Animation and action errors are caught and logged, never thrown.
- Main refuses to open any dialog while a show is active. Problems appear as quiet notices in the presenter view only.
- `powerSaveBlocker` keeps the display awake.
- Keyboard fallback (arrows, space, Esc) is handled independently of MIDI.
- Background throttling is off for both windows.
- If the stage renderer dies, main recreates it at the last slide.
- Before the first slide the stage preloads every image (capped at 3840 px) and draws each slide once into an off-screen texture, so shaders compile and textures upload before the audience sees anything (`StagePlayer.warmUp`, bounded to 4 s).

## Security

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict CSP, navigation and new windows denied, and a permission handler that allows only MIDI, local fonts and audio capture (never video). Every IPC payload is validated with zod in main. The preload exposes a small typed API and nothing else.

## Extension points (not built in v1)

- `MidiSource` is the template for other inputs: OSC in and webcam would each feed the same bus and input state. (Audio analysis is built: see Sound input above. It has its own levels object rather than going through the MIDI bus, because it is continuous, not a stream of events.)
- An `OutputSink` interface is reserved for MIDI out and OSC out, driven by the same actions.
- New element types are a new member of the `Element` union plus a renderer entry.

## Things I cannot fully guarantee

- **OS interruptions.** I can stop Stagekeys from opening dialogs, but not macOS notifications or other apps taking focus. Turn on Do Not Disturb and quit other apps before a show.
- **System fonts are not portable.** A deck using a font installed only on your Mac will fall back on another machine. Bundled fonts are always safe, and the editor will warn when a deck uses a non-bundled font.
- **60fps depends on the GPU.** I will measure against the budget on this Mac and report real numbers, not assume them.
- **Windows is unverified.** See the table at the top.
- **Unsigned builds.** The packaged app will not be code-signed or notarised, so it is meant to be built and run on your own machine.
- **Time.** The talk is 22 days away. The phase order stands, but I suggest we aim to finish phase 7 by about 28 November so the last week is rehearsal only, with no new features.
