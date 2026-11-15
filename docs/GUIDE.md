# Stagekeys guide

Stagekeys is a slide editor and presenter that you play from a MIDI keyboard. Keys, pads, knobs and chords change slides and drive animations; a microphone can drive them too. This guide covers everything the app does and how to use it.

It describes version 0.5.1. It is updated whenever a feature is added or changed. The same essentials are inside the app: press **?** (or F1, or the **?** button in the toolbar).

The app is built and tested on macOS with an Akai MPK mini. It should run on Windows (use Ctrl where this guide says ⌘), but that has not been tested.

## Contents

1. [The five-minute version](#the-five-minute-version)
2. [The editor](#the-editor)
3. [Slides and transitions](#slides-and-transitions)
4. [Animations](#animations)
5. [Mapping: what the controls do](#mapping-what-the-controls-do)
6. [Chords](#chords)
7. [Sound input](#sound-input)
8. [Piano sound and the keys picture](#piano-sound-and-the-keys-picture)
9. [Presenting](#presenting)
10. [Files, saving and backups](#files-saving-and-backups)
11. [Keyboard shortcuts](#keyboard-shortcuts)
12. [When something is not working](#when-something-is-not-working)

## The five-minute version

1. Open Stagekeys and choose **New deck**.
2. Add things to the slide from the toolbar: **Text**, a rectangle, an ellipse, a line, an **Image**, or an animation from **Add animation**.
3. Click anything on the slide to change it in the **Properties** tab on the right.
4. Plug in the MIDI keyboard. The toolbar shows **MIDI connected**. Play a key: animations on the slide react at once.
5. Open the **Mapping** tab, press a pad, and choose **Next slide**. Press another and choose **Previous slide**.
6. Press **Rehearse** to run the show with a timer, or **Present** to run it on the audience screen. **Esc** ends it.

## The editor

- **Toolbar** (top): new, open, save; undo and redo; the things you can add; the save status; piano, sound input and keys picture switches; MIDI status; help; the planned talk length; which screen the audience sees; Rehearse and Present.
- **Slide list** (left): click a slide to edit it. **+ Slide**, **Duplicate** and **Delete** are at the bottom.
- **Canvas** (middle): the slide. Click to select, drag to move, drag a handle to resize, drag the round handle to rotate. Double-click text to edit it. Guides appear when things line up. An empty slide says what to add.
- **Notes** (under the canvas): speaker notes for the slide. Only you see them, in the presenter view.
- **Right panel**, three tabs:
  - **Properties**: the selected thing, or the slide itself when nothing is selected.
  - **Mapping**: what the controller does.
  - **MIDI & sound**: the controller, piano sound, sound input, keys picture and a live monitor of incoming MIDI.

### Properties of a selected element

The element's own settings come first (text and font, shape colours, the animation's settings). Below are **Position and size** and **Arrange** (align, order, lock, hide), which fold away; the choice is remembered. Any setting with a range has a slider next to its number box.

With nothing selected, Properties shows the slide: its name, background colour, transition and **Layers**, where each element can be hidden or locked. Lock a full-slide element (such as an ASCII vignette) if it gets in the way of clicking what is under it.

## Slides and transitions

Each slide has a **Transition into this slide**: how it arrives when you move forward.

| Transition       | What it does                                                                  |
| ---------------- | ----------------------------------------------------------------------------- |
| Cut              | The new slide simply appears.                                                 |
| Fade             | The new slide fades in over the old one.                                      |
| Dip to black     | The old slide fades to black, then the new one fades in.                      |
| Slide sideways   | The new slide pushes the old one out sideways.                                |
| Slide up         | The new slide pushes the old one up and out.                                  |
| Cover            | The new slide slides in over the old one, which stays put.                    |
| Zoom             | The old slide grows and fades while the new one settles into place.           |
| ASCII dissolve   | The old slide breaks into scattered characters and the new one shows through. |
| ASCII wipe       | A ragged edge of characters sweeps across.                                    |
| ASCII typewriter | The slide is retyped row by row.                                              |
| ASCII rain       | Columns of characters fall, each starting at its own moment.                  |
| ASCII iris       | A ring of characters opens from the centre outwards.                          |

- **Duration** is in milliseconds. The ASCII transitions read best at 600 to 900.
- The ASCII transitions have two more settings: **Character size** and **Characters** (riso, code, dots, binary, slashes, blocks). They suit slides with ASCII animations on them: the artwork appears to retype itself.
- **Going back plays the transition in reverse.** If slide 4 arrives with ASCII rain, going back from slide 4 to slide 3 plays that rain backwards, so the slide leaves the way it came.
- **Use on every slide** gives the whole deck the current slide's transition, as one step you can undo.
- There is no preview in the editor. Use **Rehearse** to see transitions.

## Animations

Add one from **Add animation**; the menu says in a few words what each does. Select it to change its settings, and press **Test** to play it without a keyboard.

| Animation       | What it does                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ASCII garden    | Plants drawn in characters. Keys send ripples through them, held keys thicken the ink, pitch bend leans them, the mod wheel blows them about. A mapped trigger grows the next plant.                         |
| ASCII vignette  | A frame of characters around the slide, in a shape you choose (oval, circle, box, diamond, hexagon, triangle, star, heart, letterbox, curtains, corners). Sound moves the frame; keys leave their own marks. |
| Pressed flowers | Riso pressed flowers bloom where you play. Harder hits bloom bigger.                                                                                                                                         |
| Bloom           | A shape blooms outward on each note.                                                                                                                                                                         |
| Pulse           | A shape pulses on each note and settles back.                                                                                                                                                                |
| Ripple          | Rings spread from a point on each note.                                                                                                                                                                      |
| Text reveal     | Text appears word by word or letter by letter as you press keys.                                                                                                                                             |
| Step sequence   | A diagram revealed one step per key press.                                                                                                                                                                   |
| MIDI readout    | Shows the two numbers a key sends: which key, and how hard.                                                                                                                                                  |
| Note trails     | A piano roll that draws itself as you play.                                                                                                                                                                  |
| Glyph burst     | Each key throws a handful of characters into the air. A clap or beat can too.                                                                                                                                |

### Which keys an animation listens to

In the animation's settings, **Reacts to keys › Which keys** decides which keys it reacts to:

- **Any key that is not mapped to something else** (the default). A key mapped to "Next slide" does not also set off animations.
- **Keys in a zone**: a named stretch of the keyboard, made in the Mapping tab under **Keyboard zones**.
- **Keys in a note range**.
- **Only keys mapped to it**: it ignores playing and reacts only to a mapping that triggers it.

### Bindings: let a control or sound drive a setting

Under **MIDI and sound bindings**, **Add binding** ties one of the animation's settings to a source, continuously:

- Velocity (how hard), a knob or CC, pitch bend, the note played.
- Sound: loudness, bass, middle, treble, or beats.

Each binding has a range and a response curve. Example: bind **Sound: loudness** to Bloom's size and the shape swells as you speak.

### The ASCII vignette in detail

It reacts to sound and to keys in different ways, on purpose:

- **Sound makes it**: breathe, close in, open up, shiver, work as an equaliser, or do nothing. **Beat kick** adds a jolt on claps and beats.
- **A key press makes it**: bite where the key sits, ripple, flash, iris, or do nothing.

If a deck has a vignette that reacts to sound and sound input is off, the show says so quietly when it starts. Set "Sound makes it" to "do nothing" if you do not want sound.

## Mapping: what the controls do

Open the **Mapping** tab. It shows your controller.

1. Press a pad, key or knob, or click one on the picture. (While "Press a control to choose it" is ticked, pressing a control selects it instead of doing its job. Untick it to try your mappings in the editor.)
2. Choose what it does.

What a control can do:

| Action                                 | Notes                                                       |
| -------------------------------------- | ----------------------------------------------------------- |
| Next slide, Previous slide             |                                                             |
| Go to slide number, Go to named slide  | Name slides in Properties.                                  |
| Black screen toggle                    |                                                             |
| Panic / home                           | Clears black, resets animations, stays on the slide.        |
| Trigger animation                      | Plays one animation; how hard you hit can set its strength. |
| Set animation parameter                | Best on a knob: turns one setting of one animation.         |
| Piano sound on/off, Sound input on/off |                                                             |
| Set sound sensitivity                  | Best on a knob.                                             |
| Show or hide the keys picture          |                                                             |

- **Every slide** or **This slide only**: the two buttons at the top. A mapping for this slide only wins over one for every slide.
- A knob that sets a value moves smoothly; a knob given a one-off action fires once as it passes halfway.
- **More options** on a mapping: what exactly fires it (note on, note off, a knob rising above or falling below a point, the sustain pedal, a chord), which keys, how hard, which channel and device, and the response curve.
- **Map a run of keys** makes one mapping for a stretch of the keyboard.
- **Keyboard zones** name parts of the keyboard, for animations to listen to.
- **Export mappings** and **Import mappings** move the every-slide mappings and zones between decks.

In an animation's settings, **Map a specific key to trigger this…** makes a mapping that triggers that animation and waits for you to press the key.

## Chords

Several keys or pads held together can act as one control.

1. In the Mapping tab choose **Map a chord**.
2. Hold the keys together, then let go. The chord is shown as you play it.
3. Choose what the chord does.

You can type the keys instead: `C4 E4 G4`, `c4, eb4, g4` or `60 64 67`.

A chord fires on the key that completes it, at once. Per chord:

- **In any octave**: C + E + G wherever they are played.
- **Only when no other key is held** (on to begin with), so a chord inside something bigger does not fire.
- **Keys land within**: how close together the keys must go down, in milliseconds (300 to begin with). 0 means any time: hold some keys and add the last when you like.

Good to know:

- When a chord completes, the chord fires and the single-key mapping of its last key does not. If two chords complete on the same key, the bigger one wins.
- The keys pressed on the way to a chord have already done whatever they do alone. Do not give a chord's keys their own slide-changing mappings.
- A chord on the pads is separate from the same notes on the keys.

## Sound input

Animations can react to a microphone or line input. The sound is only measured; it is never recorded, played or sent anywhere.

- Switch it on in **MIDI & sound › Sound input**, with the microphone button in the toolbar, or with ⇧⌘L. macOS asks for permission the first time. Do this before a show: Stagekeys never raises that question during one.
- The meter shows overall loudness, low, middle and high, and a lamp for beats.
- **Sensitivity** runs from stiffest (only loud sound moves anything, slowly) to most sensitive (a whisper fills the meter, instantly). A loud room needs a stiffer setting than your desk.
- **Input** chooses the device.
- Map a knob to **Set sound sensitivity** to change it mid-talk.

Only the window running the show listens: the editor while editing, the audience screen during a show.

## Piano sound and the keys picture

- **Piano sound** (MIDI & sound tab, toolbar, ⇧⌘P): the keyboard plays a piano through the computer. Three sounds: Felt, Grand, Electric. Keys that do something (such as next slide) can stay silent, and pads can play notes too.
- **Keys picture** (toolbar, ⇧⌘K): a small picture of the controller that lights up as you play. It can be shown in the editor and presenter view, on the audience screen, or both, in any corner.
- **Your MPK mini** (MIDI & sound tab): if the picture lights the wrong pad or knob, use **Teach the pads** and **Teach the knobs**, and set the pad channel and where the keys start.

## Presenting

- **Talk length**: type the planned minutes in the toolbar. Leave it empty for no countdown.
- **Display picker**: choose the audience screen. Connect the projector before pressing Present.
- **Rehearse** runs the show with a timer and afterwards reports how long each slide took. **Present** is the real thing.

When a show starts, the audience screen prepares every slide for a moment, then shows the first. Your screen becomes the **presenter view**:

- The current and next slide, a timer, and a countdown that turns rose near the end and shows how far over you are.
- Your notes, with **A−** and **A+** to change their size.
- **Reveal counter** on slides with a Text reveal or Step sequence: "revealed 2 of 5".
- **On this slide**: what each pad, key, knob and chord does on the slide being shown.
- MIDI status, the sound input meter, and switches for the keys picture, piano and sound input.
- Quiet notices if something needs attention: no keyboard connected, sound-reactive slides with sound input off, mappings that point at things that no longer exist. They never stop the show.

During a show nothing opens a dialog or steals focus. If an animation fails, it is skipped and the show carries on. If the audience window is lost, it reloads on the same slide.

`docs/SHOW_DAY.md` is a checklist for the day before and the venue.

## Files, saving and backups

- A deck is a `.stagekeys` bundle: the deck, its images and its backups together.
- **Save** (⌘S) and **Save As** (⇧⌘S). The toolbar shows the save status. A failed save is shown clearly.
- **Autosave** writes about every 5 seconds when something has changed.
- **Backups**: a timestamped copy is kept inside the deck on open and every couple of minutes; the newest 20 are kept. If a deck cannot be opened, Stagekeys offers its backups.
- **Drafts**: a new deck you have edited but never saved is kept and listed on the welcome screen until you delete it. Deleting a draft asks first; it cannot be undone.
- **Quitting**: if the deck has never been saved to a file, Stagekeys asks whether to save it, close anyway (it stays as a draft) or cancel. Decks that have a file are saved on the way out without asking.
- **Export**: File › Export Slides as PNG or as PDF, as a fallback if you ever have to present without Stagekeys.
- Decks from older versions open and are upgraded when saved. A deck saved by a newer version does not open in an older one; the app says so and leaves the file alone.
- Fonts that come with Stagekeys work everywhere. A font installed only on your Mac will be replaced on another machine.

## Keyboard shortcuts

### During a show

These always work, even with the MIDI keyboard unplugged.

| Key                       | Does                                                       |
| ------------------------- | ---------------------------------------------------------- |
| → ↓ Space Enter Page Down | Next slide                                                 |
| ← ↑ Backspace Page Up     | Previous slide (its transition plays in reverse)           |
| Home                      | First slide                                                |
| B or .                    | Black screen on or off                                     |
| H                         | Panic: clears black, resets animations, stays on the slide |
| K                         | Keys picture                                               |
| P                         | Piano sound                                                |
| L                         | Sound input                                                |
| Esc                       | End the show                                               |

### While editing

| Key                | Does                                                 |
| ------------------ | ---------------------------------------------------- |
| ⌘N, ⌘O             | New deck, open                                       |
| ⌘S, ⇧⌘S            | Save, save as                                        |
| ⌘Z, ⇧⌘Z            | Undo, redo                                           |
| ⌘C, ⌘X, ⌘V         | Copy, cut, paste                                     |
| ⌘D                 | Duplicate the selection                              |
| ⌘A, Esc            | Select everything, select nothing                    |
| Arrows, ⇧Arrows    | Nudge by 1, by 10                                    |
| ⌘], ⌘[             | Bring forward, send backward (add ⇧ for all the way) |
| Delete             | Remove the selection                                 |
| ⌘M                 | New slide                                            |
| Page Down, Page Up | Next slide, previous slide                           |
| ⌘↩, ⇧⌘↩            | Present, rehearse                                    |
| ⇧⌘K, ⇧⌘P, ⇧⌘L      | Keys picture, piano sound, sound input               |
| ⇧⌘F                | Frames-per-second overlay                            |
| ? or F1            | Help                                                 |

## When something is not working

- **One press does something twice, or skips slides**: Stagekeys ignores the same press arriving on a second port and will not repeat a one-off action within about a seventh of a second. If it still happens, choose one port under MIDI & sound › Device (for the MPK mini IV, "MPK mini IV MIDI Port") instead of all devices.
- **Keys do nothing in a show**: use the computer keyboard (→, ←, B, H, Esc). Unplugging and replugging the controller reconnects it by itself.
- **A mapping does not fire in the editor**: on the Mapping tab, untick "Press a control to choose it".
- **A chord does not fire**: let go of every other key or pad (or untick "Only when no other key is held"), and press the keys closer together (or raise "Keys land within").
- **Sound-reactive slides do nothing**: check sound input is on and the meter moves. If it says blocked, allow the microphone for Stagekeys in System Settings › Privacy & Security. macOS may ask again after the app is reinstalled.
- **Sound-reactive slides are too twitchy or too dull**: change the sensitivity.
- **An animation looks stuck**: press H.
- **I cannot click something on the slide**: a full-slide element is on top. Lock or hide it under Layers.
- **The log**: Help › Open Log Folder.
