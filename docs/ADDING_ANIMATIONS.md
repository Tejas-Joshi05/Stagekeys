# Adding an animation

An animation is one file plus one line in the registry. The editor controls, MIDI bindings, error isolation and cleanup all come for free.

## 1. Create the file

`src/renderer/animations/builtin/sparkle.ts`:

```ts
import { Graphics } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';

export const sparkle = defineAnimation({
  id: 'sparkle', // saved in decks: never change it once released
  name: 'Sparkle',
  description: 'A dot flashes on each note.',
  inputs: ['trigger', 'velocity'], // shown to the user; documents what drives it
  defaultSize: { width: 300, height: 300 },

  // Every parameter needs a default. The properties panel is generated from this.
  params: z.object({
    colour: param.colour('Colour', '#ffffff'),
    size: param.number('Size', 0.5, 0.05, 1),
    fade: param.number('Fade time (s)', 0.4, 0.05, 5),
  }),

  // Build display objects once. Add them under ctx.root.
  setup(ctx) {
    const dot = new Graphics();
    dot.position.set(ctx.width / 2, ctx.height / 2);
    ctx.root.addChild(dot);
    return { dot, energy: 0, radius: Math.min(ctx.width, ctx.height) / 2 };
  },

  // Called every frame. `inputs.params` already has MIDI bindings applied.
  update(state, frame, inputs) {
    const p = inputs.params;
    for (const trigger of inputs.triggers) state.energy = Math.max(state.energy, trigger.value);
    state.energy = Math.max(0, state.energy - frame.dt / p.fade);
    state.dot
      .clear()
      .circle(0, 0, state.radius * p.size)
      .fill({ color: hexToNumber(p.colour), alpha: state.energy });
  },

  // Free anything that is not under ctx.root and was not registered with ctx.own().
  teardown() {},

  // Optional: what thumbnails and the PNG/PDF export should show.
  showFinal(state, p) {
    state.dot
      .clear()
      .circle(0, 0, state.radius * p.size)
      .fill({ color: hexToNumber(p.colour) });
  },
});
```

## 2. Register it

In `src/renderer/animations/registry.ts`, import it and add it to `ALL`. That is the only other change. It now appears in the toolbar's Animation menu.

## Parameters

Use the `param` helpers so the editor knows which control to show:

| Helper                                          | Control                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `param.number(label, default, min, max, step?)` | number field; can be bound to MIDI       |
| `param.integer(label, default, min, max)`       | whole-number field; can be bound to MIDI |
| `param.boolean(label, default)`                 | checkbox                                 |
| `param.colour(label, '#rrggbb')`                | colour picker                            |
| `param.choice(label, [...options], default)`    | dropdown                                 |
| `param.text(label, default)`                    | multi-line text                          |
| `param.font(label, default)`                    | font picker                              |

Only numeric parameters can be bound. A binding follows velocity, a CC knob, pitch bend, note pitch, or the sound input (loudness, bass, middle, treble, beats).

## Fitting the slide it lands on

Optional `paramsFor({ dark })` returns starting values for a newly placed instance, picked from the slide's background. The ASCII garden uses it to print cream ink that glows on dark slides and keep the website's olive-on-cream riso look on light ones.

## Artwork

Images an animation samples or draws live in `animations/assets/` and are listed in `art.ts`. They are imported with `?inline`, so reading their pixels back from a canvas is allowed even from `file://` in the packaged app. `preloadArt()` decodes them all at startup, so the first frame on stage, thumbnails and exports never show an empty animation.

## What `update` receives

- `frame.dt` and `frame.time` in seconds. `dt` is capped at 0.1 s, so a stall never causes a jump.
- `inputs.triggers`: one entry per "go" this frame, each with `value` (0..1) and `note` (or `null` for a mapped trigger). A trigger is a key press that passed the element's "Reacts to keys" filter and was not used by a mapping, or an `anim.trigger` action.
- `inputs.releases`, `inputs.held`, `inputs.cc(n)`, `inputs.pitchBend`, `inputs.sustain` for anything continuous.
- `inputs.audio`: the sound input this frame, `{ active, level, bass, mid, treble, beat }`, each 0..1 and already shaped by the app's sensitivity setting. All zero while sound input is off, so an animation can read it without checking. List `'audio'` in `inputs` if you use it. `asciiVignette.ts` shows one way to make sound and keys do different things.

## Rules

1. **No timers, no event listeners, no `requestAnimationFrame`.** Drive everything from `frame.dt`. The host calls `update` once per frame.
2. **Draw only inside `ctx.root`,** in local coordinates from (0,0) to (`ctx.width`, `ctx.height`). The host positions, rotates and fades the root.
3. **Clean up.** Everything under `ctx.root` is destroyed for you. Anything else you create (generated textures, filters) must be passed through `ctx.own(resource)` or released in `teardown`. The one exception is app-wide artwork that every instance shares, made once and never destroyed: the glyph atlas (`sharedGlyphAtlas` in `glyphs.ts`) and the pressed-flower textures. Destroying a texture another instance is still drawing with makes Pixi warn and can blank a frame.
4. **Do not allocate per frame if you can avoid it.** Create a pool in `setup` and reuse it (see `bloom.ts`). Redraw `Graphics` only when its look changes.
5. **Read parameters from `inputs.params` in `update`,** not from `ctx.params`, or MIDI bindings will not reach you. Parameters that shape the layout (text, counts) are read in `setup`; changing them in the editor rebuilds the instance.
6. **Throwing is safe but final.** An error in `setup`, `update` or `teardown` is caught and logged, and that instance is switched off for the rest of the slide. The show carries on.

## Test it

`pnpm dev`, place the animation on a slide, open the MIDI tab and click the virtual keyboard (or press a real key). Add a case to `animations.test.ts` if it has logic worth pinning down; `splitUnits` in `textReveal.ts` is an example of pulling logic out so it can be tested without a GPU.
