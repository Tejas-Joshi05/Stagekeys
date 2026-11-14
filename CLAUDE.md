# Stagekeys

MIDI-controlled slide editor and live presenter (Electron + Vite + React + TypeScript). Used live on stage: **reliability beats features**. Read `docs/ARCHITECTURE.md` before changing structure.

## Hard rules

- **Git: commit and push only to `https://github.com/Tejas-Joshi05/Stagekeys`.** Never add or push to any other remote.
- TypeScript strict. No `any`. Zero lint errors, zero type errors.
- Every behaviour is a typed `Action` sent through `dispatch`. Keyboard shortcuts, MIDI mappings and UI buttons never trigger behaviour any other way.
- MIDI messages must never cause a React re-render per message. They go to the event bus; the render loop reads them. React views of MIDI are throttled.
- Main process stays thin: windows, dialogs, file I/O, displays, logging. Everything else is in the renderer.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. All IPC goes through the typed preload bridge and is zod-validated in main.
- Deck files: every schema change bumps `schemaVersion` and adds a numbered migration with a test and fixture. All writes are atomic (temp file, then rename).
- Never lose data silently. A failed save must be shown clearly.
- During a show nothing may open a dialog, steal focus or throw. Animation errors are caught, logged and that instance is skipped.
- Every animation cleans up its textures, listeners and timers.

## Workflow

- Tejas asked on 2026-11-13 to build continuously instead of stopping after each phase. Commit locally at sensible milestones; **do not push until he says so**.
- Before each commit: `pnpm check` and `pnpm test:e2e` pass, `CHANGELOG.md` updated, `docs/ARCHITECTURE.md` updated if the design moved.
- `docs/GUIDE.md` is the user guide to the whole app. Every feature added or changed updates it in the same commit (Tejas asked for this on 2026-11-15). The in-app help (`app/Help.tsx`) carries the essentials; keep the two in step.
- Big choices get a short record in `docs/decisions/NNNN-title.md`.
- Semantic versioning for the app, `schemaVersion` for decks.
- The show machine is macOS. Keep code cross-platform, but Windows is untested; say so instead of claiming it works.

## Commands

- `pnpm dev` — run the app with hot reload
- `pnpm check` — type-check, lint and unit tests (run before every commit)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — the three parts of `check`
- `pnpm test:e2e` — build, then run the Playwright Electron tests in `tests/e2e/`
- `pnpm format` — Prettier
- `pnpm build` — production build into `out/`
- `pnpm package` — unpacked app in `release/` (unsigned)
- `pnpm install-app` — package, ad-hoc sign, install to `/Applications` and link it on the Desktop (macOS). Rerun after changes.
- `pnpm icon` — re-render `build/icon.png` from `build/icon.svg`

Gotchas:

- VS Code terminals set `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node. Unset it before `pnpm dev` if the app does not open. The e2e tests strip it themselves.
- pnpm blocks install scripts by default. If `node_modules/electron/dist` is missing, run `node node_modules/electron/install.js`.
- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7 yet.
- Never reuse a `<canvas>` after destroying its Pixi renderer; it freezes the window. Mount a new canvas.
- Zustand selectors must return stable references. Wrap selectors that build arrays in `useShallow`.
- App settings (piano, keys picture, MPK layout, sound input) live in `settings.json` via main, not in decks. Change them with `updateSettings` from `shared/settings.ts`.
- Sound input: render loops read `audioInput.read()` (one measurement per frame, same object every time). Never set React state from it per frame; `AudioMeter` draws on a timer. Set the sensitivity with `setAudioSensitivity`, which applies at once and saves after a pause, so a knob does not write the settings file per message.
- The microphone prompt is a system dialog: `requestMicrophone` never raises it during a show. See `docs/decisions/0005-sound-input.md`.
- The Mapping tab turns on `controlPicker`: presses choose a control instead of firing mappings. Tests that need a mapping to fire must leave that tab or untick "Press a control to choose it".
- Riso artwork is imported with `?inline` on purpose (canvas readback from `file://`). Keep it that way.
- Never validate a settings patch with `.partial()` on a schema that has defaults: zod fills the defaults back in and the patch resets the group. Use `patchOf` in `src/ipc/settings.ts`.
- `STAGEKEYS_E2E_FAKE_MIC=1` (with `STAGEKEYS_E2E=1`) makes sound input open Chromium's fake microphone, which beeps about once a second, instead of being mocked. `tests/e2e/sound.spec.ts` uses it.
- E2E hooks: `STAGEKEYS_E2E=1` swaps dialogs for `STAGEKEYS_E2E_*` paths, uses mock MIDI and exposes `window.__stagekeysMidi(bytes)`. Sound input never opens a real device in e2e; feed it with `window.__stagekeysAudio({ level, bass, mid, treble })`.

## Folder map

```
src/main/        thin main process
src/preload/     the only bridge to the renderer
src/ipc/         IPC contract and app settings schema shared by main and renderer
src/renderer/
  app/           startup wiring, control-window action handlers, welcome screen, styles
  actions/       Action union, dispatcher, keyboard shortcuts
  midi/          devices, hot-plug, parsing, event bus, mock + virtual keyboard
  mapping/       MIDI -> action mappings, curves, zones, MIDI Learn
  deck/          schema, migrations, store, undo/redo commands, persistence
  editor/        slide list, canvas tools, properties panel, notes
  render/        PixiJS slide renderer shared by editor, stage and export
  animations/    registry, host, built-ins (one file each), riso art + glyph atlas
  audio/         optional piano (Web Audio), and sound input measured for animations
  presenter/     show engine, presenter view, transitions, rehearsal
  shared/        small utilities, settings store
tests/e2e/       Playwright Electron smoke tests
docs/            ARCHITECTURE.md, ADDING_ANIMATIONS.md, decisions/
```

Feature folders own their state, types, UI and tests, and are imported only through their `index.ts`.

## How to add X

- **An action**: add it to the union and schema in `actions/`, register a handler in the owning feature, add a test.
- **A deck schema change**: bump `schemaVersion`, add `deck/migrations/NNN-name.ts` with a test and fixture.
- **An animation**: one file in `animations/builtin/` plus one line in the registry. See `docs/ADDING_ANIMATIONS.md`.
- **An IPC call**: add it to `src/ipc/contract.ts`, handle and validate it in `src/main/ipc.ts`, expose it in the preload.
