// Runs every browser flow, each against a fresh fixture server (state must start empty).
// Usage: PLAYWRIGHT_CORE=… CHROMIUM_PATH=… node scripts/v5-e2e/run-all.mjs [flow names…]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const dir = new URL('.', import.meta.url).pathname;
const flows = process.argv.slice(2).length ? process.argv.slice(2) : ['flow2', 'flow', 'flow3', 'flow4', 'flow5', 'flow6', 'flow7', 'flow8'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

for (const flow of flows) {
  fs.rmSync(`${dir}cookies.json`, { force: true });
  const server = spawn('node', ['--experimental-transform-types', `${dir}server.ts`], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => server.stdout.on('data', (chunk) => String(chunk).includes('READY') && resolve()));
  await sleep(300);
  const code = await new Promise((resolve) => spawn('node', [`${dir}${flow}.mjs`], { stdio: 'inherit', env: process.env }).on('exit', resolve));
  server.kill();
  console.log(`== ${flow}: ${code === 0 ? 'ok' : 'FAILED'}\n`);
  if (code !== 0) failed++;
  await sleep(500);
}
process.exit(failed ? 1 : 0);
