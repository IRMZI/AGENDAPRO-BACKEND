import { prisma } from "../lib/prisma.js";
import { BookingStatus } from "@prisma/client";
import {
  createBooking,
  getBookingsByDateRange,
  getAvailableTimeSlots,
  updateBooking,
  updateBookingStatus,
} from "./bookingService.js";
import { getClientsByCompanyId, upsertClient } from "./clientService.js";
import { getServicesByCompanyId, createService } from "./serviceService.js";
import {
  getAttendantsByCompanyId,
  createAttendant,
  updateAttendant,
} from "./attendantService.js";
import { createTransaction, listTransactions } from "./financialService.js";

/* ════════════════════════════════════════════════════════════════
   AI AGENT (Groq) — tool-calling assistant for AgendaPro.

   A small agent loop: we send the conversation + a catalogue of
   "tools" (functions) to Groq's OpenAI-compatible endpoint. When the
   model asks to call a tool we execute it server-side — ALWAYS scoped
   to the caller's company_id (never trusted from the model) — feed the
   result back, and loop until the model produces a final text reply.

   Adding a new capability = add one entry to TOOLS + one case in
   runTool(). Nothing else changes.
   ════════════════════════════════════════════════════════════════ */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const TZ = "America/Sao_Paulo";
const MAX_TOOL_ROUNDS = 6;

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ToolContext = { companyId: string };

/* ─────────────────────────────────────────────────────────────
   Tool catalogue (OpenAI function-calling schema).
   ───────────────────────────────────────────────────────────── */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description:
        "Retorna a data/hora atuais no fuso America/Sao_Paulo. Use SEMPRE antes de interpretar referências relativas como 'hoje', 'amanhã', 'sexta', 'semana que vem'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_services",
      description:
        "Lista os serviços da empresa (id, nome, duração em minutos, preço). Use para descobrir o service_id de um serviço pelo nome.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_attendants",
      description:
        "Lista os profissionais/atendentes ativos da empresa (id, nome). Use para descobrir o attendant_id.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "find_clients",
      description:
        "Busca clientes da empresa por parte do nome ou telefone. Retorna id, nome, telefone e email.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Parte do nome OU do telefone do cliente.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_client",
      description:
        "Cria um cliente (ou atualiza, se o telefone já existir). Use quando o cliente ainda não estiver cadastrado.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string", description: "Telefone com DDD." },
          email: { type: "string" },
        },
        required: ["name", "phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Lista os horários livres de um atendente, numa data, para um serviço. Use antes de marcar para evitar conflito.",
      parameters: {
        type: "object",
        properties: {
          attendant_id: { type: "string" },
          date: { type: "string", description: "Formato YYYY-MM-DD." },
          service_id: { type: "string" },
        },
        required: ["attendant_id", "date", "service_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_bookings",
      description:
        "Lista os agendamentos da empresa entre duas datas (inclusive). Use para responder 'o que tenho amanhã', 'agenda da semana' etc.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["start_date", "end_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "Cria um agendamento. NUNCA chame sem antes ter confirmado com o usuário: cliente, serviço, data, hora e (se houver) profissional. Datas YYYY-MM-DD, hora HH:MM (24h).",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Id do cliente, se já existir (use find_clients).",
          },
          client_name: { type: "string" },
          client_phone: { type: "string", description: "Telefone com DDD." },
          client_email: { type: "string" },
          service_id: {
            type: "string",
            description: "Id do serviço (use list_services).",
          },
          service_name: {
            type: "string",
            description: "Nome do serviço, caso o id não seja conhecido.",
          },
          attendant_id: { type: "string", description: "Opcional." },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM (24h)" },
          notes: { type: "string" },
        },
        required: ["client_name", "client_phone", "service_name", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description:
        "Cancela um agendamento existente. Use list_bookings para obter o booking_id. Confirme com o usuário antes.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          reason: { type: "string", description: "Motivo (opcional)." },
        },
        required: ["booking_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_booking",
      description:
        "Remarca um agendamento (nova data, horário e/ou profissional). Use list_bookings para o booking_id. Data YYYY-MM-DD, hora HH:MM.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          date: { type: "string", description: "Nova data YYYY-MM-DD (opcional)." },
          time: { type: "string", description: "Novo horário HH:MM (opcional)." },
          attendant_id: {
            type: "string",
            description: "Novo profissional (opcional).",
          },
        },
        required: ["booking_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_service",
      description:
        "Cria um serviço no catálogo da empresa. Confirme com o usuário antes.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number", description: "Preço em reais (opcional)." },
          duration_minutes: {
            type: "number",
            description: "Duração em minutos (padrão 30).",
          },
          description: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_transaction",
      description:
        "Lança uma movimentação no financeiro (receita ou despesa). Confirme com o usuário antes.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["income", "expense"],
            description: "'income' = receita/entrada; 'expense' = despesa/saída.",
          },
          amount: { type: "number", description: "Valor em reais (positivo)." },
          description: { type: "string" },
          category: {
            type: "string",
            description: "Categoria livre (ex.: aluguel, produtos, vendas).",
          },
          payment_method: {
            type: "string",
            enum: ["cash", "pix", "credit", "debit", "other"],
            description: "Forma de pagamento (opcional).",
          },
          date: { type: "string", description: "Data YYYY-MM-DD (padrão hoje)." },
        },
        required: ["type", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_transactions",
      description:
        "Lista movimentações financeiras da empresa, opcionalmente por tipo e período.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["income", "expense"] },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_attendant",
      description:
        "Cadastra um profissional/atendente na equipe. Confirme com o usuário antes.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_attendant",
      description:
        "Atualiza um profissional (nome, contato, ativar/desativar, comissão). Use list_attendants para o attendant_id. Confirme antes.",
      parameters: {
        type: "object",
        properties: {
          attendant_id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          is_active: {
            type: "boolean",
            description: "false desativa o profissional.",
          },
          commission_enabled: { type: "boolean" },
          commission_percent: { type: "number", description: "0 a 100." },
        },
        required: ["attendant_id"],
      },
    },
  },
];

/** Verify a booking belongs to the caller's company before mutating it. */
async function assertBookingInCompany(bookingId: string, companyId: string) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { company_id: true },
  });
  if (!b || b.company_id !== companyId) {
    throw new Error("Agendamento não encontrado.");
  }
}

/** Build a unique-ish attendant username from a display name. */
function usernameFromName(name: string): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "atendente";
  return `${base}-${1000 + (Date.now() % 9000)}`;
}

/* ─────────────────────────────────────────────────────────────
   Tool execution — every query is scoped to ctx.companyId.
   ───────────────────────────────────────────────────────────── */
async function runTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<unknown> {
  const { companyId } = ctx;

  switch (name) {
    case "get_current_datetime": {
      const now = new Date();
      const isoDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const time = new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
      }).format(now);
      const weekday = new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ,
        weekday: "long",
      }).format(now);
      return { iso_date: isoDate, time, weekday, timezone: TZ };
    }

    case "list_services": {
      const services = await getServicesByCompanyId(companyId);
      return services
        .filter((s: any) => s.is_active !== false)
        .map((s: any) => ({
          id: s.id,
          name: s.name,
          duration_minutes: s.duration_minutes,
          price: s.price != null ? Number(s.price) : null,
        }));
    }

    case "list_attendants": {
      const attendants = await getAttendantsByCompanyId(companyId);
      return attendants
        .filter((a: any) => a.is_active !== false)
        .map((a: any) => ({ id: a.id, name: a.name }));
    }

    case "find_clients": {
      const q = String(args.query ?? "").trim().toLowerCase();
      const clients = await getClientsByCompanyId(companyId);
      const matches = (q
        ? clients.filter(
            (c: any) =>
              c.name?.toLowerCase().includes(q) ||
              c.phone?.toLowerCase().includes(q),
          )
        : clients
      ).slice(0, 10);
      return matches.map((c: any) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
      }));
    }

    case "create_client": {
      if (!args.name || !args.phone) {
        return { error: "Nome e telefone são obrigatórios." };
      }
      const client = await upsertClient({
        company_id: companyId,
        name: args.name,
        phone: String(args.phone),
        email: args.email || null,
      });
      return { id: client.id, name: client.name, phone: client.phone };
    }

    case "check_availability": {
      if (!args.attendant_id || !args.date || !args.service_id) {
        return { error: "attendant_id, date e service_id são obrigatórios." };
      }
      const slots = await getAvailableTimeSlots(
        companyId,
        args.attendant_id,
        args.date,
        args.service_id,
      );
      return { date: args.date, available_times: slots };
    }

    case "list_bookings": {
      if (!args.start_date || !args.end_date) {
        return { error: "start_date e end_date são obrigatórios." };
      }
      const bookings = await getBookingsByDateRange(
        companyId,
        args.start_date,
        args.end_date,
      );
      return bookings.map((b: any) => ({
        id: b.id,
        date: b.booking_date?.toISOString?.().slice(0, 10) ?? b.booking_date,
        time: b.booking_time,
        client: b.client_name,
        service: b.service,
        attendant: b.attendant?.name ?? null,
        status: b.status,
      }));
    }

    case "create_booking": {
      const required = ["client_name", "client_phone", "date", "time"];
      const missing = required.filter((k) => !args[k]);
      if (missing.length) {
        return { error: `Faltam campos: ${missing.join(", ")}` };
      }

      // Resolve the service: prefer an explicit id, else match by name.
      let serviceId: string | null = args.service_id || null;
      let serviceName: string = args.service_name || "";
      const services = await getServicesByCompanyId(companyId);
      if (serviceId) {
        const svc = services.find((s: any) => s.id === serviceId);
        serviceName = svc?.name ?? serviceName;
      } else if (serviceName) {
        const svc = services.find(
          (s: any) =>
            s.name?.toLowerCase() === serviceName.toLowerCase() ||
            s.name?.toLowerCase().includes(serviceName.toLowerCase()),
        );
        if (svc) {
          serviceId = svc.id;
          serviceName = svc.name;
        }
      }

      const created = await createBooking({
        company_id: companyId,
        client_id: args.client_id || null,
        client_name: args.client_name,
        client_phone: String(args.client_phone),
        client_email: args.client_email || "",
        service: serviceName,
        service_id: serviceId,
        attendant_id: args.attendant_id || null,
        booking_date: args.date,
        booking_time: args.time,
        notes: args.notes || null,
      });

      return {
        ok: true,
        booking_id: created.id,
        summary: `${serviceName || "Agendamento"} para ${args.client_name} em ${args.date} às ${args.time}.`,
      };
    }

    case "cancel_booking": {
      if (!args.booking_id) return { error: "booking_id é obrigatório." };
      await assertBookingInCompany(args.booking_id, companyId);
      await updateBookingStatus(
        args.booking_id,
        BookingStatus.cancelled,
        args.reason || undefined,
      );
      return { ok: true, booking_id: args.booking_id, status: "cancelled" };
    }

    case "reschedule_booking": {
      if (!args.booking_id) return { error: "booking_id é obrigatório." };
      if (!args.date && !args.time && !args.attendant_id) {
        return { error: "Informe nova data, horário e/ou profissional." };
      }
      await assertBookingInCompany(args.booking_id, companyId);
      const patch: Record<string, unknown> = {};
      if (args.date) patch.booking_date = args.date;
      if (args.time) patch.booking_time = args.time;
      if (args.attendant_id !== undefined)
        patch.attendant_id = args.attendant_id || null;
      await updateBooking(args.booking_id, patch);
      return {
        ok: true,
        booking_id: args.booking_id,
        date: args.date ?? null,
        time: args.time ?? null,
      };
    }

    case "create_service": {
      if (!args.name) return { error: "name é obrigatório." };
      const svc = await createService({
        company_id: companyId,
        name: args.name,
        description: args.description || null,
        duration_minutes: args.duration_minutes
          ? Number(args.duration_minutes)
          : 30,
        price: args.price != null ? Number(args.price) : null,
      });
      return { ok: true, id: svc.id, name: svc.name };
    }

    case "create_transaction": {
      if (args.type !== "income" && args.type !== "expense") {
        return {
          error: "type deve ser 'income' (receita) ou 'expense' (despesa).",
        };
      }
      if (args.amount == null) return { error: "amount é obrigatório." };
      const tx = await createTransaction(companyId, {
        type: args.type,
        category: args.category || undefined,
        description: args.description || undefined,
        amount: Number(args.amount),
        payment_method: args.payment_method || undefined,
        occurred_at: args.date || undefined,
      });
      return { ok: true, id: tx.id, type: tx.type, amount: Number(tx.amount) };
    }

    case "list_transactions": {
      const items = await listTransactions(companyId, {
        type: args.type,
        start: args.start_date,
        end: args.end_date,
      });
      return items.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        category: t.category,
        description: t.description,
        date: t.occurred_at?.toISOString?.().slice(0, 10) ?? null,
      }));
    }

    case "create_attendant": {
      if (!args.name) return { error: "name é obrigatório." };
      const att = await createAttendant({
        company_id: companyId,
        name: args.name,
        username: usernameFromName(args.name),
        email: args.email || null,
        phone: args.phone || null,
      });
      return { ok: true, id: att.id, name: att.name, username: att.username };
    }

    case "update_attendant": {
      if (!args.attendant_id) {
        return { error: "attendant_id é obrigatório (use list_attendants)." };
      }
      const att = await prisma.attendant.findUnique({
        where: { id: args.attendant_id },
        select: { company_id: true },
      });
      if (!att || att.company_id !== companyId) {
        return { error: "Profissional não encontrado." };
      }
      const updated = await updateAttendant(args.attendant_id, {
        name: args.name,
        email: args.email,
        phone: args.phone,
        is_active: args.is_active,
        commission_enabled: args.commission_enabled,
        commission_percent: args.commission_percent,
      });
      return { ok: true, id: updated.id, name: updated.name };
    }

    default:
      return { error: `Ferramenta desconhecida: ${name}` };
  }
}

/* ─────────────────────────────────────────────────────────────
   System prompt.
   ───────────────────────────────────────────────────────────── */
function systemPrompt(): string {
  return [
    "Você é a assistente de IA da plataforma de agendamentos do negócio.",
    "Você ajuda o dono do negócio a operar a plataforma por comandos em linguagem natural.",
    "",
    "Você pode: criar/cancelar/remarcar agendamentos, cadastrar e buscar clientes,",
    "criar serviços, lançar receitas e despesas no financeiro, e gerenciar a equipe",
    "(cadastrar profissional, ativar/desativar, configurar comissão).",
    "",
    "Regras:",
    "- Responda SEMPRE em português do Brasil, de forma breve e objetiva.",
    "- Use as ferramentas para ler dados e executar ações — nunca invente ids, nomes, preços ou horários.",
    "- Para datas relativas ('hoje', 'amanhã', 'sexta'), chame get_current_datetime primeiro.",
    "- Faça perguntas de esclarecimento até ter TODOS os dados necessários antes de agir.",
    "- Para criar um agendamento você precisa de: cliente (nome + telefone), serviço, data e horário. O profissional é opcional.",
    "- Se o cliente não existir (find_clients vazio), pergunte o telefone e cadastre com create_client.",
    "- Para cancelar/remarcar, primeiro encontre o agendamento com list_bookings e confirme qual é.",
    "- ANTES de QUALQUER ação que cria, altera, cancela ou lança algo (agendamento, serviço, financeiro, equipe),",
    "  mostre um resumo claro dos dados e só execute a ferramenta após a confirmação explícita ('sim') do usuário.",
    "- Se uma ferramenta retornar erro, explique o problema em linguagem simples e sugira o próximo passo.",
  ].join("\n");
}

/* ─────────────────────────────────────────────────────────────
   Agent loop.
   ───────────────────────────────────────────────────────────── */
export async function runAiAgent(opts: {
  companyId: string;
  messages: ChatMessage[];
}): Promise<{ reply: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY não configurada no servidor. Adicione a chave no .env do Backend.",
    );
  }

  const convo: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...opts.messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: convo,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Groq API ${res.status}: ${text.slice(0, 400)}`);
    }

    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error("Resposta inválida da IA.");

    convo.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    const toolCalls: ToolCall[] | undefined = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return { reply: msg.content ?? "" };
    }

    for (const call of toolCalls) {
      let result: unknown;
      try {
        const args = call.function.arguments
          ? JSON.parse(call.function.arguments)
          : {};
        result = await runTool(call.function.name, args, {
          companyId: opts.companyId,
        });
      } catch (e: any) {
        result = { error: e?.message || String(e) };
      }
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    reply:
      "Não consegui concluir em poucos passos. Pode reformular ou dividir o pedido?",
  };
}
