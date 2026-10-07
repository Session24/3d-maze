import { describe, expect, it } from 'vitest';
import { MazeState } from '../src/algorithms/maze';
import { randomizedDfs } from '../src/algorithms/randomizedDfs';
import { reachableCount, wallsAreConsistent } from '../src/algorithms/bfs';
import { mulberry32 } from '../src/algorithms/rng';
import type { GenEvent } from '../src/core/types';

interface RunResult {
    maze: MazeState;
    events: GenEvent[];
    visited: number;
    backtracks: number;
    carves: number;
    backtracksSeen: number;
}

function runGenerator(size: number, seed = 12345): RunResult {
    const maze = new MazeState(size);
    const events: GenEvent[] = [];
    let visited = 0;
    let backtracks = 0;
    let carves = 0;
    let backtracksSeen = 0;

    for (const event of randomizedDfs(maze, mulberry32(seed))) {
        events.push(event);
        if (event.type === 'gen:carve') carves++;
        if (event.type === 'gen:backtrack') backtracksSeen++;
        if (event.type === 'gen:done') {
            visited = event.visited;
            backtracks = event.backtracks;
        }
    }

    return { maze, events, visited, backtracks, carves, backtracksSeen };
}

const SIZES = [10, 25, 50, 100, 200];

describe('Randomized DFS — генерация лабиринта', () => {
    for (const size of SIZES) {
        it(`${size} × ${size}: полная генерация без ошибок`, () => {
            const { maze, events, visited, backtracks, carves, backtracksSeen } = runGenerator(size);

            // 1. Посещены все клетки.
            expect(visited).toBe(size * size);
            expect(maze.visited.every((v) => v === 1)).toBe(true);

            // 2. Ровно n²−1 снесённых стен (створка лабиринта).
            expect(carves).toBe(size * size - 1);
            expect(maze.openPassageCount()).toBe(size * size - 1);

            // 3. Лабиринт связный: из старта достижима каждая клетка.
            expect(reachableCount(maze)).toBe(size * size);

            // 4. Нет циклов: |рёбра| = |вершины| − 1 при связности ⇒ дерево.
            expect(maze.openPassageCount()).toBe(maze.cellCount - 1);

            // 5. Стены согласованы (симметрия), внешние границы не тронуты.
            expect(wallsAreConsistent(maze)).toBe(true);
            for (let x = 0; x < size; x++) {
                expect(maze.walls[maze.index(x, 0)] & 0b0001).toBeTruthy();
                expect(maze.walls[maze.index(x, size - 1)] & 0b0100).toBeTruthy();
            }
            for (let y = 0; y < size; y++) {
                expect(maze.walls[maze.index(0, y)] & 0b1000).toBeTruthy();
                expect(maze.walls[maze.index(size - 1, y)] & 0b0010).toBeTruthy();
            }

            // 6. Backtracking реально происходил.
            expect(backtracksSeen).toBeGreaterThan(0);
            expect(backtracks).toBe(backtracksSeen);

            // 7. Порядок событий корректен.
            expect(events[0].type).toBe('gen:init');
            expect(events[events.length - 1].type).toBe('gen:done');
            expect(events[1].type).toBe('gen:enter');
        });
    }

    it('действительно «идёт вперёд и возвращается», а не имитирует это', () => {
        const { events } = runGenerator(25);
        let depth = 0;
        let maxDepth = 0;
        let stepsForward = 0;
        let stepsBack = 0;

        for (const event of events) {
            if (event.type === 'gen:carve') {
                depth += 1;
                stepsForward += 1;
            } else if (event.type === 'gen:backtrack') {
                depth -= 1;
                stepsBack += 1;
            }
            maxDepth = Math.max(maxDepth, depth);
        }

        expect(depth).toBe(0); // цепочка закрыта
        expect(stepsForward).toBe(25 * 25 - 1);
        expect(stepsBack).toBeGreaterThan(stepsForward * 0.4);
        expect(maxDepth).toBeGreaterThan(10); // алгоритм реально уходил в глубину
    });

    it('детерминирован при фиксированном seed', () => {
        const a = runGenerator(30, 777);
        const b = runGenerator(30, 777);
        expect(Array.from(a.maze.walls)).toEqual(Array.from(b.maze.walls));

        const c = runGenerator(30, 778);
        expect(Array.from(a.maze.walls)).not.toEqual(Array.from(c.maze.walls));
    });

    it('генерация 200 × 200 укладывается в разумное время', () => {
        const t0 = performance.now();
        const { maze } = runGenerator(200, 42);
        const elapsed = performance.now() - t0;
        expect(reachableCount(maze)).toBe(40000);
        expect(elapsed).toBeLessThan(15000);
    });
});
