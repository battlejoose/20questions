import './styles.css';
import { PortraitApp } from './portrait/PortraitApp';

const canvas = document.querySelector<HTMLCanvasElement>('#portrait-canvas');

if (!canvas) {
  throw new Error('Missing #portrait-canvas element.');
}

const portrait = new PortraitApp(canvas);
portrait.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    portrait.dispose();
  });
}
