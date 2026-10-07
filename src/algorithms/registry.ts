import type { GenEvent, SearchEvent } from '../core/types';
import { bfs } from './bfs';
import { randomizedDfs } from './randomizedDfs';
import type { MazeState } from './maze';

/**
 * Реестры алгоритмов — точка расширения.
 *
 * Чтобы добавить новый генератор (Prim, Kruskal, Wilson) или новый поиск
 * (DFS, Dijkstra, A*), достаточно объявить объект здесь и подключить его
 * к выбору в UI. Ни рендерер, ни диспетчер менять не придётся: любой
 * алгоритм общается с миром через поток GenEvent / SearchEvent.
 */
export interface GeneratorAlgorithm {
    id: string;
    name: string;
    create: (maze: MazeState, rng?: () => number) => Generator<GenEvent>;
}

export interface PathAlgorithm {
    id: string;
    name: string;
    create: (maze: MazeState, start?: number, finish?: number) => Generator<SearchEvent>;
}

export const GENERATORS: readonly GeneratorAlgorithm[] = [
    { id: 'randomized-dfs', name: 'Randomized DFS', create: (maze, rng) => randomizedDfs(maze, rng) },
];

export const PATHFINDERS: readonly PathAlgorithm[] = [
    { id: 'bfs', name: 'Breadth-First Search', create: (maze, start, finish) => bfs(maze, start, finish) },
];

export function getGenerator(id: string): GeneratorAlgorithm {
    const algo = GENERATORS.find((a) => a.id === id) ?? GENERATORS[0];
    return algo;
}

export function getPathfinder(id: string): PathAlgorithm {
    const algo = PATHFINDERS.find((a) => a.id === id) ?? PATHFINDERS[0];
    return algo;
}
