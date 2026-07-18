// Mescla conversas INDIVIDUAIS duplicadas da mesma pessoa (LID vs @c.us vs web).
// Agrupa por telefone canônico (BR 9-aware), escolhe a conversa canônica
// (prefere @lid, depois melhor contato, depois mais recente), move as mensagens
// das duplicatas (dedup por wa_message_id), preserva vínculo de cliente, e apaga
// as duplicatas. Idempotente.
//   npx tsx src/scripts/mergeDuplicateConvs.ts          (aplica)
//   npx tsx src/scripts/mergeDuplicateConvs.ts --dry     (só mostra, não grava)
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { normalizeDigits } from "../lib/phone.js";

const DRY = process.argv.includes("--dry");

const realPhoneFromAltJid = (jid: unknown): string | null => {
  if (typeof jid !== "string" || !/@(s\.whatsapp\.net|c\.us)/i.test(jid))
    return null;
  const d = (jid.split("@")[0]?.split(":")[0] ?? "").replace(/\D/g, "");
  return d || null;
};

const isPlaceholder = (n?: string | null) => !!n && /^cliente whatsapp/i.test(n);

async function main() {
  // Sessão "primária" por empresa = a que o app usa p/ enviar (ativa +
  // authenticated, mais recente). A canônica deve ficar nela p/ o envio funcionar.
  const activeSessions = await prisma.whatsappSession.findMany({
    where: { is_active: true, status: "authenticated" },
    orderBy: { last_seen_at: "desc" },
    select: { id: true, company_id: true },
  });
  const primaryByCompany = new Map<string, string>();
  for (const s of activeSessions)
    if (!primaryByCompany.has(s.company_id))
      primaryByCompany.set(s.company_id, s.id);

  const convs = await prisma.whatsappConversation.findMany({
    where: { type: "individual" },
    include: {
      contact: {
        select: {
          id: true,
          phone: true,
          push_name: true,
          name: true,
          client_id: true,
          client_link_blocked: true,
        },
      },
      _count: { select: { messages: true } },
    },
  });

  // Union-find: une conversas que compartilham QUALQUER identidade — os dígitos
  // crus do jid (mesmo LID com sufixo @lid/@c.us) ou o telefone real canônico.
  const isReal = (p?: string | null) => {
    const d = (p ?? "").replace(/\D/g, "");
    return d.length >= 10 && d.length <= 13;
  };
  // Une por EMPRESA (não por sessão): reconexão cria nova sessão e re-cria as
  // conversas, então a mesma pessoa aparece em várias sessões.
  const keysOf = (c: (typeof convs)[number]): string[] => {
    const co = c.company_id;
    const rawDigits = c.wa_chat_id.split("@")[0]?.replace(/\D/g, "") ?? "";
    const keys = new Set<string>();
    if (rawDigits) keys.add(`${co}:raw:${rawDigits}`); // jid exato (une @lid/@c.us)
    if (isReal(c.contact?.phone))
      keys.add(`${co}:ph:${normalizeDigits(c.contact!.phone)}`);
    if (isReal(rawDigits)) keys.add(`${co}:ph:${normalizeDigits(rawDigits)}`);
    return [...keys];
  };

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  // Cada conversa é um nó (id); cada chave também. Liga conversa<->chaves.
  for (const c of convs) {
    parent.set(`c:${c.id}`, `c:${c.id}`);
    for (const k of keysOf(c)) {
      if (!parent.has(k)) parent.set(k, k);
      union(`c:${c.id}`, k);
    }
  }
  const groupsMap = new Map<string, typeof convs>();
  for (const c of convs) {
    const root = find(`c:${c.id}`);
    const arr = groupsMap.get(root) ?? [];
    arr.push(c);
    groupsMap.set(root, arr);
  }
  const groups = groupsMap;

  let mergedGroups = 0;
  let movedMsgs = 0;
  let deletedConvs = 0;

  for (const [, arr] of groups) {
    if (arr.length < 2) continue;

    // Escolhe a canônica: @lid > contato bom (push_name não-placeholder) >
    // mais mensagens > mais recente.
    const score = (c: (typeof arr)[number]) => {
      let s = 0;
      // Prioridade máxima: ficar na sessão primária (a que envia mensagens).
      if (primaryByCompany.get(c.company_id) === c.session_id) s += 100000;
      if (c.wa_chat_id.endsWith("@lid")) s += 1000;
      if (c.contact?.push_name && !isPlaceholder(c.contact.push_name)) s += 100;
      s += c._count.messages;
      return s;
    };
    const sorted = [...arr].sort((a, b) => score(b) - score(a));
    const canonical = sorted[0];
    const dups = sorted.slice(1);

    // Garante que a canônica tenha o melhor telefone/nome/cliente dos dups.
    if (canonical.contact_id) {
      const patch: Record<string, unknown> = {};
      const best = arr.find((c) => c.contact?.client_id);
      if (!canonical.contact?.client_id && best?.contact?.client_id)
        patch.client_id = best.contact.client_id;
      const realPhone = arr
        .map((c) => c.contact?.phone)
        .find((p) => p && normalizeDigits(p).length === 10 && /^55|^\d{12,13}$/.test(p.replace(/\D/g, "")));
      if (realPhone && realPhone !== canonical.contact?.phone)
        patch.phone = realPhone;
      const realName = arr
        .map((c) => c.contact?.push_name || c.contact?.name)
        .find((n) => n && !isPlaceholder(n));
      if (realName && !canonical.contact?.push_name) patch.push_name = realName;
      if (Object.keys(patch).length && !DRY)
        await prisma.whatsappContact.update({
          where: { id: canonical.contact_id },
          data: { ...patch, updated_at: new Date() },
        });
    }

    for (const dup of dups) {
      const dupMsgs = await prisma.whatsappMessage.findMany({
        where: { conversation_id: dup.id },
        select: { id: true, wa_message_id: true },
      });
      for (const m of dupMsgs) {
        const clash = await prisma.whatsappMessage.findFirst({
          where: {
            conversation_id: canonical.id,
            wa_message_id: m.wa_message_id,
          },
          select: { id: true },
        });
        if (clash) {
          if (!DRY) await prisma.whatsappMessage.delete({ where: { id: m.id } });
        } else {
          if (!DRY)
            await prisma.whatsappMessage.update({
              where: { id: m.id },
              data: { conversation_id: canonical.id },
            });
          movedMsgs++;
        }
      }
      if (!DRY)
        await prisma.whatsappConversation.delete({ where: { id: dup.id } });
      deletedConvs++;
    }

    // Recalcula last_message da canônica.
    const last = await prisma.whatsappMessage.findFirst({
      where: { conversation_id: canonical.id },
      orderBy: { timestamp: "desc" },
      select: { body: true, timestamp: true },
    });
    if (last && !DRY) {
      await prisma.whatsappConversation.update({
        where: { id: canonical.id },
        data: {
          last_message: (last.body ?? "[mídia]").slice(0, 200),
          last_message_at: last.timestamp,
        },
      });
    }
    mergedGroups++;
    console.log(
      `merge: ${canonical.contact?.push_name ?? canonical.wa_chat_id} <- ${dups.length} dup(s)`,
    );
  }

  // Passada final: garante que TODA conversa individual tenha contato resolvido
  // (nome + telefone real) extraído das próprias mensagens (SenderAlt/PushName).
  const finalConvs = await prisma.whatsappConversation.findMany({
    where: { type: "individual" },
    select: {
      id: true,
      company_id: true,
      session_id: true,
      wa_chat_id: true,
      contact_id: true,
    },
  });
  let resolved = 0;
  for (const c of finalConvs) {
    const msgs = await prisma.whatsappMessage.findMany({
      where: { conversation_id: c.id },
      orderBy: { timestamp: "desc" },
      take: 60,
      select: { raw_data: true, direction: true },
    });
    let realPhone: string | null = null;
    let pushName: string | null = null;
    for (const m of msgs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = (m.raw_data as any)?._data?.Info;
      if (!info) continue;
      if (!realPhone) {
        const alt =
          m.direction === "outbound" ? info.RecipientAlt : info.SenderAlt;
        const p = realPhoneFromAltJid(alt);
        if (p) realPhone = p;
      }
      if (
        !pushName &&
        m.direction === "inbound" &&
        typeof info.PushName === "string" &&
        info.PushName.trim() &&
        !isPlaceholder(info.PushName)
      )
        pushName = info.PushName.trim();
      if (realPhone && pushName) break;
    }

    if (c.contact_id) {
      const existing = await prisma.whatsappContact.findUnique({
        where: { id: c.contact_id },
        select: { phone: true, push_name: true },
      });
      const patch: Record<string, unknown> = {};
      if (realPhone && realPhone !== existing?.phone) patch.phone = realPhone;
      if (pushName && !existing?.push_name) patch.push_name = pushName;
      if (Object.keys(patch).length) {
        if (!DRY)
          await prisma.whatsappContact.update({
            where: { id: c.contact_id },
            data: { ...patch, updated_at: new Date() },
          });
        resolved++;
      }
    } else {
      if (!DRY) {
        const contact = await prisma.whatsappContact.upsert({
          where: {
            session_id_wa_id: { session_id: c.session_id, wa_id: c.wa_chat_id },
          },
          create: {
            id: randomUUID(),
            company_id: c.company_id,
            session_id: c.session_id,
            wa_id: c.wa_chat_id,
            phone:
              realPhone ??
              (c.wa_chat_id.endsWith("@lid")
                ? null
                : c.wa_chat_id.split("@")[0]),
            push_name: pushName,
          },
          update: {
            ...(realPhone ? { phone: realPhone } : {}),
            ...(pushName ? { push_name: pushName } : {}),
          },
        });
        await prisma.whatsappConversation.update({
          where: { id: c.id },
          data: { contact_id: contact.id },
        });
      }
      resolved++;
    }
  }

  console.log(
    `\n${DRY ? "[DRY] " : ""}Grupos mesclados: ${mergedGroups} | conversas removidas: ${deletedConvs} | msgs movidas: ${movedMsgs} | contatos resolvidos: ${resolved}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
