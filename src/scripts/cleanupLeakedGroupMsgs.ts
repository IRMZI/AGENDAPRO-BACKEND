// Remove mensagens de GRUPO que vazaram para conversas 1:1 (bug do resolveChatId
// com fromMe em grupo). Identifica por raw_data._data.Info.IsGroup === true numa
// conversa individual. Depois apaga conversas individuais que ficaram vazias.
import { prisma } from "../lib/prisma.js";

async function main() {
  const indivConvs = await prisma.whatsappConversation.findMany({
    where: { type: "individual" },
    select: { id: true, wa_chat_id: true },
  });
  let deletedMsgs = 0;
  for (const c of indivConvs) {
    const msgs = await prisma.whatsappMessage.findMany({
      where: { conversation_id: c.id },
      select: { id: true, raw_data: true },
    });
    const leaked = msgs.filter((m) => {
      const info = (m.raw_data as any)?._data?.Info;
      const chat = info?.Chat;
      return info?.IsGroup === true || (typeof chat === "string" && chat.endsWith("@g.us"));
    });
    if (leaked.length) {
      await prisma.whatsappMessage.deleteMany({
        where: { id: { in: leaked.map((m) => m.id) } },
      });
      deletedMsgs += leaked.length;
      console.log(`conv ${c.wa_chat_id}: ${leaked.length} msg(s) de grupo removida(s)`);
    }
  }

  // Conversas individuais que ficaram sem nenhuma mensagem.
  const empty = await prisma.whatsappConversation.findMany({
    where: { type: "individual", messages: { none: {} } },
    select: { id: true, wa_chat_id: true },
  });
  if (empty.length) {
    await prisma.whatsappConversation.deleteMany({
      where: { id: { in: empty.map((e) => e.id) } },
    });
    console.log(`Conversas vazias removidas: ${empty.length}`);
  }
  console.log(`\nTotal msgs removidas: ${deletedMsgs}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
