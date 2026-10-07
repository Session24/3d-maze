import { describe, expect, it } from 'vitest';
import { DIRECTIONS, MazeState } from '../src/algorithms/maze';
import { wallsAreConsistent } from '../src/algorithms/bfs';

describe('MazeState', () => {
    it('отвергает некорректный размер', () => {
        expect(() => new MazeState(1)).toThrow();
        expect(() => new MazeState(0)).toThrow();
        expect(() => new MazeState(2.5)).toThrow();
    });

    it('инициализируется со сплошными стенами', () => {
        const maze = new MazeState(6);
        expect(maze.cellCount).toBe(36);
        expect(maze.walls.every((w) => w === 0b1111)).toBe(true);
        expect(maze.openPassageCount()).toBe(0);
        expect(wallsAreConsistent(maze)).toBe(true);
    });

    it('индексы клеток и координаты обратимы', () => {
        const maze = new MazeState(7);
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 7; x++) {
                const cell = maze.index(x, y);
                expect(maze.x(cell)).toBe(x);
                expect(maze.y(cell)).toBe(y);
            }
        }
        expect(maze.start).toBe(0);
        expect(maze.finish).toBe(48);
    });

    it('сносит стену симметрично с обеих сторон', () => {
        const maze = new MazeState(5);
        const a = maze.index(1, 1);
        const b = maze.index(2, 1);

        expect(maze.hasWallBetween(a, b)).toBe(true);
        expect(maze.removeWall(a, b)).toBe(true);
        expect(maze.hasWallBetween(a, b)).toBe(false);
        expect(maze.hasWallBetween(b, a)).toBe(false);
        expect(wallsAreConsistent(maze)).toBe(true);

        expect(maze.addWall(a, b)).toBe(true);
        expect(maze.hasWallBetween(a, b)).toBe(true);
        expect(wallsAreConsistent(maze)).toBe(true);
    });

    it('не позволяет «пройти» за границу лабиринта', () => {
        const maze = new MazeState(4);
        expect(maze.neighbor(maze.index(0, 0), 0)).toBe(-1); // север
        expect(maze.neighbor(maze.index(0, 0), 3)).toBe(-1); // запад
        expect(maze.neighbor(maze.index(3, 3), 1)).toBe(-1); // восток
        expect(maze.neighbor(maze.index(3, 3), 2)).toBe(-1); // юг

        // Границы всегда закрыты.
        const top = maze.index(2, 0);
        expect(maze.walls[top] & DIRECTIONS[0].bit).toBeTruthy();
    });

    it('openNeighbors возвращает только открытых соседей', () => {
        const maze = new MazeState(3);
        const center = maze.index(1, 1);
        expect(maze.openNeighbors(center)).toEqual([]);

        for (let d = 0; d < DIRECTIONS.length; d++) {
            maze.removeWall(center, maze.neighbor(center, d), d);
        }
        expect(maze.openNeighbors(center).slice().sort((a, b) => a - b)).toEqual([1, 3, 5, 7]);
        expect(wallsAreConsistent(maze)).toBe(true);
    });

    it('не считает стены задвоенными', () => {
        const maze = new MazeState(4);
        maze.removeWall(maze.index(0, 0), maze.index(1, 0));
        expect(maze.openPassageCount()).toBe(1);
    });
});
