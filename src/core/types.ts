/**
 * Общие типы приложения.
 *
 * Алгоритмы (генераторы/поисковики) общаются с внешним миром только через
 * поток событий `AlgorithmEvent` — они ничего не знают о Three.js.
 */

export type CellIndex = number;

/** События пошаговой генерации лабиринта. */
export type GenEvent =
    | { type: 'gen:init'; size: number; start: CellIndex; finish: CellIndex }
    | { type: 'gen:enter'; cell: CellIndex }
    | { type: 'gen:carve'; from: CellIndex; to: CellIndex }
    | { type: 'gen:backtrack'; from: CellIndex; to: CellIndex }
    | { type: 'gen:done'; visited: number; backtracks: number };

/** События пошагового поиска пути. */
export type SearchEvent =
    | { type: 'search:start'; start: CellIndex; finish: CellIndex }
    | { type: 'search:discover'; cell: CellIndex; from: CellIndex }
    | { type: 'search:expand'; cell: CellIndex; queue: number }
    | { type: 'search:found'; cell: CellIndex }
    | { type: 'search:path'; cells: CellIndex[] }
    | { type: 'search:done'; explored: number; pathLength: number };

export type AlgorithmEvent = GenEvent | SearchEvent;

export type Phase = 'gen' | 'search' | 'none';

/** Фазы жизненного цикла приложения. */
export type AppPhase =
    | 'idle'
    | 'generating'
    | 'generationPaused'
    | 'generationComplete'
    | 'searching'
    | 'searchPaused'
    | 'pathFound'
    | 'error';

/** Визуальное состояние клетки. */
export const CellKind = {
    Empty: 0,
    GenVisited: 1,
    GenChain: 2,
    GenCurrent: 3,
    SearchExplored: 4,
    SearchFrontier: 5,
    SearchCurrent: 6,
    SearchDim: 7,
    Path: 8,
    Start: 9,
    Finish: 10,
} as const;

export type CellKindValue = (typeof CellKind)[keyof typeof CellKind];

/**
 * Минимальный API 3D-сцены, который использует диспетчер событий.
 * Благодаря этому интерфейсу алгоритмы и диспетчер не зависят от Three.js —
 * любой другой рендерер (2D canvas, SVG, WebGL-альтернатива) может
 * реализовать тот же контракт.
 */
export interface SceneApi {
    /** Подготовить сцену под размер лабиринта (пересоздаёт буферы при смене размера). */
    setSize(size: number): void;
    /** Все стены подняты, клетки пусты — состояние «лист ожидания». */
    resetScene(): void;
    /** Полностью убрать лабиринт со сцены (возврат в Idle). */
    clearMaze(): void;
    /** Покрасить клетку в состоянии генерации (запоминается как базовый цвет). */
    setGenerationCell(cell: CellIndex, kind: CellKindValue): void;
    /** Покрасить клетку в временном слое (поиск/путь). */
    setOverlayCell(cell: CellIndex, kind: CellKindValue): void;
    /** Постоянные маркеры: старт / финиш. */
    setMarkerCell(cell: CellIndex, kind: CellKindValue): void;
    /** Убрать стену между двумя соседними клетками. */
    hideWallBetween(from: CellIndex, to: CellIndex): void;
    /** Показать итоговый маршрут + запустить светящийся импульс. */
    showPath(cells: CellIndex[]): void;
    /** Снять временную подсветку поиска, вернув цвета генерации. */
    clearOverlay(): void;
    /** Вернуть камеру в стандартное положение. */
    resetCamera(): void;
}

/** Сводная статистика, которую отдаёт воркер. */
export interface StatsView {
    phase: Phase;
    algorithm: string;
    size: number;
    progress: number;
    visited: number;
    backtracks: number;
    explored: number;
    queue: number;
    pathLength: number;
    timeMs: number;
}
