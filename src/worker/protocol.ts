import type { AlgorithmEvent, Phase, StatsView } from '../core/types';

/** Запросы главному потоку → воркеру. */
export type WorkerRequest =
    | { type: 'generate'; id: number; epoch: number; size: number; generatorId: string }
    | { type: 'pull'; id: number; epoch: number; count: number }
    | { type: 'search'; id: number; epoch: number; pathfinderId: string }
    | { type: 'reset'; id: number; epoch: number };

/** Ответы воркера → главному потоку. */
export type WorkerResponse =
    | { type: 'ready'; id: number; epoch: number; phase: Phase; size: number; estSteps: number; algorithm: string }
    | { type: 'events'; id: number; epoch: number; events: AlgorithmEvent[]; stats: StatsView; done: boolean }
    | { type: 'error'; id: number; epoch: number; message: string };

export function emptyStats(): StatsView {
    return {
        phase: 'none',
        algorithm: '—',
        size: 0,
        progress: 0,
        visited: 0,
        backtracks: 0,
        explored: 0,
        queue: 0,
        pathLength: -1,
        timeMs: 0,
    };
}
