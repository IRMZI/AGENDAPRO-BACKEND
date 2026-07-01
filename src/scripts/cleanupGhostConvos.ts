// One-off: remove conversas individuais "fantasma" (sem nenhuma mensagem),
// criadas pelas automações antigas que mandavam para `${digits}@c.us` e
// falhavam no envio. Lista antes de apagar. Rodar com:
//   npx tsx src/scripts/cleanupGhostConvos.ts
import { prisma } from "../lib/prisma.js";

async function main() {
  const ghosts = await prisma.whatsappConversation.findMany({
    where: {
      type: "individual",
      messages: { none: {} },
    },
    select: {
      id: true,
      company_id: true,
      wa_chat_id: true,
      last_message_at: true,
      contact: { select: { phone: true, push_name: true } },
    },
  });

  console.log(`Conversas-fantasma encontradas: ${ghosts.length}`);
  for (const g of ghosts) {
    console.log(
      `  - ${g.wa_chat_id}  (contato: ${g.contact?.push_name ?? g.contact?.phone ?? "—"})`,
    );
  }

  if (ghosts.length === 0) {
    console.log("Nada a limpar.");
    return;
  }

  const ids = ghosts.map((g) => g.id);
  const del = await prisma.whatsappConversation.deleteMany({
    where: { id: { in: ids } },
  });
  console.log(`Removidas: ${del.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
