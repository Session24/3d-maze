import { CellKind } from '../core/types';

/** Цветовая палитра сцены. Каждый цвет имеет смысл. */
export const SCENE = {
    background: 0x04060c,
    fog: 0x060a12,
    floor: 0x070b14,
    wall: 0x1c2740,
    wallEmissive: 0x0a1020,
    path: 0x39ff88,
    pulse: 0xd9fff0,
    start: 0x1ff07a,
    finish: 0xff3b5c,
} as const;

/** Базовые цвета клеток (hex). */
export const CELL_COLORS: Record<number, number> = {
    [CellKind.Empty]: 0x0b1120,
    [CellKind.GenVisited]: 0x24507e,
    [CellKind.GenChain]: 0x00d4ff,
    [CellKind.GenCurrent]: 0xd9fbff,
    [CellKind.SearchExplored]: 0x4b3f8f,
    [CellKind.SearchFrontier]: 0x9b7bff,
    [CellKind.SearchCurrent]: 0xe9e0ff,
    [CellKind.SearchDim]: 0x221d42,
    [CellKind.Path]: 0x39ff88,
    [CellKind.Start]: 0x1ff07a,
    [CellKind.Finish]: 0xff3b5c,
};
