#!/usr/bin/env node
// azd prepackage hook for the api service. Assembles the Flex Consumption deployment package
// from the esbuild bundle: host.json, a minimal package.json (entry point only, no
// dependencies, since the bundle is self-contained) and dist/.
// Usage (from apps/api): node ../../infra/scripts/stage-api.mjs [outDir=build/package]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const projectDir = process.cwd();
const outDir = resolve(projectDir, process.argv[2] ?? 'build/package');
const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
const entry = pkg.main;

if (typeof entry !== 'string' || !existsSync(join(projectDir, entry))) {
  console.error(`Bundle entry "${entry}" is missing. Run "npm run build" in ${projectDir} first.`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(projectDir, 'host.json'), join(outDir, 'host.json'));
cpSync(join(projectDir, 'dist'), join(outDir, 'dist'), { recursive: true });
writeFileSync(
  join(outDir, 'package.json'),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: pkg.type, main: entry }, null, 2)}\n`,
);
console.log(`Staged Functions package in ${outDir} (entry ${entry}).`);
