import { EventDispatcher } from './dispatcher';
import { EventQueue } from './eventQueue';
import { emptyStats } from '../worker/protocol';
import { GENERATORS, PATHFINDERS } from '../algorithms/registry';
import type { AlgorithmEvent, AppPhase, SceneApi, StatsView } from './types';
import { MazeWorkerClient, StaleRequestError, type EventsInfo, type ReadyInfo } from './workerClient';

interface Events {
    phase: AppPhase;
    stats: StatsView;
}

type Listener<K extends keyof Events> = (payload: Events[K]) => void;

const MAX_MS_PER_FRAME = 8;
const MAX_QUEUE_TARGET = 4096;
/** Как часто (мс) обновляется панель статистики во время работы алгоритма. */
const STATS_EMIT_INTERVAL_MS = 100;

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/**
 * Playback / Animation controller.
 *
 * Владеет: состоянием приложения, очередью событий, скоростью,
 * паузой/продолжением/пошаговым режимом.
 *
 * Алгоритмы выполняются в Web Worker, а главный поток лишь «расходует»
 * события — по столько, сколько допускает текущая скорость и бюджет кадра.
 * Поэтому даже на 200×200 UI не подвисает.
 */
export class AppController {
    private readonly scene: SceneApi;
    private readonly client: MazeWorkerClient;
    private readonly dispatcher: EventDispatcher;
    private readonly queue = new EventQueue<AlgorithmEvent>();

    private listeners = new Map<string, Set<(payload: any) => void>>();
    private errorMessage = '';

    private phase: AppPhase = 'idle';
    private size = 0;
    private speed = 1;

    private ready = false;
    private queueDone = false;
    private pullInFlight = false;
    private pullPromise: Promise<void> | null = null;
    private estSteps = 1;
    private lastMs = 0;
    private stepAccumulator = 0;
    private statsDirty = false;
    private statsImmediate = false;
    private lastStatsEmit = 0;
    /** Время расчёта алгоритма (в воркере) — единственное, что берётся из воркера. */
    private workerComputeMs = 0;
    private disposed = false;

    private stats: StatsView = emptyStats();
    private lastGenStats: StatsView | null = null;

    readonly generatorName = GENERATORS[0].name;
    readonly pathfinderName = PATHFINDERS[0].name;

    constructor(scene: SceneApi, client: MazeWorkerClient) {
        this.scene = scene;
        this.client = client;
        this.dispatcher = new EventDispatcher(scene);

        this.client.onError((message) => this.fail(message));
    }

    /* ---------------------------------------------------- pub/sub */

    on<K extends keyof Events>(event: K, listener: Listener<K>): () => void {
        const key = event as string;
        let set = this.listeners.get(key);
        if (!set) {
            set = new Set();
            this.listeners.set(key, set);
        }
        const stored = set;
        stored.add(listener as (payload: any) => void);
        return () => {
            stored.delete(listener as (payload: any) => void);
        };
    }

    private emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        const set = this.listeners.get(event as string);
        if (!set) return;
        for (const listener of set) listener(payload);
    }

    /* --------------------------------------------------- getters */

    getPhase(): AppPhase {
        return this.phase;
    }

    getSize(): number {
        return this.size;
    }

    getSpeed(): number {
        return this.speed;
    }

    getStats(): StatsView {
        return this.stats;
    }

    /* ---------------------------------------------------- actions */

    async generate(size: number): Promise<void> {
        if (this.disposed) return;
        this.size = size;
        this.dispatcher.reset();
        this.queue.clear();
        this.queueDone = false;
        this.ready = false;
        this.lastGenStats = null;
        this.workerComputeMs = 0;
        this.stats = {
            ...emptyStats(),
            phase: 'gen',
            size,
            algorithm: this.generatorName,
        };

        this.scene.setSize(size);
        this.scene.resetScene();
        this.setPhase('generating');
        this.pushStats();

        try {
            const ready: ReadyInfo = await this.client.generate(size);
            if (this.disposed) return;
            this.estSteps = Math.max(1, ready.estSteps);
            this.stats = { ...this.stats, algorithm: ready.algorithm };
            this.ready = true;
            this.pushStats();
        } catch (error) {
            if (!(error instanceof StaleRequestError)) this.fail(error);
        }
    }

    async findPath(): Promise<void> {
        if (this.disposed) return;
        if (this.phase !== 'generationComplete' && this.phase !== 'pathFound') return;

        this.queue.clear();
        this.queueDone = false;
        this.ready = false;
        this.workerComputeMs = 0;
        this.stats = {
            ...emptyStats(),
            phase: 'search',
            size: this.size,
            algorithm: this.pathfinderName,
        };

        this.scene.clearOverlay();
        this.setPhase('searching');
        this.pushStats();

        try {
            const ready: ReadyInfo = await this.client.search();
            if (this.disposed) return;
            this.estSteps = Math.max(1, ready.estSteps);
            this.stats = { ...this.stats, algorithm: ready.algorithm };
            this.ready = true;
            this.pushStats();
        } catch (error) {
            if (!(error instanceof StaleRequestError)) this.fail(error);
        }
    }

    pause(): void {
        if (this.phase === 'generating') this.setPhase('generationPaused');
        else if (this.phase === 'searching') this.setPhase('searchPaused');
    }

    resume(): void {
        if (this.phase === 'generationPaused') this.setPhase('generating');
        else if (this.phase === 'searchPaused') this.setPhase('searching');
    }

    setSpeed(multiplier: number): void {
        this.speed = multiplier;
    }

    /** Пошаговое продвижение: один шаг алгоритма (для больших лабиринтов — группа шагов). */
    async step(): Promise<void> {
        if (this.disposed) return;
        if (!this.canStep()) return;
        const want = this.stepSize;
        if (this.queue.size < want && !this.queueDone && this.ready) {
            await this.fillQueue(want);
        }
        this.drain(want, 16);
        this.pushStats(true);
    }

    /** Сброс: отмена текущей операции и возврат к корректному состоянию. */
    reset(): void {
        if (this.disposed) return;
        const current = this.phase;
        this.queue.clear();
        this.queueDone = false;
        this.ready = false;
        this.client.reset();
        this.dispatcher.reset();

        if (current === 'searching' || current === 'searchPaused' || current === 'pathFound') {
            // Поиск отменён — лабиринт остаётся, возвращаем статистику генерации.
            this.scene.clearOverlay();
            this.stats = this.lastGenStats
                ? { ...this.lastGenStats, phase: 'gen', progress: 1 }
                : { ...emptyStats(), phase: 'gen', size: this.size, algorithm: this.generatorName, progress: 1 };
            this.setPhase('generationComplete');
            this.pushStats(true);
            return;
        }

        this.scene.clearMaze();
        this.stats = { ...emptyStats(), size: this.size, algorithm: this.generatorName };
        this.setPhase('idle');
        this.pushStats(true);
    }

    resetCamera(): void {
        this.scene.resetCamera();
    }

    dispose(): void {
        this.disposed = true;
        this.queue.clear();
        this.client.dispose();
    }

    /* --------------------------------------------------- main loop */

    /** Вызывается из requestAnimationFrame. */
    tick(nowMs: number): void {
        // Предел 1 с: даже если браузер троттлит rAF (окно свёрнуто/перекрыто),
        // воспроизведение остаётся в реальном времени, а не уходит в замедление.
        const dt = this.lastMs === 0 ? 0 : Math.min(1, (nowMs - this.lastMs) / 1000);
        this.lastMs = nowMs;

        if (this.phase === 'generating' || this.phase === 'searching') {
            // Дробный накопитель: скорость показывает события честно,
            // даже когда расчётных шагов на кадр меньше единицы.
            const budget = this.eventsPerSecond * this.speed * dt;
            this.stepAccumulator = Math.min(4096, this.stepAccumulator + budget);
            const desired = Math.floor(this.stepAccumulator);
            if (desired > 0) {
                const applied = this.drain(desired, MAX_MS_PER_FRAME);
                this.stepAccumulator = Math.max(0, this.stepAccumulator - applied);
            }
            void this.topUp();
        }

        if (this.statsDirty) {
            const due = this.statsImmediate || nowMs - this.lastStatsEmit >= STATS_EMIT_INTERVAL_MS;
            if (due) {
                this.statsDirty = false;
                this.statsImmediate = false;
                this.lastStatsEmit = nowMs;
                this.emit('stats', this.stats);
            }
        }
    }

    /* -------------------------------------------------- internals */

    private get isRunning(): boolean {
        return this.phase === 'generating' || this.phase === 'searching';
    }

    private canStep(): boolean {
        return (
            this.phase === 'generating' ||
            this.phase === 'generationPaused' ||
            this.phase === 'searching' ||
            this.phase === 'searchPaused'
        );
    }

    /**
     * Сколько событий алгоритма показывать в секунду при 1×.
     * Маленькие лабиринты идут почти пошагово, большие — потоком,
     * но общая длительность остаётся разумной.
     */
    private get eventsPerSecond(): number {
        const total = Math.max(1, this.estSteps);
        const duration = this.stats.phase === 'gen' ? clamp(total / 1200, 8, 20) : clamp(total / 2000, 5, 12);
        return total / duration;
    }

    private get stepSize(): number {
        if (this.size <= 50) return 1;
        return Math.max(1, Math.round(this.eventsPerSecond / 60));
    }

    private drain(limit: number, maxMs: number): number {
        const t0 = performance.now();
        let applied = 0;
        while (applied < limit && this.queue.size > 0) {
            const event = this.queue.shift();
            if (!event) break;
            this.dispatcher.dispatch(event);
            this.trackEvent(event);
            applied += 1;

            if (event.type === 'gen:done') {
                this.setPhase('generationComplete');
                break;
            }
            if (event.type === 'search:done') {
                this.setPhase(event.pathLength > 0 ? 'pathFound' : 'error');
                break;
            }
            if (performance.now() - t0 > maxMs) break;
        }
        return applied;
    }

    private async topUp(): Promise<void> {
        if (!this.isRunning || this.pullInFlight || this.queueDone || !this.ready) return;
        const target = clamp(Math.ceil(this.eventsPerSecond * this.speed * 0.25), 128, MAX_QUEUE_TARGET);
        if (this.queue.size >= target) return;
        await this.fillQueue(target);
    }

    /** Дозаполнить очередь до `target` событий. */
    private async fillQueue(target: number): Promise<void> {
        if (this.queueDone || !this.ready || this.disposed) return;
        // Pull уже в полёте — дожидаемся его. Иначе «Следующий шаг» может
        // ничего не применить и молча ничего не сделать.
        if (this.pullPromise) {
            await this.pullPromise;
            if (this.queue.size >= target || this.queueDone || this.pullInFlight) return;
        }
        const pull = this.runPullLoop(target);
        this.pullPromise = pull;
        try {
            await pull;
        } finally {
            if (this.pullPromise === pull) this.pullPromise = null;
        }
    }

    private async runPullLoop(target: number): Promise<void> {
        if (this.pullInFlight || this.queueDone || !this.ready) return;
        this.pullInFlight = true;
        try {
            let emptyPulls = 0;
            while (this.queue.size < target && !this.queueDone && !this.disposed) {
                const count = Math.min(MAX_QUEUE_TARGET, target - this.queue.size + 128);
                const info: EventsInfo = await this.client.pull(count);
                this.applyStats(info.stats);
                if (info.events.length > 0) this.queue.push(...info.events);
                else emptyPulls += 1;
                this.queueDone = info.done;
                if (info.events.length === 0 && this.queueDone) break;
                if (emptyPulls >= 2) break;
            }
        } catch (error) {
            if (!(error instanceof StaleRequestError)) this.fail(error);
        } finally {
            this.pullInFlight = false;
        }
    }

    /**
     * Статистика считается по событиям, которые УЖЕ показаны на сцене.
     * Поэтому Progress/Visited/Backtracks/Explored всегда совпадают с тем,
     * что видит пользователь: воркер может обгонять анимацию, но панель — нет.
     */
    private trackEvent(event: AlgorithmEvent): void {
        const stats = this.stats;
        switch (event.type) {
            case 'gen:enter':
                stats.visited = 1;
                stats.progress = Math.min(1, 1 / Math.max(1, stats.size * stats.size));
                break;
            case 'gen:carve':
                stats.visited += 1;
                stats.progress = Math.min(1, stats.visited / Math.max(1, stats.size * stats.size));
                break;
            case 'gen:backtrack':
                stats.backtracks += 1;
                break;
            case 'gen:done':
                stats.visited = event.visited;
                stats.backtracks = event.backtracks;
                stats.progress = 1;
                stats.timeMs = this.workerComputeMs;
                this.lastGenStats = { ...stats };
                break;
            case 'search:expand':
                stats.explored += 1;
                stats.queue = event.queue;
                stats.progress = Math.min(1, stats.explored / Math.max(1, stats.size * stats.size));
                break;
            case 'search:path':
                stats.pathLength = event.cells.length;
                break;
            case 'search:done':
                stats.explored = event.explored;
                stats.pathLength = event.pathLength;
                stats.timeMs = this.workerComputeMs;
                break;
            default:
                break;
        }
        this.statsDirty = true;
    }

    /** Ответ воркера: берём только время расчёта (итоговое — по событию done). */
    private applyStats(stats: StatsView): void {
        this.workerComputeMs = stats.timeMs;
    }

    private pushStats(immediate = false): void {
        this.statsDirty = true;
        if (immediate) this.statsImmediate = true;
    }

    private setPhase(phase: AppPhase): void {
        if (this.phase === phase) return;
        this.phase = phase;
        this.stepAccumulator = 0;
        this.pushStats(true);
        this.emit('phase', phase);
    }

    private fail(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.errorMessage = message;
        this.queue.clear();
        this.queueDone = true;
        this.ready = false;
        this.setPhase('error');
        this.pushStats(true);
        console.error('[3D Maze]', message);
    }

    getError(): string {
        return this.errorMessage;
    }
}
