import type { AlgorithmEvent, StatsView } from './types';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

/** Ошибка «устаревшего» запроса: воркер уже переключился на новую задачу. */
export class StaleRequestError extends Error {
    constructor() {
        super('Запрос устарел');
        this.name = 'StaleRequestError';
    }
}

interface Pending {
    expect: 'ready' | 'events';
    resolve: (value: any) => void;
    reject: (error: Error) => void;
}

export interface ReadyInfo {
    phase: 'gen' | 'search';
    size: number;
    estSteps: number;
    algorithm: string;
}

export interface EventsInfo {
    events: AlgorithmEvent[];
    stats: StatsView;
    done: boolean;
}

/**
 * Тонкая обёртка над Web Worker'ом: request/response с защитой от гонок
 * через счётчик эпох. Сброс/новая генерация инвалидируют все «в полёте»
 * запросы, поэтому опоздавшие события старого лабиринта отбрасываются.
 */
export class MazeWorkerClient {
    private worker: Worker;
    private epoch = 0;
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private errorHandler: ((message: string) => void) | null = null;

    constructor() {
        this.worker = new Worker(new URL('../worker/maze.worker.ts', import.meta.url), {
            type: 'module',
            name: 'maze-worker',
        });
        this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
        this.worker.onerror = (ev: ErrorEvent) => {
            this.failAll(ev.message || 'Ошибка воркера');
        };
    }

    onError(handler: (message: string) => void): void {
        this.errorHandler = handler;
    }

    generate(size: number, generatorId = 'randomized-dfs'): Promise<ReadyInfo> {
        const id = this.nextId++;
        const epoch = this.epoch + 1;
        this.epoch = epoch;
        this.invalidate();
        return this.request(id, epoch, 'ready', {
            type: 'generate',
            size,
            generatorId,
        } as const);
    }

    search(pathfinderId = 'bfs'): Promise<ReadyInfo> {
        const id = this.nextId++;
        const epoch = this.epoch + 1;
        this.epoch = epoch;
        this.invalidate();
        return this.request(id, epoch, 'ready', { type: 'search', pathfinderId } as const);
    }

    pull(count: number): Promise<EventsInfo> {
        const id = this.nextId++;
        const epoch = this.epoch;
        return this.request(id, epoch, 'events', { type: 'pull', count } as const);
    }

    /** Отменить текущую задачу в воркере. */
    reset(): void {
        const id = this.nextId++;
        const epoch = this.epoch + 1;
        this.epoch = epoch;
        this.invalidate();
        const msg: WorkerRequest = { type: 'reset', id, epoch };
        this.worker.postMessage(msg);
    }

    dispose(): void {
        this.invalidate();
        this.worker.terminate();
    }

    private request<T>(id: number, epoch: number, expect: Pending['expect'], body: object): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { expect, resolve, reject });
            const msg = { id, epoch, ...body } as WorkerRequest;
            this.worker.postMessage(msg);
        });
    }

    private invalidate(): void {
        for (const entry of this.pending.values()) entry.reject(new StaleRequestError());
        this.pending.clear();
    }

    private failAll(message: string): void {
        for (const entry of this.pending.values()) entry.reject(new Error(message));
        this.pending.clear();
        this.errorHandler?.(message);
    }

    private onMessage(data: WorkerResponse): void {
        if (data.epoch !== this.epoch) return; // устаревший ответ

        if (data.type === 'error') {
            const pending = this.pending.get(data.id);
            if (pending) {
                this.pending.delete(data.id);
                pending.reject(new Error(data.message));
            } else {
                this.errorHandler?.(data.message);
            }
            return;
        }

        const pending = this.pending.get(data.id);
        if (!pending) return;
        if (data.type !== pending.expect) return;
        this.pending.delete(data.id);
        pending.resolve(data);
    }
}
