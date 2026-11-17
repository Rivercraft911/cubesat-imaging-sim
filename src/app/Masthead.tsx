import { useRef } from 'react';
import type { RenderView } from '../render';
import { Icon } from './Icon';

const views: { id: RenderView; label: string }[] = [
  { id: 'image', label: 'Image' },
  { id: 'space', label: 'Space' },
  { id: 'panorama', label: '360°' },
];

export function Masthead({ view, onViewChange, onImport, onSave, onCapture, ready, capturing }: {
  view: RenderView;
  onViewChange: (view: RenderView) => void;
  onImport: (file: File) => Promise<void>;
  onSave: () => void;
  onCapture: () => Promise<void>;
  ready: boolean;
  capturing: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <header className="masthead">
      <details className="session-menu" ref={menu} onKeyDown={event => {
        if (event.key === 'Escape' && menu.current) menu.current.open = false;
      }}>
        <summary aria-label="Scenario menu" title="Scenario menu"><Icon name="menu" /></summary>
        <div className="menu-content">
          <strong>Field of View</strong>
          <button onClick={() => { fileInput.current?.click(); if (menu.current) menu.current.open = false; }}>Open scenario…</button>
          <button onClick={() => { onSave(); if (menu.current) menu.current.open = false; }}>Save scenario</button>
        </div>
      </details>
      <nav aria-label="Workspace">
        {views.map(({ id, label }) => (
          <button key={id} className={view === id ? 'active' : ''} aria-pressed={view === id}
            onClick={() => onViewChange(id)}>{label}</button>
        ))}
      </nav>
      <button className="capture-button" aria-label={view === 'panorama' ? 'Export 360 equirectangular PNG' : 'Export native-resolution PNG'}
        title={view === 'panorama' ? 'Export source panorama as a 4096 × 2048 equirectangular PNG' : 'Export native-resolution source PNG'}
        onClick={() => void onCapture()} disabled={!ready || capturing}>
        <Icon name="export" size={16} /><span>{capturing ? 'Exporting…' : 'Export image'}</span>
      </button>
      <input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void onImport(file);
      }} />
    </header>
  );
}
