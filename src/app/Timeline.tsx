import { useEffect, useRef } from 'react';
import { fmt } from './fields';

export function Timeline({ time, setTime, playing, setPlaying, speed, setSpeed, rangeM, elevation }: {
  time: number; setTime: (time: number) => void; playing: boolean; setPlaying: (playing: boolean) => void;
  speed: number; setSpeed: (speed: number) => void; rangeM: number; elevation: number;
}) {
  const clock = useRef(time); clock.current = time;
  useEffect(() => {
    if (!playing) return;
    let frame = 0, previous = performance.now(), emitted = previous;
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - previous) / 1000); previous = now;
      if (!document.hidden) clock.current += dt * speed;
      if (clock.current >= 360) { setTime(360); setPlaying(false); return; }
      if (now - emitted >= 90) { setTime(clock.current); emitted = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, setTime, setPlaying]);
  return <section className="pass-strip" aria-label="Pass playback">
    <button className="play-button" aria-label={playing ? 'Pause pass' : 'Play pass'} onClick={() => setPlaying(!playing)}>{playing ? 'Ⅱ' : '▶'}</button>
    <span className="pass-time">{time < 0 ? '−' : '+'}{fmt(Math.abs(time), 1)} <small>s</small></span>
    <div className="pass-track"><input aria-label="Pass time" type="range" min="-360" max="360" step="0.1" value={time} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} /><div><span>approach</span><button onClick={() => { setPlaying(false); setTime(0); }}>closest approach</button><span>departure</span></div></div>
    <select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[0.1, 0.25, 0.5, 1, 5, 10, 30].map(n => <option key={n} value={n}>{n}×</option>)}</select>
    <div className="pass-range"><span>{fmt(rangeM / 1000, 1)} km</span><small>{fmt(elevation, 1)}° elevation</small></div>
  </section>;
}
