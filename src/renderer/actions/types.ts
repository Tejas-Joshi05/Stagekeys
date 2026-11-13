import { z } from 'zod';

const plain = <T extends string>(type: T) => z.object({ type: z.literal(type) });

/**
 * Every thing the app can do. Keyboard shortcuts, MIDI mappings, menu items and
 * buttons all produce one of these and hand it to `dispatch`.
 */
export const ActionSchema = z.discriminatedUnion('type', [
  // Navigation
  plain('nav.next'),
  plain('nav.prev'),
  z.object({ type: z.literal('nav.goto'), index: z.number().int().min(0) }),
  z.object({ type: z.literal('nav.gotoNamed'), slideId: z.string().min(1) }),
  // Show
  z.object({ type: z.literal('show.start'), rehearsal: z.boolean().default(false) }),
  plain('show.end'),
  plain('show.blackToggle'),
  plain('show.panic'),
  // Animations
  z.object({
    type: z.literal('anim.trigger'),
    elementId: z.string().min(1),
    value: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal('anim.setParam'),
    elementId: z.string().min(1),
    param: z.string().min(1),
    value: z.number(),
  }),
  // Editing
  plain('edit.undo'),
  plain('edit.redo'),
  plain('edit.cut'),
  plain('edit.copy'),
  plain('edit.paste'),
  plain('edit.duplicate'),
  plain('edit.delete'),
  plain('edit.selectAll'),
  plain('edit.deselect'),
  z.object({ type: z.literal('edit.nudge'), dx: z.number(), dy: z.number() }),
  z.object({
    type: z.literal('edit.order'),
    to: z.enum(['forward', 'backward', 'front', 'back']),
  }),
  z.object({
    type: z.literal('element.add'),
    kind: z.enum(['text', 'rect', 'ellipse', 'line', 'image', 'animation']),
    /** Which registered animation to place, when kind is `animation`. */
    animationId: z.string().optional(),
  }),
  // Slides
  plain('slide.add'),
  plain('slide.duplicate'),
  plain('slide.delete'),
  // Files
  plain('file.new'),
  plain('file.open'),
  plain('file.save'),
  plain('file.saveAs'),
  plain('file.exportPng'),
  plain('file.exportPdf'),
  // View
  plain('view.toggleFps'),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

/** Where an action came from. Useful for logging and for show-safe decisions. */
export type ActionSource = 'keyboard' | 'midi' | 'ui' | 'menu' | 'system';

/** The actions that make sense as the target of a MIDI mapping. */
export const MAPPABLE_ACTIONS = [
  'nav.next',
  'nav.prev',
  'nav.goto',
  'nav.gotoNamed',
  'show.blackToggle',
  'show.panic',
  'anim.trigger',
  'anim.setParam',
] as const satisfies readonly ActionType[];

export const ACTION_LABELS: Record<(typeof MAPPABLE_ACTIONS)[number], string> = {
  'nav.next': 'Next slide',
  'nav.prev': 'Previous slide',
  'nav.goto': 'Go to slide number',
  'nav.gotoNamed': 'Go to named slide',
  'show.blackToggle': 'Black screen toggle',
  'show.panic': 'Panic / home',
  'anim.trigger': 'Trigger animation',
  'anim.setParam': 'Set animation parameter',
};
