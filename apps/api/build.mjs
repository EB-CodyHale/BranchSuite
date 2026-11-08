// Bundles the Azure Functions entry point into a single ESM file.
// CJS dependencies (Azure SDKs) call require(); the banner provides it in ESM output.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

await build({
  entryPoints: [join(here, 'src/functions/index.ts')],
  outfile: join(here, 'dist/functions.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'none',
  // Provided by the Azure Functions Node.js worker at runtime; never bundled.
  external: ['@azure/functions-core'],
  define: { 'process.env.BUNDLED_APP_VERSION': JSON.stringify(pkg.version) },
  banner: {
    js: "import { createRequire as __bsCreateRequire } from 'node:module'; const require = __bsCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
