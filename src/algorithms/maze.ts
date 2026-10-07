/**
 * Maze State — состояние лабиринта.
 *
 * Хранит стены каждой клетки (битовая маска), посещённость и старт/финиш.
 * Алгоритмы работают только с этим классом: он не знает ничего о рендере.
 *
 * Направления (биты стен):
 *   0b0001 = север (y-1)
 *   0b0010 = восток (x+1)
 *   0b0100 = юг    (y+1)
 *   0b1000 = запад (x-1)
 */

export const DIR_N = 0;
export const DIR_E = 1;
export const DIR_S = 2;
export const DIR_W = 3;

export interface DirSpec {
    dx: number;
    dy: number;
    bit: number;
    opposite: number;
}

export const DIRECTIONS: readonly DirSpec[] = [
    { dx: 0, dy: -1, bit: 0b0001, opposite: 0b0100 }, // N
    { dx: 1, dy: 0, bit: 0b0010, opposite: 0b1000 }, // E
    { dx: 0, dy: 1, bit: 0b0100, opposite: 0b0001 }, // S
    { dx: -1, dy: 0, bit: 0b1000, opposite: 0b0010 }, // W
];

export class MazeState {
    readonly size: number;
    readonly cellCount: number;
    readonly start: number;
    readonly finish: number;

    /** Битовая маска стен для каждой клетки. */
    readonly walls: Uint8Array;
    /** Посещена ли клетка алгоритмом генерации. */
    readonly visited: Uint8Array;

    constructor(size: number) {
        if (!Number.isInteger(size) || size < 2) {
            throw new Error(`Некорректный размер лабиринта: ${size}`);
        }
        this.size = size;
        this.cellCount = size * size;
        this.walls = new Uint8Array(this.cellCount).fill(0b1111);
        this.visited = new Uint8Array(this.cellCount);
        this.start = 0;
        this.finish = this.cellCount - 1;
    }

    index(x: number, y: number): number {
        return y * this.size + x;
    }

    x(cell: number): number {
        return cell % this.size;
    }

    y(cell: number): number {
        return (cell / this.size) | 0;
    }

    inBounds(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.size && y < this.size;
    }

    /** Соседняя клетка в заданном направлении или -1. */
    neighbor(cell: number, dirIndex: number): number {
        const d = DIRECTIONS[dirIndex];
        const nx = this.x(cell) + d.dx;
        const ny = this.y(cell) + d.dy;
        if (!this.inBounds(nx, ny)) return -1;
        return this.index(nx, ny);
    }

    /** Есть ли стена между двумя клетками (клетки должны быть соседними). */
    hasWallBetween(a: number, b: number): boolean {
        const dir = this.directionBetween(a, b);
        if (dir < 0) return true;
        return (this.walls[a] & DIRECTIONS[dir].bit) !== 0;
    }

    /** Открыто ли проход между клетками. */
    isOpen(a: number, b: number): boolean {
        return !this.hasWallBetween(a, b);
    }

    /**
     * Направление из клетки a в соседнюю клетку b, либо -1,
     * если клетки не соседние.
     */
    directionBetween(a: number, b: number): number {
        const dx = this.x(b) - this.x(a);
        const dy = this.y(b) - this.y(a);
        for (let i = 0; i < DIRECTIONS.length; i++) {
            if (DIRECTIONS[i].dx === dx && DIRECTIONS[i].dy === dy) return i;
        }
        return -1;
    }

    /** Снести стену между клетками (обновляет биты обеих клеток). */
    removeWall(a: number, b: number, dirIndex?: number): boolean {
        const dir = dirIndex !== undefined ? dirIndex : this.directionBetween(a, b);
        if (dir < 0) return false;
        const spec = DIRECTIONS[dir];
        this.walls[a] &= ~spec.bit;
        this.walls[b] &= ~spec.opposite;
        return true;
    }

    /** Добавить стену обратно (используется в тестах для проверки инвариантов). */
    addWall(a: number, b: number, dirIndex?: number): boolean {
        const dir = dirIndex !== undefined ? dirIndex : this.directionBetween(a, b);
        if (dir < 0) return false;
        const spec = DIRECTIONS[dir];
        this.walls[a] |= spec.bit;
        this.walls[b] |= spec.opposite;
        return true;
    }

    /**
     * Все соседние клетки, соединённые открытым проходом.
     * Используется поиском пути.
     */
    openNeighbors(cell: number, out: number[] = []): number[] {
        out.length = 0;
        for (let d = 0; d < DIRECTIONS.length; d++) {
            if (this.walls[cell] & DIRECTIONS[d].bit) continue;
            const nb = this.neighbor(cell, d);
            if (nb >= 0) out.push(nb);
        }
        return out;
    }

    /** Число открытых проходов (стен, снесённых алгоритмом). */
    openPassageCount(): number {
        let count = 0;
        for (let c = 0; c < this.cellCount; c++) {
            // считаем только «восток» и «юг», чтобы не задвоить
            if (!(this.walls[c] & 0b0010)) count++;
            if (!(this.walls[c] & 0b0100)) count++;
        }
        return count;
    }
}
