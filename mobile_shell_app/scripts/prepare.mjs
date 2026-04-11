import { existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const envFile = resolve(root, '.env');
const envExample = resolve(root, '.env.example');

if (!existsSync(envFile) && existsSync(envExample)) {
  copyFileSync(envExample, envFile);
  console.log('[prepare] Created .env from .env.example');
}

console.log('[prepare] Capacitor shell is ready.');
