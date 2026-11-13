# 0001: Electron with Web MIDI

Date: 2026-11-13. Status: accepted.

**Decision.** The app is an Electron app and reads MIDI through Chromium's Web MIDI API.

**Why.** Chromium's Web MIDI works on macOS and Windows with hot-plug events and no native module to compile. Tauri was ruled out because its macOS webview (WebKit) has no Web MIDI.

**Consequences.**

- Main grants only the `midi`, `midiSysex` and `local-fonts` permissions; everything else is denied. Chromium requests `midiSysex` even for plain MIDI access, so without it MIDI is unavailable.
- On Windows, many MIDI drivers allow a single client. Stagekeys is the only app listening during a show, so this is acceptable. Windows is untested.
- MIDI input sits behind a `MidiSource` interface, so a native backend or OSC can be added later without touching the rest.
