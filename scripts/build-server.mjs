// Empacota o servidor em dist/server/index.js. As dependências de runtime ficam de fora
// (instaladas com `npm ci --omit=dev` na imagem); node:sqlite é do próprio Node.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
