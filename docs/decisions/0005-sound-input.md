# 0005: Sound input is measured in the renderer and shaped by one sensitivity setting

Date: 2026-11-14. Status: accepted.

## Context

The talk needs visuals that react to sound (a voice, the room, music) as well as to the keyboard, and the two must feel different. The response has to be adjustable from "twitches at a whisper" to "barely moves", including live from a knob.

## Decision

- `audio/input.ts` opens a microphone or line input with `getUserMedia` and connects it to an `AnalyserNode` and nothing else. Sound is never recorded, played back or sent anywhere.
- `audio/levels.ts` turns raw loudness into five numbers from 0 to 1 (level, bass, mid, treble, beat). It is plain arithmetic with no Web Audio in it, so it is unit-tested and the same code shapes real and injected sound.
- One setting, `audioInput.sensitivity` (0 stiffest to 1 most sensitive), sets gain (1x to 1000x), the noise gate, attack, release and how easily a beat fires. One slider is easier to ride on stage than five.
- Render loops read `audioInput.read()`, which measures at most once per frame and returns the same mutable object. As with MIDI, no React render happens per frame; meters draw on a timer.
- Animations receive the levels as `inputs.audio`, and any numeric parameter can be bound to a level (`audioLevel`, `audioBass`, `audioMid`, `audioTreble`, `audioBeat`). The new binding sources and the two new actions are stored in decks, so the deck schema went to version 2.
- Only one window holds the device: the editor while editing, the stage during a show.
- Main allows the `media` permission for audio only (never the camera). The macOS microphone prompt is a system dialog, so `requestMicrophone` never raises it during a show: access must be granted once from the editor beforehand.

## Consequences

- Sound input is off by default and a deck without sound bindings behaves exactly as before.
- A deck saved by 0.3.0 does not open in 0.2.0, which reports it as coming from a newer version.
- An ad-hoc signed build gets a new identity each time it is rebuilt, so macOS may ask for the microphone again after `pnpm install-app`. Check it before a show (see `docs/SHOW_DAY.md`).
- The piano's sound reaches the microphone through the speakers, so playing with the piano on moves audio-reactive animations too. That is intended; turn the sensitivity down or use a line input if it is too much.
- Not verified on Windows.
