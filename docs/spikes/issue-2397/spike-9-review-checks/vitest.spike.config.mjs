import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
export default {
    cacheDir: join(tmpdir(), 'alphatab-spike-9-vite-cache'),
    resolve: {
        alias: [{ find: /^@coderline\/alphatab\/(.*)$/, replacement: repo + '/packages/alphatab/src/$1' }]
    },
    test: {
        root: here,
        include: ['*.spike.test.ts'],
        globals: true,
        testTimeout: 60000,
        disableConsoleIntercept: true
    }
};
