/** Константы интерфейса. */

export const SIZES = [10, 25, 50, 100, 200] as const;
export type MazeSize = (typeof SIZES)[number];

export const SPEEDS = [0.5, 1, 2, 5, 10] as const;

export const DEFAULT_SIZE: MazeSize = 25;
export const DEFAULT_SPEED = 1;
