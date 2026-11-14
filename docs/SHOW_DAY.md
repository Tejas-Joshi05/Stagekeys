# Show day

What to do so the talk runs without surprises. Stagekeys guards against crashes and stalls; these steps cover what it cannot control.

## The day before

- Open the final deck and run one full **Rehearse** on the projector or a second screen. The report afterwards shows time per slide.
- Plug in the MPK mini, open the MIDI & sound tab and press a pad and turn a knob. If the keys picture does not light the right pad or knob, use **Teach the pads** / **Teach the knobs**.
- Type the slot length in minutes into the toolbar's talk length box. The presenter view then counts down and turns rose near the end.
- Decide on the piano sound now (⇧⌘P). It is remembered.
- If any slide reacts to sound: switch **Sound input** on in the MIDI & sound tab **in the installed app, before the show**, and allow the microphone when macOS asks. The stage never asks (that would be a dialog mid-show), and macOS may ask again after the app is reinstalled. Speak and watch the meter move, then set the sensitivity.
- Keep the deck's photos at normal sizes. Stagekeys shrinks anything over 3840 pixels, but smaller files load faster.

## At the venue

1. Turn on **Do Not Disturb** and quit other apps (notifications and other apps are the one thing Stagekeys cannot block).
2. Connect the projector **before** pressing Present, and check the toolbar's display picker shows it.
3. Plug in the MPK mini and check the toolbar says **MIDI connected**.
4. Press **Present**. The stage prepares every slide for about half a second (images decoded, shaders ready), then shows the first slide.
5. If slides react to sound, check the meter in the MIDI & sound tab moves when you speak. A louder room needs a stiffer sensitivity than your desk did; a knob mapped to "Set sound sensitivity" lets you change it mid-talk.
6. If sound should come from the venue speakers, choose the output in macOS Sound settings before presenting.

When the show starts, read any notices in the corner of the presenter view: they say if the keyboard is not connected or if sound-reactive slides will not hear anything. Under the notes, "On this slide" lists what each pad, knob and key does on the slide you are on.

## If something goes wrong

- **Keys stop doing anything**: the keyboard fallback always works (→ next, ← back, B black, H panic, Esc end). Unplugging and replugging the MPK reconnects it automatically.
- **Sound-reactive slides do nothing, or go wild**: the presenter view shows a "Sound in" meter and says if the input is blocked or missing. L switches sound input off and on. Too twitchy or too dull: change the sensitivity.
- **An animation looks stuck**: press **H** (panic). It resets the slide's animations and stays on the same slide.
- **The stage window is lost or black**: Stagekeys reloads it on the same slide by itself. Esc ends the show; Present starts it again where you were.
