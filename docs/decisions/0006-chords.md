# 0006: Chords fire on the completing key

Date: 2026-11-15

## Context

Tejas wants several keys held together to act as one control. The difficulty with chords is that the first key of a chord is indistinguishable from that key played alone until the others arrive.

## Decision

A chord fires the moment the note-on that completes it arrives. Nothing is delayed: single keys still act instantly, and the keys pressed on the way to a chord have already been seen on their own.

To keep that from being a nuisance:

- When a message completes a chord, only chord mappings fire for it (the largest, if several complete), not the single-key mapping of that key.
- "Only when no other key is held" is on by default, and the keys must land within 300 ms of each other by default. Both can be changed per chord.
- A key held for more than 15 seconds stops counting as an extra key, so one lost note-off cannot disable exact chords for the rest of a show.
- Keys are tracked per MIDI channel, so pad chords and key chords with the same note numbers stay apart.

## Rejected

Waiting a few tens of milliseconds after each key to see whether a chord follows. It would let a chord swallow its own keys, but it adds latency to every mapped key and every animation, and instant response matters more on stage.

## Consequences

A chord's keys should not have slide-changing mappings of their own: the first keys would fire before the chord completes. The changelog and show-day notes say so.
