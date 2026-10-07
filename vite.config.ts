import { defineConfig } from 'vitest/config';

// base: './' — относительные пути, чтобы сборка работала на GitHub Pages
// (project pages могут лежать в подкаталоге /<repo>/).
export default defineConfig({
    base: './',
    build: {
        target: 'es2022',
        sourcemap: false,
        chunkSizeWarningLimit: 1200,
    },
    worker: {
        format: 'es',
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
