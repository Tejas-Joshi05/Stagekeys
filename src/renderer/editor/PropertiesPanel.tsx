import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { dispatch } from '../actions';
import {
  bindableParams,
  controlsFor,
  getAnimation,
  type ParamControl,
  type RegisteredAnimation,
} from '../animations';
import {
  addMapping,
  getCurrentSlide,
  getSelectedElements,
  setSelection,
  setSlideBackground,
  setSlideTransition,
  renameSlide,
  updateElements,
  updateMapping,
  useDeckStore,
  type AnimationElement,
  type Binding,
  type Listen,
  type SlideElement,
  type Transition,
} from '../deck';
import { learnSession, type Zone } from '../mapping';
import { BUNDLED_FONTS, isBundledFont, listSystemFonts } from '../render';
import { newId } from '../shared/util';
import { CheckField, ColourField, NumField, Section, SelectField, TextField } from './fields';
import { alignOffsets, type AlignMode } from './geometry';
import { useEditorUi } from './uiStore';

const NO_ZONES: readonly Zone[] = [];

const TYPE_LABEL: Record<SlideElement['type'], string> = {
  text: 'Text',
  shape: 'Shape',
  image: 'Image',
  animation: 'Animation',
};

function useSystemFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void listSystemFonts().then((list) => {
      if (live) setFonts(list);
    });
    return () => {
      live = false;
    };
  }, []);
  return fonts;
}

function FontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const system = useSystemFonts();
  const known = new Set<string>([...BUNDLED_FONTS, ...system]);
  return (
    <>
      <label className="field wide">
        <span>{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <optgroup label="Bundled (safe on any machine)">
            {BUNDLED_FONTS.map((f) => (
              <option key={f} value={f}>
                {f.replace(' Variable', '')}
              </option>
            ))}
          </optgroup>
          <optgroup label="Installed on this computer">
            {!known.has(value) && <option value={value}>{value}</option>}
            {system.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {!isBundledFont(value) && (
        <p className="hint warn">
          This font comes from this computer. On a machine without it, the text will fall back to a
          default font.
        </p>
      )}
    </>
  );
}

// ── Slide (nothing selected) ────────────────────────────────────────────────

function SlideProps() {
  const slide = useDeckStore((s) => getCurrentSlide(s));
  const selection = useDeckStore((s) => s.selection);
  if (!slide) return null;
  const layers = [...slide.elements].reverse();
  return (
    <>
      <Section title="Slide">
        <TextField
          label="Name"
          value={slide.name}
          placeholder="Used by “Go to named slide”"
          onChange={(v) => renameSlide(slide.id, v)}
        />
        <div className="grid2">
          <ColourField
            label="Background"
            value={slide.background.color}
            onChange={(v) => setSlideBackground(slide.id, v)}
          />
        </div>
      </Section>
      <Section title="Transition into this slide">
        <div className="grid2">
          <SelectField<Transition['kind']>
            label="Type"
            value={slide.transition.kind}
            options={[
              { value: 'cut', label: 'Cut' },
              { value: 'fade', label: 'Fade' },
              { value: 'slide', label: 'Slide' },
              { value: 'zoom', label: 'Zoom' },
            ]}
            onChange={(kind) => setSlideTransition(slide.id, { kind })}
          />
          <NumField
            label="Duration (ms)"
            value={slide.transition.duration}
            min={0}
            max={5000}
            step={50}
            onChange={(duration) => setSlideTransition(slide.id, { duration })}
          />
        </div>
      </Section>
      <Section title="Layers">
        {layers.length === 0 && (
          <p className="hint">
            This slide is empty. Add text, a shape, an image or an animation from the toolbar.
          </p>
        )}
        <div className="layers">
          {layers.map((el) => (
            <div
              key={el.id}
              className={selection.includes(el.id) ? 'layer selected' : 'layer'}
              onClick={() => setSelection([el.id])}
            >
              <span className="layer-type">{TYPE_LABEL[el.type]}</span>
              <span className="layer-name">
                {el.name || (el.type === 'text' ? el.text.slice(0, 24) : TYPE_LABEL[el.type])}
              </span>
              <button
                className={el.hidden ? 'icon on' : 'icon'}
                title={el.hidden ? 'Show' : 'Hide'}
                onClick={(e) => {
                  e.stopPropagation();
                  updateElements([el.id], (d) => void (d.hidden = !d.hidden), {
                    label: el.hidden ? 'Show' : 'Hide',
                  });
                }}
              >
                {el.hidden ? 'Hidden' : 'Shown'}
              </button>
              <button
                className={el.locked ? 'icon on' : 'icon'}
                title={el.locked ? 'Unlock' : 'Lock'}
                onClick={(e) => {
                  e.stopPropagation();
                  updateElements([el.id], (d) => void (d.locked = !d.locked), {
                    label: el.locked ? 'Unlock' : 'Lock',
                  });
                }}
              >
                {el.locked ? 'Locked' : 'Free'}
              </button>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ── Animation ───────────────────────────────────────────────────────────────

function ParamField({
  control,
  value,
  onChange,
}: {
  control: ParamControl;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (control.kind) {
    case 'number':
      return (
        <NumField
          label={control.label}
          // A slider where dragging is useful: a bounded range with enough steps to feel.
          slider={(control.max - control.min) / control.step >= 8}
          value={typeof value === 'number' ? value : control.default}
          min={control.min}
          max={control.max}
          step={control.step}
          onChange={onChange}
        />
      );
    case 'boolean':
      return <CheckField label={control.label} value={value === true} onChange={onChange} />;
    case 'choice':
      return (
        <SelectField
          label={control.label}
          value={typeof value === 'string' ? value : control.default}
          options={control.options.map((o) => ({ value: o, label: o }))}
          onChange={onChange}
        />
      );
    case 'colour':
      return (
        <ColourField
          label={control.label}
          value={typeof value === 'string' ? value : control.default}
          onChange={onChange}
        />
      );
    case 'font':
      return (
        <FontField
          label={control.label}
          value={typeof value === 'string' ? value : control.default}
          onChange={onChange}
        />
      );
    case 'text':
      return (
        <TextField
          label={control.label}
          value={typeof value === 'string' ? value : control.default}
          multiline={control.multiline}
          onChange={onChange}
        />
      );
  }
}

/** The animation's settings under its own headings; anything it did not place goes last. */
function groupControls(def: RegisteredAnimation): { title: string; controls: ParamControl[] }[] {
  const controls = controlsFor(def);
  if (def.groups.length === 0) return [{ title: '', controls }];
  const placed = new Set<string>();
  const groups = def.groups.map((group) => ({
    title: group.title,
    controls: group.params.flatMap((key) => {
      const control = controls.find((c) => c.key === key);
      if (!control || placed.has(key)) return [];
      placed.add(key);
      return [control];
    }),
  }));
  const rest = controls.filter((c) => !placed.has(c.key));
  if (rest.length > 0) groups.push({ title: 'More', controls: rest });
  return groups.filter((g) => g.controls.length > 0);
}

const SOURCE_OPTIONS: { value: Binding['source']; label: string }[] = [
  { value: 'velocity', label: 'Velocity (how hard)' },
  { value: 'cc', label: 'Knob / CC' },
  { value: 'pitchBend', label: 'Pitch bend' },
  { value: 'note', label: 'Note (pitch)' },
  { value: 'audioLevel', label: 'Sound: loudness' },
  { value: 'audioBass', label: 'Sound: bass' },
  { value: 'audioMid', label: 'Sound: middle' },
  { value: 'audioTreble', label: 'Sound: treble' },
  { value: 'audioBeat', label: 'Sound: beats' },
];

const CURVE_OPTIONS: { value: Binding['curve']; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'logarithmic', label: 'Logarithmic' },
];

function AnimationProps({ el }: { el: AnimationElement }) {
  const zones = useDeckStore((s) => s.deck?.zones) ?? NO_ZONES;
  const slideId = useDeckStore((s) => s.currentSlideId);
  const def = getAnimation(el.animationId);
  if (!def) {
    return (
      <Section title="Animation">
        <p className="hint warn">
          This deck uses an animation called “{el.animationId}” that this version of Stagekeys does
          not have. It is skipped during a show.
        </p>
      </Section>
    );
  }
  const params = def.parseParams(el.params);
  const bindable = bindableParams(def);
  const key = (suffix: string) => ({ coalesceKey: `anim:${el.id}:${suffix}` });
  const edit = (change: (a: AnimationElement) => void, suffix: string) =>
    updateElements([el.id], (d) => d.type === 'animation' && change(d), {
      label: 'Edit animation',
      ...key(suffix),
    });

  const setListen = (patch: Partial<Listen>) =>
    edit((a) => void Object.assign(a.listen, patch), 'listen');
  const setBinding = (index: number, patch: Partial<Binding>) =>
    edit((a) => {
      const b = a.bindings[index];
      if (b) Object.assign(b, patch);
    }, `binding:${index}`);

  const mapKey = () => {
    if (!slideId) return;
    const id = newId('map');
    const action = { type: 'anim.trigger' as const, elementId: el.id };
    addMapping(
      { kind: 'slide', slideId },
      {
        id,
        name: '',
        enabled: true,
        trigger: { kind: 'noteOn' },
        filters: {},
        action,
        curve: 'linear',
        min: 0,
        max: 1,
      },
    );
    useEditorUi.setState({ rightTab: 'mappings', focusMappingId: id });
    learnSession.start(id, action, (learned) => {
      const scope = { kind: 'slide' as const, slideId };
      updateMapping(
        scope,
        id,
        (m) => {
          m.trigger = learned.trigger;
          m.filters = { ...m.filters, ...learned.filters };
        },
        false,
      );
      // Show the key that was just learned on the controller map.
      useEditorUi.setState({ focusMappingId: id });
    });
  };

  return (
    <>
      <Section
        title={def.name}
        actions={
          <button
            onClick={() => dispatch({ type: 'anim.trigger', elementId: el.id, value: 1 }, 'ui')}
            data-testid="anim-test"
          >
            Test
          </button>
        }
      >
        <p className="hint">{def.description}</p>
        {groupControls(def).map((group) => (
          <div key={group.title} className="param-group" data-testid="param-group">
            {group.title && <h4>{group.title}</h4>}
            <div className="grid2">
              {group.controls.map((control) => {
                // A bound parameter follows MIDI, so its own field would have no effect.
                const binding = el.bindings.find((b) => b.param === control.key);
                if (binding) {
                  const source =
                    binding.source === 'cc'
                      ? `knob CC ${binding.controller}`
                      : (SOURCE_OPTIONS.find((o) => o.value === binding.source)?.label ??
                        binding.source);
                  return (
                    <div className="field" key={control.key}>
                      <span>{control.label}</span>
                      <span className="bound-note" data-testid="bound-note">
                        Follows {source.toLowerCase()}
                      </span>
                    </div>
                  );
                }
                return (
                  <ParamField
                    key={control.key}
                    control={control}
                    value={params[control.key]}
                    onChange={(value) =>
                      edit((a) => void (a.params[control.key] = value), `param:${control.key}`)
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Reacts to keys">
        <SelectField<Listen['mode']>
          label="Which keys"
          wide
          value={el.listen.mode}
          options={[
            { value: 'all', label: 'Any key that is not mapped to something else' },
            { value: 'zone', label: 'Keys in a zone' },
            { value: 'range', label: 'Keys in a note range' },
            { value: 'none', label: 'Only keys mapped to it' },
          ]}
          onChange={(mode) => setListen({ mode })}
        />
        {el.listen.mode === 'zone' &&
          (zones.length > 0 ? (
            <SelectField
              label="Zone"
              wide
              value={el.listen.zoneId ?? ''}
              options={[
                { value: '', label: 'Choose a zone…' },
                ...zones.map((z) => ({ value: z.id, label: z.name })),
              ]}
              onChange={(zoneId) => setListen({ zoneId: zoneId || undefined })}
            />
          ) : (
            <p className="hint">No zones yet. Create one in the Mappings tab.</p>
          ))}
        {el.listen.mode === 'range' && (
          <div className="grid2">
            <NumField
              label="From note"
              value={el.listen.from}
              min={0}
              max={127}
              onChange={(from) => setListen({ from })}
            />
            <NumField
              label="To note"
              value={el.listen.to}
              min={0}
              max={127}
              onChange={(to) => setListen({ to })}
            />
          </div>
        )}
        <button onClick={mapKey}>Map a specific key to trigger this…</button>
      </Section>

      <Section
        title="MIDI and sound bindings"
        actions={
          bindable.length > 0 && (
            <button
              data-testid="add-binding"
              onClick={() =>
                edit((a) => {
                  const first =
                    bindable.find((p) => !a.bindings.some((b) => b.param === p.key)) ?? bindable[0];
                  if (first) {
                    a.bindings.push({
                      param: first.key,
                      source: 'velocity',
                      controller: 1,
                      curve: 'linear',
                      min: first.min,
                      max: first.max,
                    });
                  }
                }, 'binding:add')
              }
            >
              + Bind
            </button>
          )
        }
      >
        {el.bindings.length === 0 && (
          <p className="hint">
            Bind a parameter to velocity, a knob, pitch bend or the sound input so it changes as you
            play or speak.
          </p>
        )}
        {el.bindings.map((b, i) => {
          const range = bindable.find((p) => p.key === b.param);
          return (
            <div className="binding" key={i} data-testid="binding">
              <div className="grid2">
                <SelectField
                  label="Parameter"
                  value={b.param}
                  options={bindable.map((p) => ({ value: p.key, label: p.label }))}
                  onChange={(param) => {
                    const next = bindable.find((p) => p.key === param);
                    setBinding(i, { param, min: next?.min ?? b.min, max: next?.max ?? b.max });
                  }}
                />
                <SelectField
                  label="Driven by"
                  value={b.source}
                  options={SOURCE_OPTIONS}
                  onChange={(source) => setBinding(i, { source })}
                />
                {b.source === 'cc' && (
                  <NumField
                    label="CC number"
                    value={b.controller}
                    min={0}
                    max={127}
                    onChange={(controller) => setBinding(i, { controller })}
                  />
                )}
                <SelectField
                  label="Curve"
                  value={b.curve}
                  options={CURVE_OPTIONS}
                  onChange={(curve) => setBinding(i, { curve })}
                />
                <NumField
                  label="At lowest"
                  value={b.min}
                  min={range?.min}
                  max={range?.max}
                  step={range?.step ?? 0.01}
                  onChange={(min) => setBinding(i, { min })}
                />
                <NumField
                  label="At highest"
                  value={b.max}
                  min={range?.min}
                  max={range?.max}
                  step={range?.step ?? 0.01}
                  onChange={(max) => setBinding(i, { max })}
                />
              </div>
              <button
                className="link danger"
                onClick={() => edit((a) => void a.bindings.splice(i, 1), 'binding:remove')}
              >
                Remove binding
              </button>
            </div>
          );
        })}
      </Section>
    </>
  );
}

// ── Element(s) ──────────────────────────────────────────────────────────────

const ALIGN: { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: 'Left' },
  { mode: 'centre', label: 'Centre' },
  { mode: 'right', label: 'Right' },
  { mode: 'top', label: 'Top' },
  { mode: 'middle', label: 'Middle' },
  { mode: 'bottom', label: 'Bottom' },
];

function ElementProps({ elements }: { elements: SlideElement[] }) {
  const canvas = useDeckStore((s) => s.deck?.meta.canvas);
  const first = elements[0];
  if (!first || !canvas) return null;
  const ids = elements.map((e) => e.id);
  const single = elements.length === 1 ? first : null;
  const idKey = ids.join(',');
  const edit = (change: (el: SlideElement) => void, field: string) =>
    updateElements(ids, change, { label: 'Edit', coalesceKey: `prop:${field}:${idKey}` });

  const align = (mode: AlignMode) => {
    const offsets = alignOffsets(elements, mode, canvas);
    updateElements(
      ids,
      (el) => {
        const o = offsets.get(el.id);
        if (!o) return;
        el.x = Math.round(el.x + o.x);
        el.y = Math.round(el.y + o.y);
      },
      { label: 'Align' },
    );
  };

  // Animations fill most of the slide and have many settings of their own, so their
  // position and arranging start folded away; other elements keep them open.
  const kind = single?.type === 'animation' ? 'animation' : 'element';

  return (
    <>
      <div className="element-head">
        <span className="element-type">
          {single ? TYPE_LABEL[single.type] : `${elements.length} elements`}
        </span>
        {single && (
          <input
            type="text"
            value={single.name}
            placeholder="Name (optional)"
            aria-label="Name"
            onChange={(e) => edit((el) => void (el.name = e.target.value), 'name')}
          />
        )}
      </div>

      {single?.type === 'text' && (
        <Section title="Text">
          <TextField
            label="Content"
            multiline
            value={single.text}
            onChange={(v) => edit((el) => el.type === 'text' && void (el.text = v), 'text')}
          />
          <FontField
            label="Font"
            value={single.fontFamily}
            onChange={(v) => edit((el) => el.type === 'text' && void (el.fontFamily = v), 'font')}
          />
          <div className="grid2">
            <NumField
              label="Size"
              value={single.fontSize}
              min={1}
              max={1000}
              onChange={(v) => edit((el) => el.type === 'text' && void (el.fontSize = v), 'size')}
            />
            <SelectField
              label="Weight"
              value={String(single.fontWeight)}
              options={[
                { value: '300', label: 'Light' },
                { value: '400', label: 'Regular' },
                { value: '500', label: 'Medium' },
                { value: '600', label: 'Semibold' },
                { value: '700', label: 'Bold' },
                { value: '800', label: 'Extra bold' },
              ]}
              onChange={(v) =>
                edit((el) => el.type === 'text' && void (el.fontWeight = Number(v)), 'weight')
              }
            />
            <ColourField
              label="Colour"
              value={single.color}
              onChange={(v) => edit((el) => el.type === 'text' && void (el.color = v), 'colour')}
            />
            <SelectField
              label="Align"
              value={single.align}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v) => edit((el) => el.type === 'text' && void (el.align = v), 'align')}
            />
            <NumField
              label="Line height"
              value={single.lineHeight}
              min={0.5}
              max={4}
              step={0.05}
              onChange={(v) => edit((el) => el.type === 'text' && void (el.lineHeight = v), 'lh')}
            />
          </div>
        </Section>
      )}

      {single?.type === 'shape' && (
        <Section title="Shape">
          <div className="grid2">
            {single.shape !== 'line' && (
              <ColourField
                label="Fill"
                value={single.fill}
                onChange={(v) => edit((el) => el.type === 'shape' && void (el.fill = v), 'fill')}
              />
            )}
            <ColourField
              label={single.shape === 'line' ? 'Colour' : 'Outline'}
              value={single.stroke}
              onChange={(v) => edit((el) => el.type === 'shape' && void (el.stroke = v), 'stroke')}
            />
            <NumField
              label={single.shape === 'line' ? 'Thickness' : 'Outline width'}
              value={single.strokeWidth}
              min={0}
              max={200}
              onChange={(v) => edit((el) => el.type === 'shape' && void (el.strokeWidth = v), 'sw')}
            />
            {single.shape === 'rect' && (
              <NumField
                label="Corner radius"
                value={single.cornerRadius}
                min={0}
                max={1000}
                onChange={(v) =>
                  edit((el) => el.type === 'shape' && void (el.cornerRadius = v), 'radius')
                }
              />
            )}
          </div>
        </Section>
      )}

      {single?.type === 'animation' && <AnimationProps el={single} />}

      {/* What the element is comes first; where it sits is needed less often. */}
      <Section
        key={`position:${kind}`}
        title="Position and size"
        collapsible
        id={`position:${kind}`}
        defaultOpen={kind !== 'animation'}
      >
        <div className="grid2">
          <NumField
            label="X"
            testId="prop-x"
            value={first.x}
            onChange={(v) => edit((el) => void (el.x = v), 'x')}
          />
          <NumField
            label="Y"
            testId="prop-y"
            value={first.y}
            onChange={(v) => edit((el) => void (el.y = v), 'y')}
          />
          <NumField
            label="Width"
            value={first.width}
            min={1}
            onChange={(v) => edit((el) => void (el.width = v), 'w')}
          />
          <NumField
            label="Height"
            value={first.height}
            min={1}
            onChange={(v) => edit((el) => void (el.height = v), 'h')}
          />
          <NumField
            label="Rotation°"
            value={first.rotation}
            min={-360}
            max={360}
            onChange={(v) => edit((el) => void (el.rotation = v), 'rot')}
          />
          <NumField
            label="Opacity"
            slider
            value={first.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => edit((el) => void (el.opacity = v), 'opacity')}
          />
        </div>
        <div className="row">
          <CheckField
            label="Locked"
            value={first.locked}
            onChange={(v) => edit((el) => void (el.locked = v), 'locked')}
          />
          <CheckField
            label="Hidden"
            value={first.hidden}
            onChange={(v) => edit((el) => void (el.hidden = v), 'hidden')}
          />
        </div>
      </Section>

      <Section
        key={`arrange:${kind}`}
        title="Arrange"
        collapsible
        id={`arrange:${kind}`}
        defaultOpen={kind !== 'animation'}
      >
        <div className="button-grid">
          {ALIGN.map((a) => (
            <button
              key={a.mode}
              onClick={() => align(a.mode)}
              title={
                single
                  ? `Align ${a.label.toLowerCase()} on the slide`
                  : `Align ${a.label.toLowerCase()}`
              }
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="button-grid">
          <button onClick={() => dispatch({ type: 'edit.order', to: 'front' }, 'ui')}>
            To front
          </button>
          <button onClick={() => dispatch({ type: 'edit.order', to: 'forward' }, 'ui')}>
            Forward
          </button>
          <button onClick={() => dispatch({ type: 'edit.order', to: 'backward' }, 'ui')}>
            Backward
          </button>
          <button onClick={() => dispatch({ type: 'edit.order', to: 'back' }, 'ui')}>
            To back
          </button>
          <button onClick={() => dispatch({ type: 'edit.duplicate' }, 'ui')}>Duplicate</button>
          <button className="danger" onClick={() => dispatch({ type: 'edit.delete' }, 'ui')}>
            Delete
          </button>
        </div>
      </Section>
    </>
  );
}

export function PropertiesPanel() {
  const selected = useDeckStore(useShallow((s) => getSelectedElements(s)));
  return (
    <div className="panel-scroll" data-testid="properties-panel">
      {selected.length === 0 ? <SlideProps /> : <ElementProps elements={selected} />}
    </div>
  );
}
