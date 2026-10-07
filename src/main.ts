import './styles.css';

import { AppController } from './core/controller';
import { DEFAULT_SIZE, DEFAULT_SPEED } from './core/config';
import { MazeWorkerClient } from './core/workerClient';
import { MazeRenderer } from './render/renderer';
import { Panel } from './ui/panel';

function showFatal(message: string): void {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    viewport.replaceChildren();
    const box = document.createElement('div');
    box.className = 'fatal';
    box.innerHTML = `<strong>3D Maze не смог запуститься</strong><span></span>`;
    (box.querySelector('span') as HTMLElement).textContent = message;
    viewport.appendChild(box);
}

function boot(): void {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;

    let renderer: MazeRenderer;
    try {
        renderer = new MazeRenderer(viewport);
    } catch (error) {
        showFatal(error instanceof Error ? error.message : String(error));
        return;
    }

    const client = new MazeWorkerClient();
    const controller = new AppController(renderer, client);
    const panel = new Panel(controller);
    const sceneHint = document.getElementById('sceneHint');

    renderer.setSize(DEFAULT_SIZE);
    renderer.clearMaze();
    controller.setSpeed(DEFAULT_SPEED);

    controller.on('phase', (phase) => {
        if (phase === 'generationComplete') renderer.autoSweep();
        else renderer.stopSweep();
        // Подсказка первого экрана нужна только в состоянии покоя.
        if (sceneHint) sceneHint.hidden = phase !== 'idle';
    });

    let last = performance.now();
    const loop = (now: number): void => {
        const dt = Math.max(0, (now - last) / 1000);
        last = now;
        controller.tick(now);
        renderer.flush();
        renderer.renderFrame(dt);
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    window.addEventListener('beforeunload', () => {
        controller.dispose();
    });

    // Отладочный доступ в консоли.
    (window as unknown as Record<string, unknown>).__maze = { controller, renderer, panel };
}

boot();
