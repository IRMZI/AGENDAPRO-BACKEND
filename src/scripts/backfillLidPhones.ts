// Backfill: resolve o telefone REAL dos contatos @lid (que estavam com o LID
// como "telefone") a partir do `_data.Info.SenderAlt` das mensagens, e atualiza
// também o cliente vinculado cujo telefone ainda é o LID.
//   npx tsx src/scripts/backfillLidPhones.ts
import { prisma } from "../lib/prisma.js";

const realPhoneFromAltJid = (jid: unknown): string | null => {
  if (typeof jid !== "string" || !/@(s\.whatsapp\.net|c\.us)/i.test(jid))
    return null;
  const digits = (jid.split("@")[0]?.split(":")[0] ?? "").replace(/\D/g, "");
  return digits || null;
};

async function main() {
  const contacts = await prisma.whatsappContact.findMany({
    where: { wa_id: { endsWith: "@lid" } },
    include: { conversations: { select: { id: true } } },
  });
  console.log(`Contatos @lid: ${contacts.length}`);

  let updatedContacts = 0;
  let updatedClients = 0;
  let updatedBookings = 0;

  for (const c of contacts) {
    const lidDigits = c.wa_id.split("@")[0]?.split(":")[0] ?? "";
    const convIds = c.conversations.map((cv) => cv.id);
    if (!convIds.length) continue;

    const msgs = await prisma.whatsappMessage.findMany({
      where: { conversation_id: { in: convIds }, direction: "inbound" },
      orderBy: { timestamp: "desc" },
      take: 30,
      select: { raw_data: true },
    });

    let realPhone: string | null = null;
    for (const m of msgs) {
      const alt = (m.raw_data as any)?._data?.Info?.SenderAlt;
      const p = realPhoneFromAltJid(alt);
      if (p) {
        realPhone = p;
        break;
      }
    }
    if (!realPhone) continue;

    if (realPhone !== c.phone) {
      await prisma.whatsappContact.update({
        where: { id: c.id },
        data: { phone: realPhone, updated_at: new Date() },
      });
      updatedContacts++;
      console.log(
        `contato ${c.push_name ?? c.wa_id}: ${c.phone} -> ${realPhone}`,
      );
    }

    // Atualiza QUALQUER cliente da empresa cujo telefone ainda seja o LID
    // (auto-criados a partir do LID), tendo vínculo explícito ou não. LIDs têm
    // 14+ dígitos, então não colidem com telefones reais (12-13).
    if (lidDigits && lidDigits !== realPhone) {
      const clients = await prisma.client.findMany({
        where: { company_id: c.company_id },
        select: { id: true, name: true, phone: true },
      });
      for (const client of clients) {
        if ((client.phone ?? "").replace(/\D/g, "") === lidDigits) {
          await prisma.client.update({
            where: { id: client.id },
            data: { phone: realPhone },
          });
          updatedClients++;
          console.log(
            `  cliente ${client.name}: ${client.phone} -> ${realPhone}`,
          );
        }
      }

      // Agendamentos antigos guardam o telefone como snapshot — corrige os que
      // ficaram com o LID.
      const bk = await prisma.booking.updateMany({
        where: { company_id: c.company_id, client_phone: lidDigits },
        data: { client_phone: realPhone },
      });
      if (bk.count > 0) {
        updatedBookings += bk.count;
        console.log(`  ${bk.count} agendamento(s): ${lidDigits} -> ${realPhone}`);
      }
    }
  }

  console.log(
    `\nContatos: ${updatedContacts} | Clientes: ${updatedClients} | Agendamentos: ${updatedBookings}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
