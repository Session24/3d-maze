import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { CellKind, type CellKindValue, type SceneApi } from '../core/types';
import { CELL_COLORS, SCENE } from './colors';

const CELL = 1;
const WALL_HEIGHT = 0.9;
const WALL_THICKNESS = 0.16;
const CELL_Y = 0.02;

const TEMP_POSITION = new THREE.Vector3();
const TEMP_SCALE = new THREE.Vector3();
const TEMP_QUATERNION = new THREE.Quaternion();
const TEMP_MATRIX = new THREE.Matrix4();

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/**
 * Three.js рендерер лабиринта.
 *
 * Производительность на 200×200 (40 000 клеток / ~80 000 стен):
 *  - стены  — один InstancedMesh (1 draw call на все стены),
 *  - клетки — один InstancedMesh с буфером цветов (1 draw call),
 *  - путь   — один InstancedMesh, рисуется только по факту.
 * Обновления идут инкрементально: за кадр перезаписываются только
 * изменившиеся элементы.
 */
export class MazeRenderer implements SceneApi {
    private readonly container: HTMLElement;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly controls: OrbitControls;
    private readonly composer: EffectComposer;
    private readonly bloom: UnrealBloomPass;
    private readonly resizeObserver: ResizeObserver;

    private readonly wallGeometry: THREE.BoxGeometry;
    private readonly wallMaterial: THREE.MeshStandardMaterial;
    private readonly cellGeometry: THREE.PlaneGeometry;
    private readonly cellMaterial: THREE.MeshStandardMaterial;
    private readonly pathGeometry: THREE.BoxGeometry;
    private readonly pathMaterial: THREE.MeshBasicMaterial;
    private readonly floorMaterial: THREE.MeshStandardMaterial;

    private readonly sun: THREE.DirectionalLight;
    private readonly startMarker: THREE.Group;
    private readonly finishMarker: THREE.Group;
    private readonly pulse: THREE.Mesh;

    private size = 0;
    private cellCount = 0;
    private wallCount = 0;

    private walls: THREE.InstancedMesh | null = null;
    private cells: THREE.InstancedMesh | null = null;
    private pathMesh: THREE.InstancedMesh | null = null;
    private floor: THREE.Mesh | null = null;

    private wallVisible: Uint8Array = new Uint8Array(0);
    private wallPos: Float32Array = new Float32Array(0);
    private wallScale: Float32Array = new Float32Array(0);

    private genKind: Uint8Array = new Uint8Array(0);
    private overlayKind: Uint8Array = new Uint8Array(0);
    private markerKind: Uint8Array = new Uint8Array(0);
    private overlayTouched: number[] = [];

    private cellDirty: number[] = [];
    private fullCellDirty = false;
    private wallDirty = false;

    private readonly palette: Float32Array;

    private pathCells: number[] = [];
    private pulseClock = -1;

    private tween: {
        fromPos: THREE.Vector3;
        toPos: THREE.Vector3;
        fromTarget: THREE.Vector3;
        toTarget: THREE.Vector3;
        t: number;
    } | null = null;

    private sweepTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    constructor(container: HTMLElement) {
        this.container = container;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.18;
        this.renderer.domElement.classList.add('scene-canvas');
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(SCENE.background);
        this.scene.fog = new THREE.FogExp2(SCENE.fog, 0.01);

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 6000);
        this.camera.position.set(30, 34, 38);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.075;
        this.controls.screenSpacePanning = false;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
        this.controls.minDistance = 3;
        this.controls.autoRotateSpeed = 0.55;

        /* ------------------------------------------------ освещение */

        const ambient = new THREE.AmbientLight(0x7c8fc4, 2.0);
        const rim = new THREE.DirectionalLight(0x8fb4ff, 0.9);
        rim.position.set(-1, 0.6, -1).multiplyScalar(100);

        this.sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
        this.sun.position.set(60, 110, 40);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        this.sun.shadow.bias = -0.0012;
        this.sun.shadow.normalBias = 0.02;
        const shadowCamera = this.sun.shadow.camera;
        shadowCamera.near = 1;
        shadowCamera.far = 400;
        shadowCamera.left = -60;
        shadowCamera.right = 60;
        shadowCamera.top = 60;
        shadowCamera.bottom = -60;
        shadowCamera.updateProjectionMatrix();

        this.scene.add(ambient, rim, this.sun, this.sun.target);

        /* ------------------------------------------- общие ресурсы */

        this.wallGeometry = new THREE.BoxGeometry(1, 1, 1);
        this.wallMaterial = new THREE.MeshStandardMaterial({
            color: SCENE.wall,
            roughness: 0.72,
            metalness: 0.18,
            emissive: new THREE.Color(SCENE.wallEmissive),
            emissiveIntensity: 1,
        });

        this.cellGeometry = new THREE.PlaneGeometry(CELL * 0.88, CELL * 0.88);
        this.cellGeometry.rotateX(-Math.PI / 2);
        this.cellMaterial = new THREE.MeshStandardMaterial({
            roughness: 0.5,
            metalness: 0.1,
        });

        this.pathGeometry = new THREE.BoxGeometry(CELL * 0.46, 0.16, CELL * 0.46);
        this.pathMaterial = new THREE.MeshBasicMaterial({ color: SCENE.path, toneMapped: false });

        this.floorMaterial = new THREE.MeshStandardMaterial({
            color: SCENE.floor,
            roughness: 1,
            metalness: 0,
        });

        this.startMarker = this.createMarker(SCENE.start);
        this.finishMarker = this.createMarker(SCENE.finish);
        this.scene.add(this.startMarker, this.finishMarker);

        this.pulse = new THREE.Mesh(
            new THREE.SphereGeometry(0.24, 18, 14),
            new THREE.MeshBasicMaterial({ color: SCENE.pulse, toneMapped: false }),
        );
        this.pulse.visible = false;
        this.scene.add(this.pulse);

        /* ----------------------------------------------- постпроцесс */

        const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
            type: THREE.HalfFloatType,
            samples: 4,
        });
        this.composer = new EffectComposer(this.renderer, renderTarget);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.55, 0.72);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());

        /* ------------------------------------------------- палитра */

        this.palette = new Float32Array(16 * 3);
        const color = new THREE.Color();
        for (const key of Object.keys(CELL_COLORS)) {
            const index = Number(key);
            color.setHex(CELL_COLORS[index]);
            this.palette[index * 3] = color.r;
            this.palette[index * 3 + 1] = color.g;
            this.palette[index * 3 + 2] = color.b;
        }

        /* ----------------------------------------------- resize/init */

        this.resizeObserver = new ResizeObserver(() => this.handleResize());
        this.resizeObserver.observe(container);
        this.handleResize();

        this.controls.addEventListener('start', () => {
            this.controls.autoRotate = false;
            this.tween = null;
        });
    }

    /* ================================================== SceneApi */

    setSize(size: number): void {
        if (size === this.size && this.walls) return;
        this.disposeLayout();
        this.build(size);
    }

    resetScene(): void {
        if (!this.walls) return;
        // Стены снова подняты, все временные слои очищены.
        for (let i = 0; i < this.wallCount; i++) {
            if (this.wallVisible[i] === 0) this.setWallVisible(i, true);
        }
        this.clearVisualState();
        this.hideMarkers();
        this.setFullCellDirty();
    }

    clearMaze(): void {
        if (!this.walls) return;
        for (let i = 0; i < this.wallCount; i++) {
            if (this.wallVisible[i] === 1) this.setWallVisible(i, false);
        }
        this.clearVisualState();
        this.hideMarkers();
        this.setFullCellDirty();
    }

    setGenerationCell(cell: number, kind: CellKindValue): void {
        if (cell < 0 || cell >= this.cellCount) return;
        this.genKind[cell] = kind;
        this.refreshCell(cell);
    }

    setOverlayCell(cell: number, kind: CellKindValue): void {
        if (cell < 0 || cell >= this.cellCount) return;
        if (this.overlayKind[cell] === 0) this.overlayTouched.push(cell);
        this.overlayKind[cell] = kind;
        this.refreshCell(cell);
    }

    setMarkerCell(cell: number, kind: CellKindValue): void {
        if (cell < 0 || cell >= this.cellCount) return;
        this.markerKind[cell] = kind;
        this.refreshCell(cell);
        if (kind === CellKind.Start) this.placeMarker(this.startMarker, cell, true);
        if (kind === CellKind.Finish) this.placeMarker(this.finishMarker, cell, true);
    }

    hideWallBetween(from: number, to: number): void {
        if (this.size === 0) return;
        const size = this.size;
        const x1 = from % size;
        const y1 = (from / size) | 0;
        const x2 = to % size;
        const y2 = (to / size) | 0;

        let index: number;
        if (y2 === y1 + 1) index = (y1 + 1) * size + x1;
        else if (y2 === y1 - 1) index = y1 * size + x1;
        else if (x2 === x1 + 1) index = size * (size + 1) + y1 * (size + 1) + (x1 + 1);
        else index = size * (size + 1) + y1 * (size + 1) + x1;

        this.setWallVisible(index, false);
    }

    showPath(cells: number[]): void {
        if (!this.pathMesh || cells.length === 0) return;
        this.pathCells = cells.slice();

        // Временная подсветка поиска приглушается, маршрут остаётся ярким.
        for (const cell of this.overlayTouched) {
            const kind = this.overlayKind[cell];
            if (
                kind === CellKind.SearchExplored ||
                kind === CellKind.SearchFrontier ||
                kind === CellKind.SearchCurrent
            ) {
                this.overlayKind[cell] = CellKind.SearchDim;
                this.refreshCell(cell);
            }
        }

        for (const cell of cells) {
            if (this.overlayKind[cell] === 0) this.overlayTouched.push(cell);
            this.overlayKind[cell] = CellKind.Path;
            this.refreshCell(cell);
        }

        const matrix = new THREE.Matrix4();
        for (let i = 0; i < cells.length; i++) {
            const pos = this.cellPosition(cells[i]);
            matrix.makeTranslation(pos.x, 0.16, pos.z);
            this.pathMesh.setMatrixAt(i, matrix);
        }
        this.pathMesh.count = cells.length;
        this.pathMesh.instanceMatrix.needsUpdate = true;

        this.pulseClock = 0;
        this.pulse.visible = true;
    }

    clearOverlay(): void {
        for (const cell of this.overlayTouched) {
            if (this.overlayKind[cell] !== 0) {
                this.overlayKind[cell] = 0;
                this.refreshCell(cell);
            }
        }
        this.overlayTouched.length = 0;
        this.pathCells = [];
        if (this.pathMesh) this.pathMesh.count = 0;
        this.pulseClock = -1;
        this.pulse.visible = false;
    }

    resetCamera(): void {
        const position = this.defaultCameraPosition();
        this.controls.autoRotate = false;
        this.tween = {
            fromPos: this.camera.position.clone(),
            toPos: position,
            fromTarget: this.controls.target.clone(),
            toTarget: new THREE.Vector3(0, 0, 0),
            t: 0,
        };
    }

    /* ============================================== доп. эффекты */

    /** Лёгкий автоматический облёт после завершения генерации. */
    autoSweep(): void {
        this.stopSweep();
        this.controls.autoRotate = true;
        this.sweepTimer = setTimeout(() => {
            this.sweepTimer = null;
            this.controls.autoRotate = false;
        }, 5200);
    }

    /** Остановить автооблёт: работа алгоритма не должна «уезжать» из-под камеры. */
    stopSweep(): void {
        if (this.sweepTimer) {
            clearTimeout(this.sweepTimer);
            this.sweepTimer = null;
        }
        this.controls.autoRotate = false;
    }

    /** Пульсация маркеров/пути + камера. Вызывается каждый кадр. */
    renderFrame(dt: number): void {
        if (this.disposed) return;
        const time = performance.now() * 0.001;

        const beat = 1 + Math.sin(time * 2.6) * 0.05;
        this.startMarker.scale.setScalar(beat);
        this.finishMarker.scale.setScalar(2 - beat);

        this.updatePathPulse(dt);
        this.updateTween(dt);

        this.controls.update(dt);
        this.composer.render();
    }

    dispose(): void {
        this.disposed = true;
        if (this.sweepTimer) clearTimeout(this.sweepTimer);
        this.resizeObserver.disconnect();
        this.disposeLayout();
        this.controls.dispose();
        this.wallGeometry.dispose();
        this.wallMaterial.dispose();
        this.cellGeometry.dispose();
        this.cellMaterial.dispose();
        this.pathGeometry.dispose();
        this.pathMaterial.dispose();
        this.floorMaterial.dispose();
        this.pulse.geometry.dispose();
        (this.pulse.material as THREE.Material).dispose();
        this.disposeMarker(this.startMarker);
        this.disposeMarker(this.finishMarker);
        this.composer.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    /* ================================================= строительство */

    private build(size: number): void {
        this.size = size;
        this.cellCount = size * size;
        this.wallCount = 2 * size * (size + 1);

        this.genKind = new Uint8Array(this.cellCount);
        this.overlayKind = new Uint8Array(this.cellCount);
        this.markerKind = new Uint8Array(this.cellCount);
        this.overlayTouched = [];
        this.cellDirty = [];
        this.wallVisible = new Uint8Array(this.wallCount).fill(1);
        this.pathCells = [];
        this.pulse.visible = false;
        this.pulseClock = -1;

        // ------------------------------------------------------- пол
        const floorGeometry = new THREE.PlaneGeometry(size, size);
        floorGeometry.rotateX(-Math.PI / 2);
        const floor = new THREE.Mesh(floorGeometry, this.floorMaterial);
        floor.receiveShadow = true;
        floor.renderOrder = -1;
        this.scene.add(floor);
        this.floor = floor;

        // ------------------------------------------------------ стены
        this.wallPos = new Float32Array(this.wallCount * 3);
        this.wallScale = new Float32Array(this.wallCount * 3);
        const half = size / 2;

        // Горизонтальные стены: index = by * size + bx
        for (let by = 0; by <= size; by++) {
            for (let bx = 0; bx < size; bx++) {
                const i = by * size + bx;
                this.wallPos[i * 3] = bx + 0.5 - half;
                this.wallPos[i * 3 + 1] = WALL_HEIGHT / 2;
                this.wallPos[i * 3 + 2] = by - half;
                this.wallScale[i * 3] = CELL;
                this.wallScale[i * 3 + 1] = WALL_HEIGHT;
                this.wallScale[i * 3 + 2] = WALL_THICKNESS;
            }
        }
        // Вертикальные стены: index = size*(size+1) + by*(size+1) + bx
        const vBase = size * (size + 1);
        for (let by = 0; by < size; by++) {
            for (let bx = 0; bx <= size; bx++) {
                const i = vBase + by * (size + 1) + bx;
                this.wallPos[i * 3] = bx - half;
                this.wallPos[i * 3 + 1] = WALL_HEIGHT / 2;
                this.wallPos[i * 3 + 2] = by + 0.5 - half;
                this.wallScale[i * 3] = WALL_THICKNESS;
                this.wallScale[i * 3 + 1] = WALL_HEIGHT;
                this.wallScale[i * 3 + 2] = CELL;
            }
        }

        const walls = new THREE.InstancedMesh(this.wallGeometry, this.wallMaterial, this.wallCount);
        walls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        walls.castShadow = true;
        walls.receiveShadow = true;
        walls.frustumCulled = false;
        walls.matrixAutoUpdate = false;
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        for (let i = 0; i < this.wallCount; i++) {
            position.set(this.wallPos[i * 3], this.wallPos[i * 3 + 1], this.wallPos[i * 3 + 2]);
            scale.set(this.wallScale[i * 3], this.wallScale[i * 3 + 1], this.wallScale[i * 3 + 2]);
            matrix.compose(position, quaternion, scale);
            walls.setMatrixAt(i, matrix);
        }
        walls.instanceMatrix.needsUpdate = true;
        this.scene.add(walls);
        this.walls = walls;

        // ----------------------------------------------------- клетки
        const cells = new THREE.InstancedMesh(this.cellGeometry, this.cellMaterial, this.cellCount);
        cells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cellCount * 3), 3);
        cells.instanceColor.setUsage(THREE.DynamicDrawUsage);
        cells.receiveShadow = true;
        cells.frustumCulled = false;
        cells.matrixAutoUpdate = false;
        for (let i = 0; i < this.cellCount; i++) {
            const pos = this.cellPosition(i);
            matrix.makeTranslation(pos.x, CELL_Y, pos.z);
            cells.setMatrixAt(i, matrix);
        }
        cells.instanceMatrix.needsUpdate = true;
        this.scene.add(cells);
        this.cells = cells;
        this.setAllCellColors();
        cells.instanceColor.needsUpdate = true;

        // ------------------------------------------------------- путь
        const pathMesh = new THREE.InstancedMesh(this.pathGeometry, this.pathMaterial, this.cellCount);
        pathMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        pathMesh.frustumCulled = false;
        pathMesh.matrixAutoUpdate = false;
        pathMesh.count = 0;
        pathMesh.visible = true;
        this.scene.add(pathMesh);
        this.pathMesh = pathMesh;

        // ---------------------------------------------------- камера
        const camPos = this.defaultCameraPosition();
        this.camera.position.copy(camPos);
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = Math.max(3, size * 0.35);
        this.controls.maxDistance = size * 2.5 + 30;
        this.camera.far = Math.max(4000, size * 12);
        this.camera.updateProjectionMatrix();
        this.controls.update(0);

        // ------------------------------------------------ освещение
        const shadowOn = size <= 50;
        this.sun.castShadow = shadowOn;
        if (shadowOn) {
            const bound = size * 0.9;
            const shadowCamera = this.sun.shadow.camera;
            shadowCamera.left = -bound;
            shadowCamera.right = bound;
            shadowCamera.top = bound;
            shadowCamera.bottom = -bound;
            shadowCamera.far = size * 4 + 60;
            shadowCamera.updateProjectionMatrix();
            this.sun.position.set(size * 0.55, size * 1.1 + 30, size * 0.4);
        } else {
            this.sun.position.set(size * 0.5, size * 1.4, size * 0.35);
        }
        this.sun.target.position.set(0, 0, 0);
        this.sun.target.updateMatrixWorld();

        const fogDensity = clamp(0.32 / Math.max(size, 1), 0.0015, 0.03);
        (this.scene.fog as THREE.FogExp2).density = fogDensity;

        this.handleResize();
    }

    private disposeLayout(): void {
        if (this.walls) {
            this.scene.remove(this.walls);
            this.walls.dispose();
            this.walls = null;
        }
        if (this.cells) {
            this.scene.remove(this.cells);
            this.cells.dispose();
            this.cells = null;
        }
        if (this.pathMesh) {
            this.scene.remove(this.pathMesh);
            this.pathMesh.dispose();
            this.pathMesh = null;
        }
        if (this.floor) {
            this.scene.remove(this.floor);
            this.floor.geometry.dispose();
            this.floor = null;
        }
        this.size = 0;
        this.cellCount = 0;
        this.wallCount = 0;
        this.cellDirty = [];
        this.overlayTouched = [];
        this.pathCells = [];
        this.pulse.visible = false;
        this.tween = null;
    }

    /* ============================================== внутренние helper'ы */

    private cellPosition(cell: number): { x: number; z: number } {
        const half = this.size / 2;
        const x = cell % this.size;
        const y = (cell / this.size) | 0;
        return { x: x + 0.5 - half, z: y + 0.5 - half };
    }

    private defaultCameraPosition(): THREE.Vector3 {
        const s = Math.max(this.size, 4);
        return new THREE.Vector3(s * 0.72, s * 0.82 + 6, s * 0.94);
    }

    private setWallVisible(index: number, visible: boolean): void {
        if (!this.walls) return;
        if (index < 0 || index >= this.wallCount) return;
        const flag = visible ? 1 : 0;
        if (this.wallVisible[index] === flag) return;
        this.wallVisible[index] = flag;

        TEMP_POSITION.set(this.wallPos[index * 3], this.wallPos[index * 3 + 1], this.wallPos[index * 3 + 2]);
        if (visible) {
            TEMP_SCALE.set(
                this.wallScale[index * 3],
                this.wallScale[index * 3 + 1],
                this.wallScale[index * 3 + 2],
            );
        } else {
            TEMP_SCALE.set(0, 0, 0);
        }
        TEMP_MATRIX.compose(TEMP_POSITION, TEMP_QUATERNION, TEMP_SCALE);
        this.walls.setMatrixAt(index, TEMP_MATRIX);
        this.wallDirty = true;
    }

    private refreshCell(cell: number): void {
        if (!this.cells) return;
        const color = this.cells.instanceColor;
        if (!color) return;
        const kind =
            this.markerKind[cell] || this.overlayKind[cell] || this.genKind[cell] || CellKind.Empty;
        const offset = kind * 3;
        const target = cell * 3;
        const array = color.array as Float32Array;
        array[target] = this.palette[offset];
        array[target + 1] = this.palette[offset + 1];
        array[target + 2] = this.palette[offset + 2];
        if (!this.fullCellDirty) this.cellDirty.push(cell);
    }

    private setAllCellColors(): void {
        if (!this.cells) return;
        const color = this.cells.instanceColor;
        if (!color) return;
        const array = color.array as Float32Array;
        for (let cell = 0; cell < this.cellCount; cell++) {
            const kind = this.markerKind[cell] || this.overlayKind[cell] || this.genKind[cell] || CellKind.Empty;
            const offset = kind * 3;
            array[cell * 3] = this.palette[offset];
            array[cell * 3 + 1] = this.palette[offset + 1];
            array[cell * 3 + 2] = this.palette[offset + 2];
        }
        this.cellDirty = [];
    }

    private setFullCellDirty(): void {
        this.fullCellDirty = true;
        this.cellDirty = [];
    }

    private clearVisualState(): void {
        this.genKind.fill(0);
        this.overlayKind.fill(0);
        this.markerKind.fill(0);
        this.overlayTouched = [];
        this.pathCells = [];
        if (this.pathMesh) this.pathMesh.count = 0;
        this.pulse.visible = false;
        this.pulseClock = -1;
        this.setAllCellColors();
    }

    private hideMarkers(): void {
        this.startMarker.visible = false;
        this.finishMarker.visible = false;
    }

    private placeMarker(marker: THREE.Group, cell: number, visible: boolean): void {
        const pos = this.cellPosition(cell);
        marker.position.set(pos.x, 0, pos.z);
        marker.visible = visible;
    }

    private createMarker(color: number): THREE.Group {
        const group = new THREE.Group();
        const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 0.08, 26),
            new THREE.MeshBasicMaterial({ color, toneMapped: false }),
        );
        disc.position.y = 0.07;
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.4, 0.045, 10, 40),
            new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.9 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.12;
        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 2.2, 12, 1, true),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.3,
                toneMapped: false,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            }),
        );
        beam.position.y = 1.1;
        group.add(disc, ring, beam);
        group.visible = false;
        this.scene.add(group);
        return group;
    }

    private disposeMarker(marker: THREE.Group): void {
        marker.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh) {
                mesh.geometry.dispose();
                (mesh.material as THREE.Material).dispose();
            }
        });
        this.scene.remove(marker);
    }

    private updatePathPulse(dt: number): void {
        if (this.pulseClock < 0 || this.pathCells.length < 2) {
            this.pulse.visible = false;
            return;
        }
        this.pulseClock += dt;
        const duration = clamp(this.pathCells.length / 22, 1.6, 9);
        const progress = (this.pulseClock % duration) / duration;
        const maxIndex = this.pathCells.length - 1;
        const floating = progress * maxIndex;
        const index = Math.min(maxIndex, Math.floor(floating));
        const next = Math.min(maxIndex, index + 1);
        const frac = floating - index;

        const from = this.cellPosition(this.pathCells[index]);
        const to = this.cellPosition(this.pathCells[next]);
        const x = from.x + (to.x - from.x) * frac;
        const z = from.z + (to.z - from.z) * frac;
        this.pulse.position.set(x, 0.34 + Math.sin(this.pulseClock * 6) * 0.05, z);
        const scale = 1 + Math.sin(this.pulseClock * 9) * 0.14;
        this.pulse.scale.setScalar(scale);
        this.pulse.visible = true;
    }

    private updateTween(dt: number): void {
        if (!this.tween) return;
        this.tween.t = Math.min(1, this.tween.t + dt / 0.75);
        const eased =
            this.tween.t < 0.5
                ? 4 * this.tween.t ** 3
                : 1 - Math.pow(-2 * this.tween.t + 2, 3) / 2;
        this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, eased);
        this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, eased);
        if (this.tween.t >= 1) this.tween = null;
    }

    private handleResize(): void {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);
        this.bloom.setSize(width, height);
    }

    /** Вызывается контроллером раз в кадр после обновления состояния. */
    flush(): void {
        if (this.cells && this.cells.instanceColor && (this.fullCellDirty || this.cellDirty.length > 0)) {
            this.cells.instanceColor.needsUpdate = true;
            this.cellDirty = [];
            this.fullCellDirty = false;
        }
        if (this.walls && this.wallDirty) {
            this.walls.instanceMatrix.needsUpdate = true;
            this.wallDirty = false;
        }
    }
}
