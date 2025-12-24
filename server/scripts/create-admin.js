import '../src/env.js';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL
    || process.env.DEFAULT_ADMIN_EMAIL
    || 'suporte@suporte.com.br';
  const username = process.env.ADMIN_USERNAME
    || process.env.DEFAULT_ADMIN_USERNAME
    || 'admin';
  const password = process.env.ADMIN_PASSWORD
    || process.env.DEFAULT_ADMIN_PASSWORD
    || 'Ops_pass_';

  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username,
      passwordHash: hash,
      role: 'admin',
      isActive: true,
      tenantId: null,
    },
    create: {
      email,
      username,
      passwordHash: hash,
      role: 'admin',
      isActive: true,
      tenantId: null,
    },
  });

  console.log('Admin user ready:', { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId });
}

main()
  .catch((e) => {
    console.error('Failed to create admin:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
