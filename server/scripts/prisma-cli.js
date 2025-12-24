#!/usr/bin/env node
import '../src/env.js';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prismaBin = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: prisma-cli <args>');
  process.exit(1);
}

const child = spawn(prismaBin, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
