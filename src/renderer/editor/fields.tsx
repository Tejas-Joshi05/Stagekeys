import { useEffect, useState, type ReactNode } from 'react';

export function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

interface NumProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  /** Also show a slider. Needs both `min` and `max`. */
  slider?: boolean;
}

/** Number input that only commits valid, in-range numbers and tolerates half-typed values. */
export function NumField({ label, value, onChange, min, max, step = 1, testId, slider }: NumProps) {
  const shown = Number.isInteger(step)
    ? String(Math.round(value))
    : String(Number(value.toFixed(3)));
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(shown);
  }, [shown, focused]);

  const number = (
    <input
      type="number"
      data-testid={testId}
      value={draft}
      min={min}
      max={max}
      step={step}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(shown);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
        const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
        if (clamped !== value) onChange(clamped);
      }}
    />
  );
  if (!slider || min === undefined || max === undefined)
    return <Field label={label}>{number}</Field>;
  return (
    <Field label={label}>
      <span className="slider-field">
        <input
          type="range"
          aria-label={`${label} slider`}
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n !== value) onChange(n);
          }}
        />
        {number}
      </span>
    </Field>
  );
}

export function TextField({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} wide>
      {multiline ? (
        <textarea
          value={value}
          rows={4}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <span className="colour-field">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <code>{value}</code>
      </span>
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  wide,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <Field label={label} wide={wide}>
      <select value={value} data-testid={testId} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const SECTION_KEY = 'stagekeys.section.';

function readOpen(id: string | undefined, fallback: boolean): boolean {
  if (!id) return fallback;
  try {
    const saved = globalThis.localStorage?.getItem(SECTION_KEY + id);
    return saved === null || saved === undefined ? fallback : saved === 'open';
  } catch {
    return fallback;
  }
}

/**
 * A titled block in a side panel. With `collapsible` and an `id`, the title
 * folds the block away and the choice is remembered, so settings that are
 * rarely needed stay out of the way.
 */
export function Section({
  title,
  children,
  actions,
  collapsible,
  id,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  /** Remembers the open/closed choice under this name. */
  id?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => (collapsible ? readOpen(id, defaultOpen) : true));
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (!id) return;
    try {
      globalThis.localStorage?.setItem(SECTION_KEY + id, next ? 'open' : 'closed');
    } catch {
      // Not remembered; harmless.
    }
  };
  return (
    <section className={open ? 'section' : 'section closed'}>
      <header>
        {collapsible ? (
          <h3>
            <button
              className="section-toggle"
              aria-expanded={open}
              onClick={toggle}
              data-testid={id ? `section-${id}` : undefined}
            >
              <span className="chevron" aria-hidden>
                {open ? '▾' : '▸'}
              </span>
              {title}
            </button>
          </h3>
        ) : (
          <h3>{title}</h3>
        )}
        {open && actions}
      </header>
      {open && children}
    </section>
  );
}
