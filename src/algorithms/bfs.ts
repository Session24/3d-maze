import type { SearchEvent } from '../core/types';
import { DIRECTIONS, MazeState } from './maze';

/**
 * Breadth-First Search — настоящий пошаговый поиск пути.
 *
 * Каждый `yield` — один реальный шаг:
 *   search:start     — инициализация очереди
 *   search:discover  — узел обнаружен и поставлен в очередь (frontier)
 *   search:expand     — узел извлечён из очереди и исследован
 *   search:found      — достигнут финиш
 *   search:path       — маршрут восстановлен по массиву parent
 *   search:done       — поиск завершён
 *
 * Итоговый путь собирается ТОЛЬКО через parent/predecessor — это тот самый
 * маршрут, который реально нашёл алгоритм (BFS гарантирует кратчайшину).
 */
export function* bfs(maze: MazeState, start = maze.start, finish = maze.finish): Generator<SearchEvent> {
    const n = maze.cellCount;
    const parent = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;

    yield { type: 'search:start', start, finish };

    const neighbors: number[] = [];
    let explored = 0;

    while (head < tail) {
        const cur = queue[head++];
        explored++;
        yield { type: 'search:expand', cell: cur, queue: tail - head };

        if (cur === finish) {
            const path = reconstructPath(parent, start, finish);
            yield { type: 'search:found', cell: finish };
            yield { type: 'search:path', cells: path };
            yield { type: 'search:done', explored, pathLength: path.length };
            return;
        }

        maze.openNeighbors(cur, neighbors);
        for (let i = 0; i < neighbors.length; i++) {
            const nb = neighbors[i];
            if (seen[nb]) continue;
            seen[nb] = 1;
            parent[nb] = cur;
            queue[tail++] = nb;
            yield { type: 'search:discover', cell: nb, from: cur };
        }
    }

    // Лабиринт, созданный генератором, связный — сюда мы не попадаем,
    // но корректно обрабатываем и случай «пути нет».
    yield { type: 'search:done', explored, pathLength: -1 };
}

/** Восстановление маршрута start → finish по массиву предков. */
export function reconstructPath(parent: Int32Array, start: number, finish: number): number[] {
    const path: number[] = [];
    let node = finish;
    let guard = parent.length + 1;
    while (node !== -1 && guard-- > 0) {
        path.push(node);
        if (node === start) break;
        node = parent[node];
    }
    path.reverse();
    if (path[0] !== start) return [];
    return path;
}

/**
 * Эталонный BFS «в один заход» для тестов: возвращает длину кратчайшего
 * маршрута в клетках (или -1).
 */
export function shortestPathLength(maze: MazeState, start = maze.start, finish = maze.finish): number {
    const n = maze.cellCount;
    const dist = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    dist[start] = 0;
    const neighbors: number[] = [];
    while (head < tail) {
        const cur = queue[head++];
        if (cur === finish) return dist[cur] + 1;
        maze.openNeighbors(cur, neighbors);
        for (const nb of neighbors) {
            if (dist[nb] !== -1) continue;
            dist[nb] = dist[cur] + 1;
            queue[tail++] = nb;
        }
    }
    return -1;
}

/** Клетки достижимы ли из старта — для проверки связности лабиринта. */
export function reachableCount(maze: MazeState, start = maze.start): number {
    const seen = new Uint8Array(maze.cellCount);
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    const neighbors: number[] = [];
    while (stack.length > 0) {
        const cur = stack.pop() as number;
        count++;
        maze.openNeighbors(cur, neighbors);
        for (const nb of neighbors) {
            if (seen[nb]) continue;
            seen[nb] = 1;
            stack.push(nb);
        }
    }
    return count;
}

/** Проверка корректности битовой маски стен (симметрия). */
export function wallsAreConsistent(maze: MazeState): boolean {
    for (let c = 0; c < maze.cellCount; c++) {
        for (let d = 0; d < DIRECTIONS.length; d++) {
            const nb = maze.neighbor(c, d);
            const hasWall = (maze.walls[c] & DIRECTIONS[d].bit) !== 0;
            if (nb < 0) {
                // У границы стена обязана существовать.
                if (!hasWall) return false;
                continue;
            }
            const oppositeHasWall = (maze.walls[nb] & DIRECTIONS[d].opposite) !== 0;
            if (hasWall !== oppositeHasWall) return false;
        }
    }
    return true;
}
