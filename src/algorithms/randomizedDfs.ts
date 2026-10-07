import type { GenEvent } from '../core/types';
import { MazeState } from './maze';

/**
 * Randomized DFS (Recursive Backtracker) — настоящий пошаговый генератор.
 *
 * Каждый `yield` — один реальный шаг алгоритма:
 *   gen:init      — выбор стартовой клетки
 *   gen:enter     — алгоритм перешёл в клетку
 *   gen:carve     — выбрана случайная непосещённая соседка, стена снесена
 *   gen:backtrack — тупик: алгоритм вернулся назад по цепочке
 *   gen:done      — лабиринт полностью построен
 *
 * Генератор ленивый: визуализация толкает его ровно настолько, насколько
 * готова показать шаги (поэтому пауза/шаг/скорость работают честно).
 */
export function* randomizedDfs(maze: MazeState, rng: () => number = Math.random): Generator<GenEvent> {
    const size = maze.size;
    const start = maze.start;
    const finish = maze.finish;

    maze.visited[start] = 1;
    const stack: number[] = [start];
    let visited = 1;
    let backtracks = 0;

    yield { type: 'gen:init', size, start, finish };
    yield { type: 'gen:enter', cell: start };

    while (stack.length > 0) {
        const cur = stack[stack.length - 1];
        const cx = cur % size;
        const cy = (cur / size) | 0;

        // Собираем непосещённых соседей в фиксированном порядке,
        // затем выбираем случайного — так DFS честно «блуждает».
        const options: number[] = [];
        if (cy > 0 && !maze.visited[cur - size]) options.push(cur - size);
        if (cx < size - 1 && !maze.visited[cur + 1]) options.push(cur + 1);
        if (cy < size - 1 && !maze.visited[cur + size]) options.push(cur + size);
        if (cx > 0 && !maze.visited[cur - 1]) options.push(cur - 1);

        if (options.length === 0) {
            // Тупик — backtracking.
            stack.pop();
            if (stack.length > 0) {
                backtracks++;
                yield { type: 'gen:backtrack', from: cur, to: stack[stack.length - 1] };
            }
            continue;
        }

        const next = options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
        maze.removeWall(cur, next);
        maze.visited[next] = 1;
        visited++;
        stack.push(next);

        yield { type: 'gen:carve', from: cur, to: next };
    }

    yield { type: 'gen:done', visited, backtracks };
}
