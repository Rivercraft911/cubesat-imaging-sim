import { createRoot } from 'react-dom/client';
import App from './app/App';
import './app/styles.css';

export function mountSimulator(element: HTMLElement, onRendererFailure: (message: string) => void) {
  const root = createRoot(element, {
    onUncaughtError: error => {
      console.error(error);
      queueMicrotask(() => onRendererFailure(error instanceof Error ? error.message : String(error)));
    },
  });
  root.render(<App onRendererFailure={onRendererFailure} />);
  return () => root.unmount();
}
