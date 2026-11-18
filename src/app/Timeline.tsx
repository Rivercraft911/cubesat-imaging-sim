import { useEffect, useLayoutEffect, useRef } from 'react';
import { fmt } from './fields';
import { PASS_END_S, PlaybackClock } from './playback-clock';

export function Timeline({ time, onFrameTime, onSeek, playing, setPlaying, speed, setSpeed, rangeM, elevation }: {
  time: number; onFrameTime: (time: number) => void; onSeek: (time: number) => void;
  playing: boolean; setPlaying: (playing: boolean) => void;
  speed: number; setSpeed: (speed: number) => void; rangeM: number; elevation: number;
}) {
  const playhead = useRef(time);
  const activeClock = useRef<PlaybackClock | null>(null);
  useLayoutEffect(() => { playhead.current = time; }, [time]);

  useEffect(() => {
    if (!playing) return;
    const started = performance.now();
    const clock = new PlaybackClock(playhead.current, speed, started);
    activeClock.current = clock;
    let frame = 0;
    const tick = (now: number) => {
      const next = clock.sample(now);
      if (next !== null) {
        onFrameTime(next);
        if (next === PASS_END_S) {
          setPlaying(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const syncVisibility = () => {
      const now = performance.now();
      cancelAnimationFrame(frame);
      if (document.hidden) {
        clock.pause(now);
        const currentTime = clock.timeAt(now);
        onFrameTime(currentTime);
        if (currentTime === PASS_END_S) setPlaying(false);
      } else {
        clock.resume(now);
        frame = requestAnimationFrame(tick);
      }
    };
    if (document.hidden) clock.pause(started);
    else frame = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      cancelAnimationFrame(frame);
      activeClock.current = null;
    };
  }, [playing, speed, onFrameTime, setPlaying]);

  const savePlayhead = () => {
    if (activeClock.current) onFrameTime(activeClock.current.timeAt(performance.now()));
  };
  const seek = (timeS: number) => {
    setPlaying(false);
    onSeek(timeS);
  };
  const atEnd = time >= PASS_END_S;
  const playLabel = playing ? 'Pause pass' : atEnd ? 'Replay pass' : 'Play pass';

  return <section className="pass-strip" aria-label="Pass playback">
    <button className="play-button" aria-label={playLabel} title={playLabel} onClick={() => {
      if (playing) savePlayhead();
      else if (atEnd) onSeek(-PASS_END_S);
      setPlaying(!playing);
    }}>{playing ? 'Ⅱ' : '▶'}</button>
    <span className="pass-time">{time < 0 ? '−' : '+'}{fmt(Math.abs(time), 1)} <small>s</small></span>
    <div className="pass-track">
      <input aria-label="Pass time" type="range" min={-PASS_END_S} max={PASS_END_S} step="0.1" value={time}
        onChange={event => seek(event.currentTarget.valueAsNumber)} />
      <div>
        <span>approach</span>
        <button onClick={() => seek(0)}>closest approach</button>
        <span>departure</span>
      </div>
    </div>
    <select aria-label="Playback speed" value={speed} onChange={event => {
      savePlayhead();
      setSpeed(Number(event.currentTarget.value));
    }}>
      {[0.1, 0.25, 0.5, 1, 5, 10, 30].map(n => <option key={n} value={n}>{n}×</option>)}
    </select>
    <div className="pass-range"><span>{fmt(rangeM / 1000, 1)} km</span><small>{fmt(elevation, 1)}° elevation</small></div>
  </section>;
}
