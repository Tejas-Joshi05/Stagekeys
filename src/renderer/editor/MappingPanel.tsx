import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  learnSession,
  parseMappingFile,
  serialiseMappings,
  TRIGGER_LABELS,
  type Mapping,
  type Trigger,
  type TriggerKind,
} from '../mapping';
import { KeyboardDiagram, midi, useMidiStore } from '../midi';
import { api } from '../shared/api';
import { notify } from '../shared/notify';
import { newId, noteName } from '../shared/util';
import { CheckField, NumField, Section, SelectField, TextField } from './fields';
import { useEditorUi } from './uiStore';

type MappableType = (typeof MAPPABLE_ACTIONS)[number];

const ZONE_COLOURS = ['#ff6b6b', '#ffb84d', '#6bd98a', '#5b8cff', '#c77dff', '#4dd0e1'];

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
    default:
      return { type };
  }
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

export function describeTrigger(m: Mapping): string {
  const t = m.trigger;
  const channel = m.filters.channel ? ` · ch ${m.filters.channel}` : '';
  switch (t.kind) {
    case 'noteOn':
    case 'noteOff': {
      const { noteFrom, noteTo } = m.filters;
      const what = t.kind === 'noteOn' ? 'Press' : 'Release';
      if (noteFrom === undefined && noteTo === undefined) return `${what} any key${channel}`;
      const from = noteFrom ?? 0;
      const to = noteTo ?? 127;
      return from === to
        ? `${what} ${noteName(from)}${channel}`
        : `${what} ${noteName(from)}–${noteName(to)}${channel}`;
    }
    case 'ccAbove':
      return `CC ${t.controller} rises past ${t.threshold}${channel}`;
    case 'ccBelow':
      return `CC ${t.controller} falls past ${t.threshold}${channel}`;
    case 'ccValue':
      return `CC ${t.controller} (knob)${channel}`;
    case 'sustainDown':
      return `Sustain pedal down${channel}`;
    case 'sustainUp':
      return `Sustain pedal up${channel}`;
  }
}

function MappingCard({
  mapping,
  scope,
  deck,
}: {
  mapping: Mapping;
  scope: MappingScope;
  deck: Deck;
}) {
  const learningId = useSyncExternalStore(learnSession.subscribe, () => learnSession.activeId);
  const devices = useMidiStore((s) => s.devices);
  const focusId = useEditorUi((s) => s.focusMappingId);
  const [open, setOpen] = useState(focusId === mapping.id);
  const cardRef = useRef<HTMLDivElement>(null);
  const learning = learningId === mapping.id;
  const targets = animationTargets(deck, scope);
  const { action, trigger, filters } = mapping;

  useEffect(() => {
    if (focusId === mapping.id) {
      cardRef.current?.scrollIntoView({ block: 'nearest' });
      useEditorUi.setState({ focusMappingId: null });
    }
  }, [focusId, mapping.id]);

  const edit = (change: (m: Mapping) => void) => updateMapping(scope, mapping.id, change);
  const setAction = (next: Action) => edit((m) => void (m.action = next));

  const learn = () => {
    if (learning) {
      learnSession.cancel();
      return;
    }
    learnSession.start(mapping.id, action, (learned) =>
      updateMapping(
        scope,
        mapping.id,
        (m) => {
          m.trigger = learned.trigger;
          m.filters = {
            ...m.filters,
            noteFrom: learned.filters.noteFrom,
            noteTo: learned.filters.noteTo,
          };
        },
        false,
      ),
    );
  };

  const isNote = trigger.kind === 'noteOn' || trigger.kind === 'noteOff';
  const anyNote = filters.noteFrom === undefined && filters.noteTo === undefined;
  const target = 'elementId' in action ? targets.find((t) => t.id === action.elementId) : undefined;
  const targetDef = target ? getAnimation(target.animationId) : undefined;
  const params = targetDef ? bindableParams(targetDef) : [];
  const missingTarget = 'elementId' in action && !target;
  const missingSlide =
    action.type === 'nav.gotoNamed' && !deck.slides.some((s) => s.id === action.slideId);
  const deviceNames = [
    ...new Set([...devices.map((d) => d.name), ...(filters.device ? [filters.device] : [])]),
  ];

  return (
    <div
      className={`mapping${mapping.enabled ? '' : ' disabled'}${learning ? ' learning' : ''}`}
      ref={cardRef}
      data-testid="mapping-card"
    >
      <div className="mapping-head">
        <input
          type="checkbox"
          checked={mapping.enabled}
          title="Enabled"
          onChange={(e) => edit((m) => void (m.enabled = e.target.checked))}
        />
        <select
          className="mapping-action"
          data-testid="mapping-action"
          value={action.type}
          onChange={(e) => setAction(defaultAction(e.target.value as MappableType, deck, targets))}
        >
          {MAPPABLE_ACTIONS.map((type) => (
            <option key={type} value={type}>
              {ACTION_LABELS[type]}
            </option>
          ))}
        </select>
        <button
          className={learning ? 'learn active' : 'learn'}
          onClick={learn}
          data-testid="mapping-learn"
        >
          {learning ? 'Listening…' : 'Learn'}
        </button>
      </div>
      <div className="mapping-summary" onClick={() => setOpen(!open)} data-testid="mapping-summary">
        <span>{learning ? 'Press a key or move a knob' : describeTrigger(mapping)}</span>
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </div>
      {(missingTarget || missingSlide) && (
        <p className="hint warn">
          {missingSlide
            ? 'The slide this pointed to no longer exists.'
            : 'Choose which animation this controls.'}
        </p>
      )}

      {/* Action details are always visible: they decide what the key does. */}
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
          <p className="hint">
            {scope.kind === 'slide'
              ? 'This slide has no animations yet.'
              : 'The deck has no animations yet.'}
          </p>
        ) : (
          <SelectField
            label="Animation"
            wide
            value={action.elementId}
            options={[
              ...(target ? [] : [{ value: action.elementId, label: 'Choose…' }]),
              ...targets.map((t) => ({ value: t.id, label: t.label })),
            ]}
            onChange={(elementId) => {
              if (action.type === 'anim.trigger') {
                setAction({ ...action, elementId });
              } else {
                const def = getAnimation(
                  targets.find((t) => t.id === elementId)?.animationId ?? '',
                );
                const first = def ? bindableParams(def)[0] : undefined;
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
              }
            }}
          />
        ))}
      {action.type === 'anim.setParam' && params.length > 0 && (
        <div className="grid2">
          <SelectField
            label="Parameter"
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
              label="Set to"
              value={action.value}
              step={0.01}
              onChange={(value) => setAction({ ...action, value })}
            />
          )}
        </div>
      )}

      {open && (
        <div className="mapping-details">
          <SelectField<TriggerKind>
            label="When"
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
                label="Threshold"
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
                    label={`From (${noteName(filters.noteFrom ?? 0)})`}
                    value={filters.noteFrom ?? 0}
                    min={0}
                    max={127}
                    onChange={(n) => edit((m) => void (m.filters.noteFrom = n))}
                  />
                  <NumField
                    label={`To (${noteName(filters.noteTo ?? 127)})`}
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
                label="Min velocity"
                value={filters.velocityMin ?? 0}
                min={0}
                max={127}
                onChange={(n) => edit((m) => void (m.filters.velocityMin = n <= 0 ? undefined : n))}
              />
              <NumField
                label="Max velocity"
                value={filters.velocityMax ?? 127}
                min={0}
                max={127}
                onChange={(n) =>
                  edit((m) => void (m.filters.velocityMax = n >= 127 ? undefined : n))
                }
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
                  label="Value curve"
                  value={mapping.curve}
                  options={[
                    { value: 'linear', label: 'Linear' },
                    { value: 'exponential', label: 'Exponential' },
                    { value: 'logarithmic', label: 'Logarithmic' },
                  ]}
                  onChange={(curve) => edit((m) => void (m.curve = curve))}
                />
                <span />
                <NumField
                  label="At lowest"
                  value={mapping.min}
                  step={0.01}
                  onChange={(min) => edit((m) => void (m.min = min))}
                />
                <NumField
                  label="At highest"
                  value={mapping.max}
                  step={0.01}
                  onChange={(max) => edit((m) => void (m.max = max))}
                />
              </div>
            )}
          <TextField
            label="Label (optional)"
            value={mapping.name}
            onChange={(name) => edit((m) => void (m.name = name))}
          />
          <button
            className="link danger"
            onClick={() => deleteMapping(scope, mapping.id)}
            data-testid="mapping-delete"
          >
            Delete mapping
          </button>
        </div>
      )}
    </div>
  );
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
              colour: ZONE_COLOURS[deck.zones.length % ZONE_COLOURS.length] ?? '#5b8cff',
              fromNote: Math.min(115, 36 + deck.zones.length * 12),
              toNote: Math.min(127, 47 + deck.zones.length * 12),
            })
          }
        >
          + Zone
        </button>
      }
    >
      <KeyboardDiagram zones={deck.zones} input={midi.input} />
      {deck.zones.length === 0 && (
        <p className="hint">
          Name ranges of keys (navigation, explainer, free play) to see them in colour and to aim
          animations at them.
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
          <button className="icon" title="Delete zone" onClick={() => deleteZone(zone.id)}>
            ✕
          </button>
        </div>
      ))}
    </Section>
  );
}

function clampNote(raw: string, fallback: number): number {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n)
    ? Math.min(127, Math.max(0, Math.round(n)))
    : fallback;
}

/** MIDI → action mappings for the whole deck or just the current slide, plus zones and import/export. */
export function MappingPanel() {
  const deck = useDeckStore((s) => s.deck);
  const slideId = useDeckStore((s) => s.currentSlideId);
  const [scopeKind, setScopeKind] = useState<'global' | 'slide'>('global');
  if (!deck || !slideId) return null;

  const scope: MappingScope =
    scopeKind === 'global' ? { kind: 'global' } : { kind: 'slide', slideId };
  const slide = deck.slides.find((s) => s.id === slideId);
  const list = scopeKind === 'global' ? deck.mappings : (slide?.mappings ?? []);

  const add = () => {
    const mapping: Mapping = {
      id: newId('map'),
      name: '',
      enabled: true,
      trigger: { kind: 'noteOn' },
      filters: {},
      action: { type: 'nav.next' },
      curve: 'linear',
      min: 0,
      max: 1,
    };
    addMapping(scope, mapping);
    useEditorUi.setState({ focusMappingId: mapping.id });
    // Go straight into Learn: the next key pressed becomes the trigger.
    learnSession.start(mapping.id, mapping.action, (learned) =>
      updateMapping(
        scope,
        mapping.id,
        (m) => {
          m.trigger = learned.trigger;
          m.filters = { ...m.filters, ...learned.filters };
        },
        false,
      ),
    );
  };

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
      <div className="segmented">
        <button
          className={scopeKind === 'global' ? 'on' : ''}
          onClick={() => setScopeKind('global')}
        >
          Whole deck ({deck.mappings.length})
        </button>
        <button
          className={scopeKind === 'slide' ? 'on' : ''}
          onClick={() => setScopeKind('slide')}
          data-testid="scope-slide"
        >
          This slide ({slide?.mappings.length ?? 0})
        </button>
      </div>
      <p className="hint">
        {scopeKind === 'global'
          ? 'These work on every slide.'
          : 'These work only on this slide, and win over whole-deck mappings for the same key.'}
      </p>
      <Section
        title="Mappings"
        actions={
          <button className="primary" onClick={add} data-testid="add-mapping">
            + Map a key
          </button>
        }
      >
        {list.length === 0 && (
          <p className="hint">
            Nothing mapped yet. Click “Map a key”, then press the key or move the knob.
          </p>
        )}
        {list.map((mapping) => (
          <MappingCard key={mapping.id} mapping={mapping} scope={scope} deck={deck} />
        ))}
      </Section>
      <Zones deck={deck} />
      <Section title="Reuse across decks">
        <div className="row">
          <button onClick={() => void exportFile()}>Export mappings…</button>
          <button onClick={() => void importFile()}>Import mappings…</button>
        </div>
        <p className="hint">Exports the whole-deck mappings and zones as a JSON file.</p>
      </Section>
    </div>
  );
}
