/**
 * Очередь визуальных событий между воркером (алгоритмом) и рендерером.
 * Позволяет «запасаться» событиями и ограничивать их расход за кадр,
 * поэтому даже на 200×200 интерфейс остаётся отзывчивым.
 */
export class EventQueue<T> {
    private items: T[] = [];
    private head = 0;

    get size(): number {
        return this.items.length - this.head;
    }

    get isEmpty(): boolean {
        return this.size === 0;
    }

    push(...values: T[]): void {
        if (values.length === 0) return;
        this.compact();
        for (const v of values) this.items.push(v);
    }

    shift(): T | undefined {
        if (this.head >= this.items.length) return undefined;
        const value = this.items[this.head];
        this.items[this.head] = undefined as unknown as T;
        this.head += 1;
        return value;
    }

    clear(): void {
        this.items = [];
        this.head = 0;
    }

    /** Не даёт массиву разрастаться при долгой работе. */
    private compact(): void {
        if (this.head > 1024 && this.head * 2 >= this.items.length) {
            this.items = this.items.slice(this.head);
            this.head = 0;
        }
    }
}
