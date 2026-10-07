import { describe, expect, it } from 'vitest';
import { EventQueue } from '../src/core/eventQueue';

describe('EventQueue', () => {
    it('хранит события в порядке поступления', () => {
        const queue = new EventQueue<number>();
        expect(queue.isEmpty).toBe(true);

        queue.push(1, 2, 3);
        expect(queue.size).toBe(3);
        expect(queue.shift()).toBe(1);
        expect(queue.shift()).toBe(2);
        expect(queue.size).toBe(1);

        queue.push(4);
        expect(queue.shift()).toBe(3);
        expect(queue.shift()).toBe(4);
        expect(queue.shift()).toBeUndefined();
    });

    it('корректно очищается (пауза / сброс / новая генерация)', () => {
        const queue = new EventQueue<string>();
        queue.push('a', 'b', 'c');
        queue.shift();
        queue.clear();
        expect(queue.size).toBe(0);
        queue.push('x');
        expect(queue.shift()).toBe('x');
    });

    it('не разрастается при длинном потоке', () => {
        const queue = new EventQueue<number>();
        for (let i = 0; i < 5000; i++) {
            queue.push(i);
            if (i % 3 === 0) queue.shift();
        }
        let count = 0;
        while (!queue.isEmpty) {
            queue.shift();
            count++;
        }
        expect(count).toBe(5000 - Math.ceil(5000 / 3));
    });
});
