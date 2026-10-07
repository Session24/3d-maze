import { describe, expect, it } from 'vitest';
import { MazeState } from '../src/algorithms/maze';
import { randomizedDfs } from '../src/algorithms/randomizedDfs';
import { bfs, reconstructPath, shortestPathLength } from '../src/algorithms/bfs';
import { mulberry32 } from '../src/algorithms/rng';
import type { SearchEvent } from '../src/core/types';

function generate(size: number, seed = 2024): MazeState {
    const maze = new MazeState(size);
    for (const _ of randomizedDfs(maze, mulberry32(seed))) {
        // прогоняем генератор до конца
    }
    return maze;
}

interface SearchRun {
    maze: MazeState;
    events: SearchEvent[];
    path: number[];
    explored: number;
    discovered: number;
}

function runSearch(maze: MazeState): SearchRun {
    const events: SearchEvent[] = [];
    let path: number[] = [];
    let explored = 0;
    let discovered = 0;

    for (const event of bfs(maze)) {
        events.push(event);
        if (event.type === 'search:discover') discovered++;
        if (event.type === 'search:expand') explored++;
        if (event.type === 'search:path') path = event.cells;
        if (event.type === 'search:done') explored = event.explored;
    }

    return { maze, events, path, explored, discovered };
}

function expectValidPath(maze: MazeState, path: number[]): void {
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toBe(maze.start);
    expect(path[path.length - 1]).toBe(maze.finish);
    expect(new Set(path).size).toBe(path.length); // без повторов

    for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i];
        const b = path[i + 1];
        // Клетки обязаны быть соседними и соединёнными открытым проходом.
        expect(maze.directionBetween(a, b)).toBeGreaterThanOrEqual(0);
        expect(maze.isOpen(a, b)).toBe(true);
    }
}

describe('Breadth-First Search — поиск пути', () => {
    for (const size of [10, 25, 50]) {
        it(`${size} × ${size}: находит кратчайший путь в сгенерированном лабиринте`, () => {
            const maze = generate(size);
            const run = runSearch(maze);

            expect(run.path.length).toBeGreaterThan(0);
            expectValidPath(maze, run.path);

            // Кратчайшину проверяем независимым эталонным BFS.
            expect(run.path.length).toBe(shortestPathLength(maze));
            // Кратчайший путь в лабиринте не короче манхэттенского расстояния.
            expect(run.path.length).toBeGreaterThanOrEqual((size - 1) * 2 + 1);
        });
    }

    it('исследует не больше, чем есть клеток', () => {
        const maze = generate(40);
        const run = runSearch(maze);
        expect(run.explored).toBeLessThanOrEqual(maze.cellCount);
        expect(run.discovered).toBeLessThanOrEqual(maze.cellCount);
        expect(run.events[0].type).toBe('search:start');
        expect(run.events[run.events.length - 1].type).toBe('search:done');
    });

    it('порядок событий: сначала expand, затем discover соседей', () => {
        const maze = generate(10);
        const events = runSearch(maze).events;
        const firstExpand = events.findIndex((e) => e.type === 'search:expand');
        const firstDiscover = events.findIndex((e) => e.type === 'search:discover');
        expect(firstExpand).toBeGreaterThanOrEqual(0);
        expect(firstDiscover).toBeGreaterThan(firstExpand);
    });

    it('восстанавливает путь по массиву parent', () => {
        const maze = generate(12);
        const parent = new Int32Array(maze.cellCount).fill(-1);
        // строим «искривлённый» предок-граф: 0 ← 3 ← 7 ← 11
        parent[3] = 0;
        parent[7] = 3;
        parent[11] = 7;
        expect(reconstructPath(parent, 0, 11)).toEqual([0, 3, 7, 11]);
        expect(reconstructPath(parent, 0, 5)).toEqual([]); // достижима только через start
    });

    it('работает на рукотворном лабиринте с известным ответом', () => {
        const maze = new MazeState(3); // старт 0 (0,0), финиш 8 (2,2)
        maze.removeWall(maze.index(0, 0), maze.index(1, 0));
        maze.removeWall(maze.index(1, 0), maze.index(2, 0));
        maze.removeWall(maze.index(2, 0), maze.index(2, 1));
        maze.removeWall(maze.index(2, 1), maze.index(2, 2));

        const run = runSearch(maze);
        expect(run.path).toEqual([
            maze.index(0, 0),
            maze.index(1, 0),
            maze.index(2, 0),
            maze.index(2, 1),
            maze.index(2, 2),
        ]);
        expect(run.path.length).toBe(5);
        expect(shortestPathLength(maze)).toBe(5);
    });

    it('сообщает «пути нет», когда клетки отрезаны', () => {
        const maze = new MazeState(3);
        // Внутренняя полная стена: убираем все «горизонтальные» проходы между рядами.
        for (let x = 0; x < 3; x++) {
            maze.addWall(maze.index(x, 0), maze.index(x, 1));
            maze.addWall(maze.index(x, 1), maze.index(x, 2));
        }
        const run = runSearch(maze);
        expect(run.path).toEqual([]);
        const done = run.events.find((e) => e.type === 'search:done');
        expect(done && done.type === 'search:done' ? done.pathLength : 0).toBe(-1);
    });

    it('100 × 100: поиск быстрый и корректный', () => {
        const maze = generate(100, 555);
        const t0 = performance.now();
        const run = runSearch(maze);
        const elapsed = performance.now() - t0;
        expectValidPath(maze, run.path);
        expect(run.path.length).toBe(shortestPathLength(maze));
        expect(elapsed).toBeLessThan(15000);
    });
});
