// Utilitários de telefone (BR). Extraído de whatsappChatService para ser
// compartilhado com o cadastro de trial: o dedup do teste grátis PRECISA usar
// exatamente a mesma chave canônica que o match de conversas do WhatsApp —
// duplicar a regra do 9º dígito faria os dois divergirem silenciosamente.

// Chave canônica p/ COMPARAR telefones — tolerante ao 9º dígito do Brasil.
// Celular BR = 55 + DDD + 9 + 8 díg, mas o WhatsApp guarda muitos números SEM
// o 9 (legado). Então normalizamos: tira o DDI 55, tira o 9 do celular e fica
// com "DDD + 8 dígitos". Assim "51980276600", "555180276600" e "5551980276600"
// viram todos "5180276600" e casam entre si.
export const normalizeDigits = (s: string | null | undefined): string => {
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (!d) return "";
  // Tira o código do país (55) quando claramente é DDI (>= 12 díg).
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  // Celular BR com 9º dígito: DDD(2) + 9 + 8 = 11 díg → remove o 9.
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3);
  return d.slice(-10);
};

// DDDs em uso no Brasil (Anatel). Usado só para rejeitar lixo óbvio no
// cadastro público — o WhatsApp é quem dá a palavra final se o número existe.
const BR_AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Valida um celular brasileiro vindo de formulário público (com ou sem DDI 55,
 * com ou sem o 9º dígito). Exige celular — o trial é entregue por WhatsApp, e
 * fixo não recebe. Aceita o legado de 8 dígitos iniciando em 6-9.
 */
export const isValidBrMobile = (raw: string | null | undefined): boolean => {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return false;
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return false;
  if (!BR_AREA_CODES.has(Number(d.slice(0, 2)))) return false;
  const subscriber = d.slice(2);
  // 11 díg: precisa ser celular (9 + 8 díg). 10 díg: legado, começa em 6-9.
  if (subscriber.length === 9) return subscriber[0] === "9";
  return /^[6-9]/.test(subscriber);
};

/**
 * Canonicaliza um telefone para ARMAZENAR (par do `normalizeDigits`, que é a
 * chave de COMPARAÇÃO). Portado do WB (`formatBrazilianNumber`): garante o DDI
 * 55 e injeta o 9º dígito em celular BR legado de 8 díg, deixando o número numa
 * forma estável ("55" + DDD + 9 + 8). Assim o telefone salvo no contato não
 * varia entre "5551980276600" e "555180276600", e o LID nunca vira "telefone".
 * Fixo (assinante 2–5) é mantido; internacional/desconhecido é devolvido cru.
 */
export const formatBrazilianNumber = (
  input: string | null | undefined,
): string => {
  if (!input) return "";
  const clean = input.replace(/\D/g, "");
  if (!clean) return "";
  // Só canoniza quem JÁ tem o DDI 55 (idêntico ao WB): número internacional ou
  // sem DDI é devolvido cru — nunca carimba +55 num estrangeiro (ex.: um @c.us
  // americano "14155551234" não pode virar "5514155551234"). Os jids do
  // WhatsApp (@c.us / SenderAlt) sempre trazem o DDI, então o BR cai aqui.
  if (!clean.startsWith("55")) return clean;
  const local = clean.slice(2);
  if (local.length < 10) return clean;
  const ddd = local.slice(0, 2);
  const subs = local.slice(2);
  const fixedLine = /^[2-5]\d{7}$/; // fixo 8 díg (assinante 2–5)
  const oldMobile = /^[6-9]\d{7}$/; // celular antigo 8 díg (6–9)
  const newMobile = /^9\d{8}$/; // celular atual 9 díg
  if (fixedLine.test(subs)) return clean; // fixo: mantém
  if (newMobile.test(subs)) return clean; // já tem o 9: mantém
  if (oldMobile.test(subs)) return `55${ddd}9${subs}`; // injeta o 9º dígito
  return clean;
};
