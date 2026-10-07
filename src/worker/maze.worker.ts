import { MazeState } from '../algorithms/maze';
import { getGenerator, getPathfinder } from '../algorithms/registry';
import type { AlgorithmEvent, Phase } from '../core/types';
import { emptyStats, type WorkerRequest, type WorkerResponse } from './protocol';

/**
 * Web Worker: здесь реально выполняются алгоритмы.
 *
 * Главный поток только «затягивает» готовые события (pull) — поэтому ни
 * генерация 200×200, ни BFS никогда не блокируют интерфейс.
 */

interface WorkerScope {
    onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
    postMessage(message: WorkerResponse): void;
}

const ctx = self as unknown as WorkerScope;

let maze: MazeState | null = null;
let iterator: Iterator<AlgorithmEvent> | null = null;
let phase: Phase = 'none';
let genFinished = false;
let done = false;
let stats = emptyStats();
let estSteps = 0;

function resetAll(): void {
    maze = null;
    iterator = null;
    phase = 'none';
    genFinished = false;
    done = false;
    stats = emptyStats();
    estSteps = 0;
}

/**
 * Отмена текущей задачи.
 *
 * Важно: если генерация уже завершена и идёт (или завершён) поиск, лабиринт
 * сохраняется — панель остаётся в состоянии «Generation Complete», и кнопка
 * «Найти путь» должна работать повторно, а не падать с «Лабиринт ещё не
 * сгенерирован».
 */
function handleReset(): void {
    if (maze && phase === 'search') {
        iterator = null;
        done = true;
        phase = 'gen';
        genFinished = true;
        return;
    }
    resetAll();
}

function handleGenerate(msg: WorkerRequest & { type: 'generate' }): void {
    resetAll();
    maze = new MazeState(msg.size);
    const algo = getGenerator(msg.generatorId);
    iterator = algo.create(maze);
    phase = 'gen';
    stats = { ...emptyStats(), phase: 'gen', size: msg.size, algorithm: algo.name };
    estSteps = 2 * msg.size * msg.size;
    ctx.postMessage({
        type: 'ready',
        id: msg.id,
        epoch: msg.epoch,
        phase: 'gen',
        size: msg.size,
        estSteps,
        algorithm: algo.name,
    });
}

function handleSearch(msg: WorkerRequest & { type: 'search' }): void {
    if (!maze) throw new Error('Лабиринт ещё не сгенерирован');
    if (phase === 'gen' && !genFinished) throw new Error('Генерация ещё не завершена');
    iterator = getPathfinder(msg.pathfinderId).create(maze);
    phase = 'search';
    genFinished = false;
    done = false;
    stats = { ...emptyStats(), phase: 'search', size: maze.size, algorithm: getPathfinder(msg.pathfinderId).name };
    estSteps = 2 * maze.cellCount;
    ctx.postMessage({
        type: 'ready',
        id: msg.id,
        epoch: msg.epoch,
        phase: 'search',
        size: maze.size,
        estSteps,
        algorithm: stats.algorithm,
    });
}

function updateStats(event: AlgorithmEvent): void {
    switch (event.type) {
        case 'gen:init':
            stats.size = event.size;
            break;
        case 'gen:enter':
            stats.visited = 1;
            stats.progress = 1 / (stats.size * stats.size);
            break;
        case 'gen:carve':
            stats.visited++;
            stats.progress = Math.min(1, stats.visited / (stats.size * stats.size));
            break;
        case 'gen:backtrack':
            stats.backtracks++;
            break;
        case 'gen:done':
            stats.visited = event.visited;
            stats.backtracks = event.backtracks;
            stats.progress = 1;
            break;
        case 'search:expand':
            stats.explored++;
            stats.queue = event.queue;
            stats.progress = Math.min(1, stats.explored / Math.max(1, stats.size * stats.size));
            break;
        case 'search:path':
            stats.pathLength = event.cells.length;
            break;
        case 'search:done':
            stats.explored = event.explored;
            stats.pathLength = event.pathLength;
            break;
        default:
            break;
    }
}

function handlePull(msg: WorkerRequest & { type: 'pull' }): void {
    const events: AlgorithmEvent[] = [];
    if (iterator && !done) {
        const t0 = performance.now();
        for (let i = 0; i < msg.count; i++) {
            const result = iterator.next();
            if (result.done) {
                done = true;
                break;
            }
            const event = result.value;
            events.push(event);
            updateStats(event);
            if (event.type === 'gen:done') {
                genFinished = true;
                done = true;
                break;
            }
            if (event.type === 'search:done') {
                done = true;
                break;
            }
        }
        // Браузер может приостановить воркер (фоновая вкладка) прямо внутри
        // pull'а — такие «просадки» не являются временем расчёта алгоритма.
        const elapsed = performance.now() - t0;
        if (elapsed < 200) stats.timeMs += elapsed;
    }
    ctx.postMessage({
        type: 'events',
        id: msg.id,
        epoch: msg.epoch,
        events,
        stats: { ...stats },
        done,
    });
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
    const msg = ev.data;
    try {
        switch (msg.type) {
            case 'generate':
                handleGenerate(msg);
                break;
            case 'search':
                handleSearch(msg);
                break;
            case 'pull':
                handlePull(msg);
                break;
            case 'reset':
                handleReset();
                break;
            default:
                break;
        }
    } catch (error) {
        ctx.postMessage({
            type: 'error',
            id: 'id' in msg ? (msg.id as number) : -1,
            epoch: 'epoch' in msg ? (msg.epoch as number) : -1,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
