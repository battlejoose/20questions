import './game.css';
import { GameApp } from './game/GameApp';

const canvas = document.querySelector<HTMLCanvasElement>('#portrait-canvas');
if (!canvas) throw new Error('Missing #portrait-canvas element.');

const game = new GameApp(canvas);
void game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
