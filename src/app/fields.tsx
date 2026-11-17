import { useEffect, useState } from 'react';

export function NumberField({ label, value, onChange, unit, min, max, step = 1, digits = 2 }: {
  label: string; value: number; onChange: (value: number) => void; unit?: string;
  min?: number; max?: number; step?: number; digits?: number;
}) {
  const [text, setText] = useState(String(Number(value.toFixed(digits))));
  useEffect(() => setText(String(Number(value.toFixed(digits)))), [value, digits]);
  const commit = () => {
    if (text === String(Number(value.toFixed(digits)))) return;
    const next = Number(text);
    if (text.trim() && Number.isFinite(next)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
    else setText(String(value));
  };
  return <label className="number-field"><span>{label}</span><div><input type="number" value={text} min={min} max={max} step={step} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }} /><small>{unit}</small></div></label>;
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
