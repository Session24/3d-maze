import { CellKind, type AlgorithmEvent, type CellKindValue, type SceneApi } from './types';

/**
 * Диспетчер событий: переводит поток событий алгоритма в вызовы API сцены.
 *
 * Именно здесь «генерация» и «поиск» превращаются в визуал, а Three.js
 * остаётся единственным местом, где известно о трёхмерности.
 */
export class EventDispatcher {
    private current = -1;
    private expanded = -1;
    private pathShown = false;

    constructor(private readonly scene: SceneApi) {}

    reset(): void {
        this.current = -1;
        this.expanded = -1;
        this.pathShown = false;
    }

    dispatch(event: AlgorithmEvent): void {
        switch (event.type) {
            case 'gen:init':
                this.scene.setMarkerCell(event.start, CellKind.Start);
                this.scene.setMarkerCell(event.finish, CellKind.Finish);
                break;

            case 'gen:enter':
                this.current = event.cell;
                this.scene.setGenerationCell(event.cell, CellKind.GenCurrent);
                break;

            case 'gen:carve':
                // Стена реально исчезает — ровно тогда, когда алгоритм её снёс.
                this.scene.hideWallBetween(event.from, event.to);
                this.scene.setGenerationCell(event.from, CellKind.GenChain);
                this.scene.setGenerationCell(event.to, CellKind.GenCurrent);
                this.current = event.to;
                break;

            case 'gen:backtrack':
                // Возврат из тупика: клетка покидает текущую цепочку.
                this.scene.setGenerationCell(event.from, CellKind.GenVisited);
                this.scene.setGenerationCell(event.to, CellKind.GenCurrent);
                this.current = event.to;
                break;

            case 'gen:done':
                if (this.current >= 0) {
                    this.scene.setGenerationCell(this.current, CellKind.GenVisited);
                }
                this.current = -1;
                break;

            case 'search:start':
                this.scene.clearOverlay();
                this.scene.setMarkerCell(event.start, CellKind.Start);
                this.scene.setMarkerCell(event.finish, CellKind.Finish);
                this.expanded = -1;
                this.pathShown = false;
                break;

            case 'search:discover':
                this.scene.setOverlayCell(event.cell, CellKind.SearchFrontier);
                break;

            case 'search:expand':
                this.markExplored(this.expanded, event.cell);
                this.scene.setOverlayCell(event.cell, CellKind.SearchCurrent);
                this.expanded = event.cell;
                break;

            case 'search:found':
                this.markExplored(this.expanded, event.cell);
                this.scene.setOverlayCell(event.cell, CellKind.SearchCurrent);
                this.expanded = event.cell;
                break;

            case 'search:path':
                this.pathShown = true;
                this.scene.showPath(event.cells);
                break;

            case 'search:done':
                if (!this.pathShown) this.markExplored(this.expanded, -1);
                this.expanded = -1;
                break;

            default:
                break;
        }
    }

    private markExplored(previous: number, next: number): void {
        if (previous < 0 || previous === next) return;
        const kind: CellKindValue = CellKind.SearchExplored;
        this.scene.setOverlayCell(previous, kind);
    }
}
