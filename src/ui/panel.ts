import { AppController } from '../core/controller';
import { DEFAULT_SIZE, SIZES, SPEEDS, type MazeSize } from '../core/config';
import type { AppPhase, StatsView } from '../core/types';

const PHASE_LABEL: Record<AppPhase, string> = {
    idle: 'Готов',
    generating: 'Генерация',
    generationPaused: 'Генерация на паузе',
    generationComplete: 'Генерация завершена',
    searching: 'Поиск пути',
    searchPaused: 'Поиск на паузе',
    pathFound: 'Путь найден',
    error: 'Ошибка',
};

/** Понятные русские названия алгоритмов для панели. */
const ALGO_LABEL: Record<string, string> = {
    'Randomized DFS': 'Случайный DFS',
    'Breadth-First Search': 'Поиск в ширину (BFS)',
};

function algoLabel(name: string): string {
    return ALGO_LABEL[name] ?? name;
}

const numberFormat = new Intl.NumberFormat('ru-RU');

function fmt(value: number): string {
    return numberFormat.format(value);
}

/** Время расчёта: миллисекунды честнее, чем «0.00 s» на малых лабиринтах. */
function fmtTime(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

/** Склонение слова «клетка» для строки «Длина». */
function pluralCells(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'клетка';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'клетки';
    return 'клеток';
}

/**
 * Панель управления: кнопки, скорость, статистика, индикатор состояния.
 * Знает только о контроллере — ничего о Three.js и воркере.
 */
export class Panel {
    private readonly root: HTMLElement;
    private readonly stateChip: HTMLElement;
    private readonly sizeGrid: HTMLElement;
    private readonly stats: HTMLElement;
    private readonly progressBar: HTMLElement;
    private readonly progressWrap: HTMLElement;
    private readonly speedSlider: HTMLInputElement;
    private readonly speedValue: HTMLElement;

    private readonly btnGenerate: HTMLButtonElement;
    private readonly btnFind: HTMLButtonElement;
    private readonly btnPause: HTMLButtonElement;
    private readonly btnResume: HTMLButtonElement;
    private readonly btnStep: HTMLButtonElement;
    private readonly btnReset: HTMLButtonElement;
    private readonly btnCamera: HTMLButtonElement;

    private phase: AppPhase = 'idle';
    private selectedSize = DEFAULT_SIZE;

    constructor(private readonly controller: AppController) {
        this.root = document.getElementById('panel') as HTMLElement;
        this.stateChip = document.getElementById('stateChip') as HTMLElement;
        this.sizeGrid = document.getElementById('sizeGrid') as HTMLElement;
        this.stats = document.getElementById('stats') as HTMLElement;
        this.progressBar = document.getElementById('progressBar') as HTMLElement;
        this.progressWrap = document.getElementById('progressWrap') as HTMLElement;
        this.speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
        this.speedValue = document.getElementById('speedValue') as HTMLElement;

        this.btnGenerate = document.getElementById('btnGenerate') as HTMLButtonElement;
        this.btnFind = document.getElementById('btnFind') as HTMLButtonElement;
        this.btnPause = document.getElementById('btnPause') as HTMLButtonElement;
        this.btnResume = document.getElementById('btnResume') as HTMLButtonElement;
        this.btnStep = document.getElementById('btnStep') as HTMLButtonElement;
        this.btnReset = document.getElementById('btnReset') as HTMLButtonElement;
        this.btnCamera = document.getElementById('btnCamera') as HTMLButtonElement;

        this.buildSizeButtons();
        this.buildSpeedTicks();
        this.wireEvents();

        const algoGen = document.getElementById('algoGen');
        const algoSearch = document.getElementById('algoSearch');
        if (algoGen) algoGen.textContent = algoLabel(this.controller.generatorName);
        if (algoSearch) algoSearch.textContent = algoLabel(this.controller.pathfinderName);

        this.controller.on('phase', (phase) => this.setPhase(phase));
        this.controller.on('stats', (stats) => this.renderStats(stats));

        this.speedSlider.value = String(SPEEDS.indexOf(1));
        this.updateSpeedLabel();
        this.applyPhaseRules();
        this.renderIdleStats();
    }

    /* --------------------------------------------------- разметка */

    private buildSizeButtons(): void {
        for (const size of SIZES) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'size-btn' + (size === this.selectedSize ? ' is-active' : '');
            button.dataset.size = String(size);
            button.textContent = `${size} × ${size}`;
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', String(size === this.selectedSize));
            button.addEventListener('click', () => this.selectSize(size));
            this.sizeGrid.appendChild(button);
        }
    }

    private buildSpeedTicks(): void {
        const ticks = document.getElementById('speedTicks') as HTMLElement;
        for (const speed of SPEEDS) {
            const span = document.createElement('span');
            span.textContent = `${speed}×`;
            ticks.appendChild(span);
        }
    }

    private wireEvents(): void {
        this.btnGenerate.addEventListener('click', () => void this.controller.generate(this.selectedSize));
        this.btnFind.addEventListener('click', () => void this.controller.findPath());
        this.btnPause.addEventListener('click', () => this.controller.pause());
        this.btnResume.addEventListener('click', () => this.controller.resume());
        this.btnStep.addEventListener('click', () => void this.controller.step());
        this.btnReset.addEventListener('click', () => this.controller.reset());
        this.btnCamera.addEventListener('click', () => this.controller.resetCamera());

        this.speedSlider.addEventListener('input', () => {
            const index = Number(this.speedSlider.value);
            this.controller.setSpeed(SPEEDS[index] ?? 1);
            this.updateSpeedLabel();
        });

        const toggle = document.getElementById('panelToggle') as HTMLButtonElement;
        toggle.addEventListener('click', () => this.toggleMobilePanel());

        window.addEventListener('keydown', (event) => {
            if (event.target instanceof HTMLInputElement) return;
            if (event.code === 'Space') {
                event.preventDefault();
                if (this.phase === 'generating' || this.phase === 'searching') this.controller.pause();
                else if (this.phase === 'generationPaused' || this.phase === 'searchPaused') {
                    this.controller.resume();
                }
            }
        });
    }

    private selectSize(size: MazeSize): void {
        if (this.phase === 'generating' || this.phase === 'searching') return;
        this.selectedSize = size;
        for (const button of Array.from(this.sizeGrid.children) as HTMLButtonElement[]) {
            const active = Number(button.dataset.size) === size;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-checked', String(active));
        }
        // Строка «Размер» в покое показывает выбранный размер — обновляем сразу,
        // чтобы статистика не расходилась с подсветкой кнопок.
        if (this.phase === 'idle' || this.phase === 'error') this.renderIdleStats(this.phase === 'error');
    }

    private updateSpeedLabel(): void {
        const index = Number(this.speedSlider.value);
        this.speedValue.textContent = `${SPEEDS[index] ?? 1}×`;
    }

    private toggleMobilePanel(): void {
        const open = this.root.classList.toggle('is-open');
        const toggle = document.getElementById('panelToggle') as HTMLButtonElement | null;
        if (toggle) toggle.setAttribute('aria-label', open ? 'Скрыть панель' : 'Открыть панель');
    }

    /* ---------------------------------------------------- состояния */

    setPhase(phase: AppPhase): void {
        this.phase = phase;
        this.stateChip.textContent = PHASE_LABEL[phase];
        this.stateChip.dataset.state = phase;
        this.applyPhaseRules();

        if (phase === 'idle' || phase === 'error') this.renderIdleStats(phase === 'error');
    }

    private applyPhaseRules(): void {
        const phase = this.phase;
        const running = phase === 'generating' || phase === 'searching';
        const paused = phase === 'generationPaused' || phase === 'searchPaused';

        this.btnGenerate.disabled = false;
        this.btnFind.disabled = !(phase === 'generationComplete' || phase === 'pathFound');
        this.btnPause.disabled = !running;
        this.btnResume.disabled = !paused;
        this.btnStep.disabled = !(running || paused);
        this.btnReset.disabled = phase === 'idle';
        this.btnCamera.disabled = false;

        for (const button of Array.from(this.sizeGrid.children) as HTMLButtonElement[]) {
            button.disabled = running;
        }

        // Прогресс-бар показывает ход и генерации, и поиска: всегда понятно,
        // сколько осталось и когда можно ждать завершения.
        this.progressWrap.hidden = !(
            phase === 'generating' ||
            phase === 'generationPaused' ||
            phase === 'searching' ||
            phase === 'searchPaused'
        );
    }

    /* ---------------------------------------------------- статистика */

    private renderIdleStats(isError = false): void {
        this.stats.replaceChildren();
        if (isError) {
            this.appendRow('Ошибка', this.controller.getError() || 'Неизвестная ошибка', 'danger');
            this.appendHint('Нажмите «Сгенерировать», чтобы начать заново');
            return;
        }
        this.appendRow('Алгоритм', algoLabel(this.controller.generatorName));
        this.appendRow('Размер', `${this.selectedSize} × ${this.selectedSize}`);
        this.appendHint('Выберите размер и нажмите «Сгенерировать»');
    }

    private renderStats(stats: StatsView): void {
        const phase = this.phase;
        const rows: Array<[string, string, string?]> = [];

        if (phase === 'generating' || phase === 'generationPaused' || phase === 'generationComplete') {
            rows.push(['Алгоритм', algoLabel(stats.algorithm)]);
            rows.push(['Размер', `${stats.size} × ${stats.size}`]);
            rows.push(['Прогресс', `${Math.round(stats.progress * 100)}%`]);
            rows.push(['Посещено', fmt(stats.visited)]);
            rows.push(['Возвраты', fmt(stats.backtracks)]);
            if (phase === 'generationComplete') rows.push(['Время', fmtTime(stats.timeMs)]);
        } else if (phase === 'searching' || phase === 'searchPaused') {
            rows.push(['Алгоритм', algoLabel(stats.algorithm)]);
            rows.push(['Размер', `${stats.size} × ${stats.size}`]);
            rows.push(['Исследовано', fmt(stats.explored)]);
            rows.push(['Очередь', fmt(stats.queue)]);
            rows.push(['Длина пути', stats.pathLength >= 0 ? fmt(stats.pathLength) : '—']);
        } else if (phase === 'pathFound') {
            rows.push(['Статус', 'Путь найден', 'title']);
            rows.push(['Длина', `${fmt(Math.max(0, stats.pathLength))} ${pluralCells(Math.max(0, stats.pathLength))}`]);
            rows.push(['Исследовано', fmt(stats.explored)]);
            rows.push(['Время', fmtTime(stats.timeMs)]);
        } else if (phase === 'idle' || phase === 'error') {
            this.renderIdleStats(phase === 'error');
            return;
        }

        this.stats.replaceChildren();
        for (const [label, value, mod] of rows) this.appendRow(label, value, mod);

        const progress = Math.max(0, Math.min(1, stats.progress));
        this.progressBar.style.width = `${progress * 100}%`;
    }

    private appendRow(label: string, value: string, mod?: string): void {
        const row = document.createElement('div');
        row.className = 'stat-row' + (mod ? ` stat-row--${mod}` : '');

        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        if (mod === 'title') {
            row.classList.add('stat-row--title');
            dd.textContent = value;
        }

        row.append(dt, dd);
        this.stats.appendChild(row);
    }

    /** Строка-подсказка без пары «метка — значение» (первый экран, ошибка). */
    private appendHint(text: string): void {
        const row = document.createElement('div');
        row.className = 'stat-row stat-row--hint';
        const dd = document.createElement('dd');
        dd.textContent = text;
        row.appendChild(dd);
        this.stats.appendChild(row);
    }
}
