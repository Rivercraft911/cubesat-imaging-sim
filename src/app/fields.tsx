import { useEffect, useState } from 'react';

function numberFieldText(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function commitNumberDraft(text: string, currentValue: number, digits: number, min = -Infinity, max = Infinity) {
  const parsedValue = Number(text);
  const value = text === numberFieldText(currentValue, digits) || !text.trim() || !Number.isFinite(parsedValue)
    ? currentValue
    : Math.min(max, Math.max(min, parsedValue));
  return { value, text: numberFieldText(value, digits) };
}

export function NumberField({ label, value, onChange, unit, min, max, step = 1, digits = 2 }: {
  label: string; value: number; onChange: (value: number) => void; unit?: string;
  min?: number; max?: number; step?: number; digits?: number;
}) {
  const [text, setText] = useState(() => numberFieldText(value, digits));
  useEffect(() => setText(numberFieldText(value, digits)), [value, digits]);
  const commit = () => {
    const next = commitNumberDraft(text, value, digits, min, max);
    setText(next.text);
    if (next.value !== value) onChange(next.value);
  };
  return <label className="number-field">
    <span>{label}</span>
    <div>
      <input type="number" value={text} min={min} max={max} step={step}
        onChange={event => setText(event.currentTarget.value)} onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }} />
      <small>{unit}</small>
    </div>
  </label>;
}

export function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[];
}) {
  return <label className="select-field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}</select></label>;
}

export function fmt(value: number, digits = 1): string { return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—'; }

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
