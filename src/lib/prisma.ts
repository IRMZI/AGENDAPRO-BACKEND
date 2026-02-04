import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'event',
      level: 'error',
    },
    {
      emit: 'event',
      level: 'info',
    },
    {
      emit: 'event',
      level: 'warn',
    },
  ],
});

// Log das queries do Prisma
prisma.$on('query', (e) => {
  console.log('[PRISMA] 📝 Query:', {
    query: e.query,
    params: e.params,
    duration: `${e.duration}ms`,
    timestamp: e.timestamp
  });
});

// Log dos erros do Prisma
prisma.$on('error', (e) => {
  console.error('[PRISMA] 💥 ERRO:', {
    message: e.message,
    target: e.target,
    timestamp: e.timestamp
  });
});

// Log de informações do Prisma
prisma.$on('info', (e) => {
  console.log('[PRISMA] ℹ️ Info:', {
    message: e.message,
    target: e.target,
    timestamp: e.timestamp
  });
});

// Log de warnings do Prisma
prisma.$on('warn', (e) => {
  console.warn('[PRISMA] ⚠️ Warning:', {
    message: e.message,
    target: e.target,
    timestamp: e.timestamp
  });
});
