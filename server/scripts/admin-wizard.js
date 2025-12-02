#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(__dirname, '..', '..'),
  path.resolve(__dirname, '..'),
  '/opt/netbox-ops-center',
  '/opt/11-Netbox_ops_center',
];
function resolveProjectRoot() {
  for (const candidate of candidates) {
    const schemaPath = path.resolve(candidate, 'server/prisma/schema.prisma');
    if (fs.existsSync(schemaPath)) return candidate;
  }
  return path.resolve(__dirname, '..', '..');
}
const projectRoot = resolveProjectRoot();
dotenv.config({ path: path.resolve(projectRoot, '.env') });
dotenv.config({ path: path.resolve(projectRoot, 'server/.env') });
if (!process.env.DATABASE_URL) {
  console.warn('[WIZARD][WARN] DATABASE_URL não definido. Usando Postgres local padrão.');
  process.env.DATABASE_URL = 'postgresql://netbox_ops:netbox_ops@localhost:5432/netbox_ops';
}
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Admin User Wizard ===');
  const rl = readline.createInterface({ input, output });
  try {
    const email = (await rl.question('Email (ex: admin@exemplo.com): ')).trim();
    const username = (await rl.question('Username (ex: admin): ')).trim() || email;
    const password = (await rl.question('Senha (será criptografada): ')).trim();
    const confirm = (await rl.question('Confirmar senha: ')).trim();
    if (!email || !password || password !== confirm) {
      console.error('Entrada inválida: email vazio, senha vazia ou confirmação não confere.');
      return;
    }
    const sure = (await rl.question('Confirmar criação deste admin? (sim/não): ')).trim().toLowerCase();
    if (sure !== 'sim' && sure !== 's') {
      console.log('Abortado.');
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.upsert({
      where: { email },
      update: { username, passwordHash: hash, role: 'admin', isActive: true, tenantId: null },
      create: { email, username, passwordHash: hash, role: 'admin', isActive: true, tenantId: null },
    });
    console.log('Usuário admin criado/atualizado:', { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId });
    console.log('\nPróximos passos:');
    console.log('- Acesse /login e entre com estas credenciais.');
    console.log('- Vá em /users para gerenciar demais contas.');
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

main().catch((e) => { console.error('Falha no wizard:', e); process.exit(1); });
