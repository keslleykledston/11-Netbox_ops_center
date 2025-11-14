import 'dotenv/config';
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

