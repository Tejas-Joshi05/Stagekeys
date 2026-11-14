import { useEffect, useMemo, useState } from 'react';
import { ACTION_LABELS, MAPPABLE_ACTIONS, type Action } from '../actions';
import { bindableParams, getAnimation } from '../animations';
import {
  addMapping,
  addZone,
  deleteMapping,
  deleteZone,
  importMappings,
  updateMapping,
  updateZone,
  useDeckStore,
  type Deck,
  type MappingScope,
} from '../deck';
import {
  carriesValue,
  controlOfMapping,
  controlPicker,
  describeAction,
  describeInput,
  mappingTouches,
  parseMappingFile,
  serialiseMappings,
  triggerForControl,
  TRIGGER_LABELS,
  type Mapping,
  type Trigger,
  type TriggerKind,
} from '../mapping';
import {
  controlLabel,
  KeyboardDiagram,
  KEY_COUNT,
  keysWindow,
  midi,
  useMidiStore,
  type ControlRef,
} from '../midi';
import { api } from '../shared/api';
import { notify } from '../shared/notify';
import { useSettings } from '../shared/settings';
import { newId, noteName } from '../shared/util';
import { ControllerMap, controlKey, type ControlMark } from './ControllerMap';
import { CheckField, NumField, Section, SelectField, TextField } from './fields';
import { useEditorUi } from './uiStore';

type MappableType = (typeof MAPPABLE_ACTIONS)[number];

const ZONE_COLOURS = ['#d8a4af', '#c1bc77', '#afb8cd', '#ccc3d1', '#e3b57a', '#8d8b4c'];

/** Actions that need a continuous value: they suit knobs and wheels. */
const CONTINUOUS: readonly MappableType[] = ['anim.setParam', 'audio.setSensitivity'];

/** The order actions are offered in, most used first. */
const ACTION_ORDER: readonly MappableType[] = [
  'nav.next',
  'nav.prev',
  'anim.trigger',
  'anim.setParam',
  'nav.gotoNamed',
  'nav.goto',
  'show.blackToggle',
  'audio.togglePiano',
  'audio.toggleInput',
  'audio.setSensitivity',
  'view.toggleKeys',
  'show.panic',
];

interface AnimationTarget {
  id: string;
  label: string;
  animationId: string;
}

/** Animation elements a mapping can point at: the current slide's for slide scope, all of them for global. */
function animationTargets(deck: Deck, scope: MappingScope): AnimationTarget[] {
  const out: AnimationTarget[] = [];
  deck.slides.forEach((slide, i) => {
    if (scope.kind === 'slide' && slide.id !== scope.slideId) return;
    for (const el of slide.elements) {
      if (el.type !== 'animation') continue;
      const name = el.name || getAnimation(el.animationId)?.name || 'Animation';
      out.push({
        id: el.id,
        label: scope.kind === 'global' ? `Slide ${i + 1} · ${name}` : name,
        animationId: el.animationId,
      });
    }
  });
  return out;
}

function defaultAction(type: MappableType, deck: Deck, targets: AnimationTarget[]): Action {
  switch (type) {
    case 'nav.goto':
      return { type, index: 0 };
    case 'nav.gotoNamed':
      return { type, slideId: deck.slides[0]?.id ?? '' };
    case 'anim.trigger':
      return { type, elementId: targets[0]?.id ?? '' };
    case 'anim.setParam': {
      const target = targets[0];
      const def = target ? getAnimation(target.animationId) : undefined;
      const first = def ? bindableParams(def)[0] : undefined;
      return {
        type,
        elementId: target?.id ?? '',
        param: first?.key ?? '',
        value: first?.default ?? 0,
      };
    }
    case 'audio.setSensitivity':
      return { type, value: 0.5 };
    default:
      return { type };
  }
}

function paramRange(action: Action, targets: AnimationTarget[]): { min: number; max: number } {
  if (action.type !== 'anim.setParam') return { min: 0, max: 1 };
  const target = targets.find((t) => t.id === action.elementId);
  const def = target ? getAnimation(target.animationId) : undefined;
  const p = def ? bindableParams(def).find((x) => x.key === action.param) : undefined;
  return { min: p?.min ?? 0, max: p?.max ?? 1 };
}

function defaultTrigger(kind: TriggerKind, previous: Trigger): Trigger {
  const controller = 'controller' in previous ? previous.controller : 1;
  switch (kind) {
    case 'ccAbove':
    case 'ccBelow':
      return { kind, controller, threshold: 64 };
    case 'ccValue':
      return { kind, controller };
    default:
      return { kind };
  }
}

const isKnobLike = (ref: ControlRef): boolean =>
  ref.kind === 'knob' || ref.kind === 'mod' || ref.kind === 'cc';

// ── What a mapping does ─────────────────────────────────────────────────────

function ActionDetails({
  mapping,
  scope,
  deck,
  targets,
}: {
  mapping: Mapping;
  scope: MappingScope;
  deck: Deck;
  targets: AnimationTarget[];
}) {
  const { action } = mapping;
  const edit = (change: (m: Mapping) => void) => updateMapping(scope, mapping.id, change);
  const setAction = (next: Action) => edit((m) => void (m.action = next));
  const target = 'elementId' in action ? targets.find((t) => t.id === action.elementId) : undefined;
  const def = target ? getAnimation(target.animationId) : undefined;
  const params = def ? bindableParams(def) : [];
  const missingSlide =
    action.type === 'nav.gotoNamed' && !deck.slides.some((s) => s.id === action.slideId);

  return (
    <>
      {missingSlide && (
        <p className="hint warn">The slide this pointed to no longer exists. Choose another.</p>
      )}
      {action.type === 'nav.goto' && (
        <NumField
          label="Slide number"
          value={action.index + 1}
          min={1}
          max={deck.slides.length}
          onChange={(n) => setAction({ type: 'nav.goto', index: Math.max(0, Math.round(n) - 1) })}
        />
      )}
      {action.type === 'nav.gotoNamed' && (
        <SelectField
          label="Slide"
          wide
          value={action.slideId}
          options={deck.slides.map((s, i) => ({
            value: s.id,
            label: `${i + 1}. ${s.name || 'Untitled slide'}`,
          }))}
          onChange={(slideId) => setAction({ type: 'nav.gotoNamed', slideId })}
        />
      )}
      {(action.type === 'anim.trigger' || action.type === 'anim.setParam') &&
        (targets.length === 0 ? (
          <p className="hint warn">
            {scope.kind === 'slide'
              ? 'This slide has no animations yet. Add one from the toolbar first.'
              : 'The deck has no animations yet. Add one from the toolbar first.'}
          </p>
        ) : (
          <SelectField
            label="Animation"
            wide
            value={action.elementId}
            options={[
              ...(target ? [] : [{ value: action.elementId, label: 'Choose an animation' }]),
              ...targets.map((t) => ({ value: t.id, label: t.label })),
            ]}
            onChange={(elementId) => {
              if (action.type === 'anim.trigger') {
                setAction({ ...action, elementId });
                return;
              }
              const nextDef = getAnimation(
                targets.find((t) => t.id === elementId)?.animationId ?? '',
              );
              const first = nextDef ? bindableParams(nextDef)[0] : undefined;
              setAction({
                ...action,
                elementId,
                param: first?.key ?? '',
                value: first?.default ?? 0,
              });
              edit((m) => {
                m.min = first?.min ?? 0;
                m.max = first?.max ?? 1;
              });
            }}
          />
        ))}
      {action.type === 'anim.setParam' && params.length > 0 && (
        <div className="grid2">
          <SelectField
            label="Value to change"
            value={action.param}
            options={params.map((p) => ({ value: p.key, label: p.label }))}
            onChange={(param) => {
              const p = params.find((x) => x.key === param);
              setAction({ ...action, param, value: p?.default ?? 0 });
              edit((m) => {
                m.min = p?.min ?? 0;
                m.max = p?.max ?? 1;
              });
            }}
          />
          {!carriesValue(mapping) && (
            <NumField
              label="Set it to"
              value={action.value}
              step={0.01}
              onChange={(value) => setAction({ ...action, value })}
            />
          )}
        </div>
      )}
    </>
  );
}

function MoreOptions({ mapping, scope }: { mapping: Mapping; scope: MappingScope }) {
  const devices = useMidiStore((s) => s.devices);
  const { trigger, filters, action } = mapping;
  const edit = (change: (m: Mapping) => void) => updateMapping(scope, mapping.id, change);
  const isNote = trigger.kind === 'noteOn' || trigger.kind === 'noteOff';
  const anyNote = filters.noteFrom === undefined && filters.noteTo === undefined;
  const deviceNames = [
    ...new Set([...devices.map((d) => d.name), ...(filters.device ? [filters.device] : [])]),
  ];

  return (
    <div className="mapping-details">
      <SelectField<TriggerKind>
        label="Fires when"
        wide
        value={trigger.kind}
        options={(Object.keys(TRIGGER_LABELS) as TriggerKind[]).map((k) => ({
          value: k,
          label: TRIGGER_LABELS[k],
        }))}
        onChange={(kind) => edit((m) => void (m.trigger = defaultTrigger(kind, m.trigger)))}
      />
      <div className="grid2">
        {'controller' in trigger && (
          <NumField
            label="CC number"
            value={trigger.controller}
            min={0}
            max={127}
            onChange={(controller) =>
              edit((m) => 'controller' in m.trigger && void (m.trigger.controller = controller))
            }
          />
        )}
        {'threshold' in trigger && (
          <NumField
            label="Threshold (0–127)"
            value={trigger.threshold}
            min={0}
            max={127}
            onChange={(threshold) =>
              edit((m) => 'threshold' in m.trigger && void (m.trigger.threshold = threshold))
            }
          />
        )}
      </div>
      {isNote && (
        <>
          <CheckField
            label="Any key"
            value={anyNote}
            onChange={(any) =>
              edit((m) => {
                m.filters.noteFrom = any ? undefined : 60;
                m.filters.noteTo = any ? undefined : 60;
              })
            }
          />
          {!anyNote && (
            <div className="grid2">
              <NumField
                label={`From ${noteName(filters.noteFrom ?? 0)}`}
                value={filters.noteFrom ?? 0}
                min={0}
                max={127}
                onChange={(n) => edit((m) => void (m.filters.noteFrom = n))}
              />
              <NumField
                label={`To ${noteName(filters.noteTo ?? 127)}`}
                value={filters.noteTo ?? 127}
                min={0}
                max={127}
                onChange={(n) => edit((m) => void (m.filters.noteTo = n))}
              />
            </div>
          )}
        </>
      )}
      {trigger.kind === 'noteOn' && (
        <div className="grid2">
          <NumField
            label="Softest hit"
            value={filters.velocityMin ?? 0}
            min={0}
            max={127}
            onChange={(n) => edit((m) => void (m.filters.velocityMin = n <= 0 ? undefined : n))}
          />
          <NumField
            label="Hardest hit"
            value={filters.velocityMax ?? 127}
            min={0}
            max={127}
            onChange={(n) => edit((m) => void (m.filters.velocityMax = n >= 127 ? undefined : n))}
          />
        </div>
      )}
      <div className="grid2">
        <SelectField
          label="Channel"
          value={String(filters.channel ?? 0)}
          options={[
            { value: '0', label: 'Any' },
            ...Array.from({ length: 16 }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            })),
          ]}
          onChange={(v) =>
            edit((m) => void (m.filters.channel = v === '0' ? undefined : Number(v)))
          }
        />
        <SelectField
          label="Device"
          value={filters.device ?? ''}
          options={[
            { value: '', label: 'Any' },
            ...deviceNames.map((d) => ({ value: d, label: d })),
          ]}
          onChange={(v) => edit((m) => void (m.filters.device = v || undefined))}
        />
      </div>
      {carriesValue(mapping) &&
        (action.type === 'anim.trigger' || action.type === 'anim.setParam') && (
          <div className="grid2">
            <SelectField
              label="Response"
              value={mapping.curve}
              options={[
                { value: 'linear', label: 'Even' },
                { value: 'exponential', label: 'Gentle, then fast' },
                { value: 'logarithmic', label: 'Fast, then gentle' },
              ]}
              onChange={(curve) => edit((m) => void (m.curve = curve))}
            />
            <span />
            <NumField
              label="At the bottom"
              value={mapping.min}
              step={0.01}
              onChange={(min) => edit((m) => void (m.min = min))}
            />
            <NumField
              label="At the top"
              value={mapping.max}
              step={0.01}
              onChange={(max) => edit((m) => void (m.max = max))}
            />
          </div>
        )}
      <TextField
        label="Note to self (optional)"
        value={mapping.name}
        onChange={(name) => edit((m) => void (m.name = name))}
      />
    </div>
  );
}

/** One mapping: what it does, its details, and the rarely needed options. */
function MappingEditor({
  mapping,
  scope,
  deck,
  targets,
}: {
  mapping: Mapping;
  scope: MappingScope;
  deck: Deck;
  targets: AnimationTarget[];
}) {
  const [more, setMore] = useState(false);
  const knob =
    mapping.trigger.kind === 'ccValue' ||
    mapping.trigger.kind === 'ccAbove' ||
    mapping.trigger.kind === 'ccBelow';

  const changeAction = (type: MappableType) => {
    const next = defaultAction(type, deck, targets);
    updateMapping(
      scope,
      mapping.id,
      (m) => {
        m.action = next;
        const range = paramRange(next, targets);
        m.min = range.min;
        m.max = range.max;
        // A knob setting a value moves smoothly; a knob doing a one-off action fires once past halfway.
        if (knob && 'controller' in m.trigger) {
          const controller = m.trigger.controller;
          m.trigger = CONTINUOUS.includes(type)
            ? { kind: 'ccValue', controller }
            : { kind: 'ccAbove', controller, threshold: 64 };
        }
      },
      false,
    );
  };

  return (
    <div className={`mapping${mapping.enabled ? '' : ' disabled'}`} data-testid="mapping-card">
      <div className="mapping-head">
        <select
          className="mapping-action"
          data-testid="mapping-action"
          value={mapping.action.type}
          onChange={(e) => changeAction(e.target.value as MappableType)}
        >
          {ACTION_ORDER.map((type) => (
            <option key={type} value={type}>
              {ACTION_LABELS[type]}
            </option>
          ))}
        </select>
        <label className="switch" title={mapping.enabled ? 'On' : 'Off'}>
          <input
            type="checkbox"
            checked={mapping.enabled}
            onChange={(e) =>
              updateMapping(scope, mapping.id, (m) => void (m.enabled = e.target.checked))
            }
          />
          <span>{mapping.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>
      <ActionDetails mapping={mapping} scope={scope} deck={deck} targets={targets} />
      <div className="mapping-foot">
        <button className="link" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? 'Fewer options' : 'More options'}
        </button>
        <button
          className="link danger"
          onClick={() => deleteMapping(scope, mapping.id)}
          data-testid="mapping-delete"
        >
          Remove
        </button>
      </div>
      {more && <MoreOptions mapping={mapping} scope={scope} />}
    </div>
  );
}

// ── The chosen control ──────────────────────────────────────────────────────

function ControlEditor({
  control,
  scope,
  deck,
  list,
}: {
  control: ControlRef;
  scope: MappingScope;
  deck: Deck;
  list: readonly Mapping[];
}) {
  const profile = useSettings((s) => s.controller);
  const targets = animationTargets(deck, scope);
  const name = controlLabel(control, noteName);
  const mine = list.filter((m) => mappingTouches(m, control, profile));

  if (control.kind === 'pitch') {
    return (
      <div className="control-editor" data-testid="control-editor">
        <h4 className="control-name">Pitch wheel</h4>
        <p className="hint">
          The pitch wheel bends values rather than firing actions. To steer an animation with it,
          select the animation and add a binding from Pitch bend in Properties. The ASCII garden and
          Pressed flowers lean with it on their own.
        </p>
      </div>
    );
  }

  const add = (type: MappableType) => {
    const action = defaultAction(type, deck, targets);
    const made = triggerForControl(control, profile, CONTINUOUS.includes(type));
    if (!made) return;
    const range = paramRange(action, targets);
    addMapping(scope, {
      id: newId('map'),
      name: '',
      enabled: true,
      trigger: made.trigger,
      filters: made.filters,
      action,
      curve: 'linear',
      min: range.min,
      max: range.max,
    });
  };

  const offered = isKnobLike(control)
    ? // Knobs and wheels: the actions that take a value come first.
      [...CONTINUOUS, ...ACTION_ORDER.filter((a) => !CONTINUOUS.includes(a))]
    : ACTION_ORDER.filter((a) => a !== 'anim.setParam' || control.kind !== 'sustain');

  return (
    <div className="control-editor" data-testid="control-editor">
      <h4 className="control-name" data-testid="control-name">
        {name}
        {control.kind === 'knob' && <span className="muted"> sends CC {control.cc}</span>}
        {control.kind === 'pad' && <span className="muted"> sends {noteName(control.note)}</span>}
      </h4>
      {mine.length === 0 ? (
        <>
          <p className="hint">
            {name} does nothing {scope.kind === 'slide' ? 'on this slide' : 'yet'}. Choose what it
            does:
          </p>
          <div className="action-chips">
            {offered.map((type) => (
              <button key={type} onClick={() => add(type)} data-testid={`action-${type}`}>
                {ACTION_LABELS[type]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {mine.map((mapping) => (
            <MappingEditor
              key={mapping.id}
              mapping={mapping}
              scope={scope}
              deck={deck}
              targets={targets}
            />
          ))}
          <button
            className="link"
            onClick={() => add(isKnobLike(control) ? 'anim.setParam' : 'nav.next')}
          >
            Add another action to {name}
          </button>
        </>
      )}
    </div>
  );
}

// ── Everything mapped, as sentences ─────────────────────────────────────────

function actionSentence(m: Mapping, deck: Deck): string {
  return describeAction(m.action, {
    animation: (id) => {
      for (const slide of deck.slides) {
        const el = slide.elements.find((e) => e.id === id);
        if (el && el.type === 'animation')
          return el.name || getAnimation(el.animationId)?.name || 'animation';
      }
      return null;
    },
    slide: (id) => {
      const index = deck.slides.findIndex((s) => s.id === id);
      return index < 0 ? null : { index, name: deck.slides[index]?.name ?? '' };
    },
  });
}

// ── Zones ───────────────────────────────────────────────────────────────────

function clampNote(raw: string, fallback: number): number {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n)
    ? Math.min(127, Math.max(0, Math.round(n)))
    : fallback;
}

function Zones({ deck }: { deck: Deck }) {
  return (
    <Section
      title="Keyboard zones"
      actions={
        <button
          onClick={() =>
            addZone({
              id: newId('zone'),
              name:
                ['navigation', 'explainer', 'free play'][deck.zones.length] ??
                `zone ${deck.zones.length + 1}`,
              colour: ZONE_COLOURS[deck.zones.length % ZONE_COLOURS.length] ?? '#d8a4af',
              fromNote: Math.min(115, 48 + deck.zones.length * 12),
              toNote: Math.min(127, 59 + deck.zones.length * 12),
            })
          }
        >
          Add zone
        </button>
      }
    >
      {deck.zones.length > 0 && (
        <KeyboardDiagram zones={deck.zones} input={midi.input} from={36} to={84} />
      )}
      {deck.zones.length === 0 && (
        <p className="hint">
          Name a run of keys (say, the top octave for your explainer) to see it in colour and to aim
          animations at it.
        </p>
      )}
      {deck.zones.map((zone) => (
        <div className="zone" key={zone.id}>
          <input
            type="color"
            value={zone.colour}
            onChange={(e) => updateZone(zone.id, (z) => void (z.colour = e.target.value))}
          />
          <input
            type="text"
            value={zone.name}
            onChange={(e) => updateZone(zone.id, (z) => void (z.name = e.target.value))}
          />
          <input
            type="number"
            min={0}
            max={127}
            value={zone.fromNote}
            title={noteName(zone.fromNote)}
            onChange={(e) =>
              updateZone(zone.id, (z) => void (z.fromNote = clampNote(e.target.value, z.fromNote)))
            }
          />
          <input
            type="number"
            min={0}
            max={127}
            value={zone.toNote}
            title={noteName(zone.toNote)}
            onChange={(e) =>
              updateZone(zone.id, (z) => void (z.toNote = clampNote(e.target.value, z.toNote)))
            }
          />
          <button
            className="icon"
            title="Delete zone"
            aria-label="Delete zone"
            onClick={() => deleteZone(zone.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </Section>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

/**
 * MIDI mapping, shown on the controller itself: pick a pad, key or knob (by
 * pressing it or clicking it), then pick what it does. Mappings apply to the
 * whole deck, or only to the current slide, where they win.
 */
export function MappingPanel() {
  const deck = useDeckStore((s) => s.deck);
  const slideId = useDeckStore((s) => s.currentSlideId);
  const profile = useSettings((s) => s.controller);
  const [scopeKind, setScopeKind] = useState<'global' | 'slide'>('global');
  const [selected, setSelected] = useState<ControlRef | null>(null);
  const [picking, setPicking] = useState(true);
  const [low, setLow] = useState(profile.keysLow);
  const focusId = useEditorUi((s) => s.focusMappingId);

  // Pick by pressing while this panel is open; polled ten times a second.
  useEffect(() => {
    controlPicker.enabled = picking;
    let seen = controlPicker.latest?.seq ?? 0;
    const timer = setInterval(() => {
      const latest = controlPicker.latest;
      if (!latest || latest.seq === seen) return;
      seen = latest.seq;
      setSelected(latest.ref);
      if (latest.ref.kind === 'key') {
        setLow((current) => keysWindow(current, [(latest.ref as { note: number }).note]));
      }
    }, 100);
    return () => {
      clearInterval(timer);
      controlPicker.enabled = false;
    };
  }, [picking]);

  // Arriving from "Map a key" in Properties: show the new mapping's control.
  useEffect(() => {
    if (!focusId || !deck) return;
    const slide = deck.slides.find((s) => s.id === slideId);
    const inSlide = slide?.mappings.find((m) => m.id === focusId);
    const found = inSlide ?? deck.mappings.find((m) => m.id === focusId);
    if (found) {
      setScopeKind(inSlide ? 'slide' : 'global');
      setSelected(controlOfMapping(found, profile));
    }
    useEditorUi.setState({ focusMappingId: null });
  }, [focusId, deck, slideId, profile]);

  const slide = deck?.slides.find((s) => s.id === slideId);
  const scope: MappingScope =
    scopeKind === 'global' || !slideId ? { kind: 'global' } : { kind: 'slide', slideId };
  const list = useMemo(
    () => (scopeKind === 'global' ? (deck?.mappings ?? []) : (slide?.mappings ?? [])),
    [scopeKind, deck, slide],
  );

  const { marks, ranges } = useMemo(() => {
    const out = new Map<string, ControlMark>();
    const spans: { from: number; to: number }[] = [];
    const add = (m: Mapping, slideOnly: boolean) => {
      if (!m.enabled || !deck) return;
      const ref = controlOfMapping(m, profile);
      if (ref) {
        const key = controlKey(ref);
        const prev = out.get(key);
        out.set(key, {
          title: prev ? `${prev.title}; ${actionSentence(m, deck)}` : actionSentence(m, deck),
          slideOnly: prev ? prev.slideOnly && slideOnly : slideOnly,
        });
      } else if (m.trigger.kind === 'noteOn' || m.trigger.kind === 'noteOff') {
        spans.push({ from: m.filters.noteFrom ?? 0, to: m.filters.noteTo ?? 127 });
      }
    };
    for (const m of deck?.mappings ?? []) add(m, false);
    if (scopeKind === 'slide') for (const m of slide?.mappings ?? []) add(m, true);
    return { marks: out, ranges: spans };
  }, [deck, slide, scopeKind, profile]);

  if (!deck || !slideId) return null;

  const exportFile = async () => {
    const result = await api().saveTextFile({
      title: 'Export Mappings',
      defaultName: `${deck.meta.title}-mappings.json`,
      extension: 'json',
      content: serialiseMappings(deck.mappings, deck.zones),
    });
    if (!result.ok) notify('error', `Could not export mappings: ${result.error}`);
    else if (result.value) notify('info', 'Mappings exported.');
  };

  const importFile = async () => {
    const result = await api().openTextFile({ title: 'Import Mappings', extension: 'json' });
    if (!result.ok) {
      notify('error', `Could not import mappings: ${result.error}`);
      return;
    }
    if (result.value === null) return;
    const parsed = parseMappingFile(result.value);
    if (!parsed.ok) {
      notify('error', parsed.error);
      return;
    }
    importMappings(parsed.mappings, parsed.zones);
    notify(
      'info',
      `Imported ${parsed.mappings.length} mapping(s) and ${parsed.zones.length} zone(s).`,
    );
  };

  return (
    <div className="panel-scroll" data-testid="mapping-panel">
      <div className="segmented" role="tablist">
        <button
          className={scopeKind === 'global' ? 'on' : ''}
          onClick={() => setScopeKind('global')}
          data-testid="scope-global"
        >
          Every slide <span className="count">{deck.mappings.length}</span>
        </button>
        <button
          className={scopeKind === 'slide' ? 'on' : ''}
          onClick={() => setScopeKind('slide')}
          data-testid="scope-slide"
        >
          This slide only <span className="count">{slide?.mappings.length ?? 0}</span>
        </button>
      </div>

      <div className="map-stage">
        <div className="map-bar">
          <label
            className={picking ? 'pick on' : 'pick'}
            title="While on, pressing a control selects it here instead of doing what it is mapped to"
          >
            <input
              type="checkbox"
              checked={picking}
              onChange={(e) => setPicking(e.target.checked)}
              data-testid="pick-toggle"
            />
            <span>{picking ? 'Press a control to choose it' : 'Mappings are live: try them'}</span>
          </label>
          <span className="octave">
            <button
              className="icon"
              aria-label="Octave down"
              onClick={() => setLow((l) => Math.max(0, l - 12))}
            >
              −
            </button>
            <code>
              {noteName(low)}–{noteName(low + KEY_COUNT - 1)}
            </code>
            <button
              className="icon"
              aria-label="Octave up"
              onClick={() => setLow((l) => Math.min(103, l + 12))}
            >
              +
            </button>
          </span>
        </div>
        <ControllerMap
          profile={profile}
          low={low}
          selected={selected}
          marks={marks}
          ranges={ranges}
          input={midi.input}
          onSelect={setSelected}
        />
        <p className="map-legend">
          <span className="legend-dot" /> mapped for every slide
          {scopeKind === 'slide' && (
            <>
              <span className="legend-dot slide-only" /> this slide only
            </>
          )}
        </p>
      </div>

      {selected ? (
        <ControlEditor control={selected} scope={scope} deck={deck} list={list} />
      ) : (
        <p className="hint pick-hint">
          Press a pad, key or knob on your MPK mini, or click one above, to choose what it does
          {scopeKind === 'slide' ? ' on this slide' : ''}.
        </p>
      )}

      <Section title={scopeKind === 'global' ? 'Mapped for every slide' : 'Mapped on this slide'}>
        {list.length === 0 && <p className="hint">Nothing yet.</p>}
        <ul className="mapping-list" data-testid="mapping-list">
          {list.map((m) => {
            const ref = controlOfMapping(m, profile);
            return (
              <li key={m.id} className={m.enabled ? '' : 'off'}>
                <button
                  className="mapping-line"
                  onClick={() => ref && setSelected(ref)}
                  disabled={!ref}
                  title={ref ? 'Show on the controller' : 'Covers several keys: edit it below'}
                >
                  <code className="mapping-input" data-testid="mapping-input">
                    {describeInput(m, profile)}
                  </code>
                  <span className="mapping-arrow" aria-hidden>
                    ⟶
                  </span>
                  <span className="mapping-what">{m.name || actionSentence(m, deck)}</span>
                </button>
                {!ref && (
                  <MappingEditor
                    mapping={m}
                    scope={scope}
                    deck={deck}
                    targets={animationTargets(deck, scope)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <button
          className="link"
          onClick={() =>
            addMapping(scope, {
              id: newId('map'),
              name: '',
              enabled: true,
              trigger: { kind: 'noteOn' },
              filters: { noteFrom: low, noteTo: low + 11 },
              action: { type: 'nav.next' },
              curve: 'linear',
              min: 0,
              max: 1,
            })
          }
        >
          Map a run of keys
        </button>
      </Section>

      <Zones deck={deck} />

      <Section title="Reuse in another deck">
        <div className="row">
          <button onClick={() => void exportFile()}>Export mappings</button>
          <button onClick={() => void importFile()}>Import mappings</button>
        </div>
        <p className="hint">
          Saves the every-slide mappings and zones as a file you can import into another deck.
        </p>
      </Section>
    </div>
  );
}
