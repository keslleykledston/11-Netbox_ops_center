import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

const envPaths = [
  path.join(rootDir, '.env'),
  path.join(rootDir, '.env.local'),
];

envPaths.forEach((envPath, index) => {
  const isLocal = index === 1;
  dotenv.config({ path: envPath, override: isLocal });
});
