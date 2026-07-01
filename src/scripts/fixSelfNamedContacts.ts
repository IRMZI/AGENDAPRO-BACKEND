// Corrige contatos que ficaram com o NOME DO DONO da conta (ex.: "Romariz") no
// push_name. Causa: antes o webhook usava notifyName/PushName mesmo em mensagens
// fromMe — e nessas o nome é o do dono, não o do contato.
//
// Estratégia SEGURA (não mexe em nome legítimo de contato/empresa):
//  1. Descobre os "nomes do dono" por empresa = PushName/notifyName que aparecem
//     em mensagens ENVIADAS (fromMe). Esses são, por definição, o nome do dono.
//  2. Para cada conversa individual, olha o push_name do contato:
//       - se ele aparece em alguma mensagem RECEBIDA (inbound) → é nome real do
//         contato, mantém.
//       - senão, se ele é um "nome do dono" → está errado: troca pelo melhor
//         nome inbound, ou zera (null → a UI mostra o telefone).
//       - senão (procedência desconhecida) → NÃO mexe.
//  Não toca no campo `name` (override manual) nem em grupos.
//
//   npx tsx src/scripts/fixSelfNamedContacts.ts          (aplica)
//   npx tsx src/scripts/fixSelfNamedContacts.ts --dry     (só mostra)
import "dotenv/config";
import { prisma } from "../lib/prisma.js";

const DRY = process.argv.includes("--dry");

const isPlaceholder = (n?: string | null) => !!n && /^cliente whatsapp/i.test(n);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const namesFromRaw = (raw: any): string[] => {
  const out: string[] = [];
  for (const c of [raw?._data?.Info?.PushName, raw?.notifyName, raw?._data?.notifyName]) {
    if (typeof c === "string" && c.trim() && !isPlaceholder(c)) out.push(c.trim());
  }
  return out;
};

async function main() {
  // 1. Nomes do dono por empresa (a partir das mensagens fromMe / outbound).
  const companies = await prisma.whatsappSession.findMany({
    distinct: ["company_id"],
    select: { company_id: true },
  });
  const ownerNamesByCompany = new Map<string, Set<string>>();
  for (const { company_id } of companies) {
    const outbound = await prisma.whatsappMessage.findMany({
      where: { company_id, direction: "outbound" },
      select: { raw_data: true },
      orderBy: { timestamp: "desc" },
      take: 400,
    });
    const set = new Set<string>();
    for (const m of outbound) for (const n of namesFromRaw(m.raw_data)) set.add(n);
    ownerNamesByCompany.set(company_id, set);
  }

  // 2. Corrige conversa por conversa.
  const convs = await prisma.whatsappConversation.findMany({
    where: { type: "individual", contact_id: { not: null } },
    select: {
      id: true,
      company_id: true,
      wa_chat_id: true,
      contact_id: true,
      contact: { select: { push_name: true } },
    },
  });

  let fixed = 0;
  let cleared = 0;
  let skipped = 0;

  for (const c of convs) {
    const current = c.contact?.push_name?.trim() || "";
    if (!current) continue;

    const msgs = await prisma.whatsappMessage.findMany({
      where: { conversation_id: c.id },
      select: { raw_data: true, direction: true },
      orderBy: { timestamp: "desc" },
      take: 300,
    });
    const inbound = new Set<string>();
    for (const m of msgs)
      if (m.direction === "inbound")
        for (const n of namesFromRaw(m.raw_data)) inbound.add(n);

    // Nome legítimo do contato (ele mesmo já usou em mensagem recebida): mantém.
    if (inbound.has(current)) continue;

    const ownerNames = ownerNamesByCompany.get(c.company_id) ?? new Set();
    // Só corrige quando o nome atual é comprovadamente o nome do DONO.
    if (!ownerNames.has(current)) {
      skipped++;
      continue;
    }

    const replacement = [...inbound][0] ?? null;
    console.log(
      `${c.wa_chat_id}: "${current}" -> ${replacement ? `"${replacement}"` : "(sem nome / usa telefone)"}`,
    );
    if (!DRY) {
      await prisma.whatsappContact.update({
        where: { id: c.contact_id! },
        data: { push_name: replacement, updated_at: new Date() },
      });
    }
    if (replacement) fixed++;
    else cleared++;
  }

  console.log(
    `\n${DRY ? "[DRY] " : ""}Corrigidos: ${fixed} | nome removido (vira telefone): ${cleared} | preservados (nome não-dono): ${skipped}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
