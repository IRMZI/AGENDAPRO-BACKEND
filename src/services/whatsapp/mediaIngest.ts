// Ingestão de mídia recebida no WhatsApp: baixa o binário do worker (via
// orchestrator) e guarda no storage durável (R2/S3). A URL que o WAHA manda no
// webhook aponta para o worker (localhost/efêmera) e EXPIRA — sem isto o
// histórico de áudios/imagens quebra. Espelha o proxyMedia/downloadMedia do WB.

import { randomUUID } from "node:crypto";
import { wahaOrchestrator } from "../../lib/wahaOrchestrator.js";
import { isStorageConfigured, uploadBuffer } from "../../lib/storage.js";

// Extensão a partir do mimetype (fallback: do filename; senão .bin).
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/amr": ".amr",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "application/pdf": ".pdf",
};

const extFor = (mime?: string | null, filename?: string | null): string => {
  if (filename && filename.includes(".")) {
    const ext = filename.slice(filename.lastIndexOf("."));
    if (ext.length <= 6) return ext.toLowerCase();
  }
  const base = (mime || "").split(";")[0]?.trim().toLowerCase();
  return EXT_BY_MIME[base] ?? ".bin";
};

export interface IngestedMedia {
  url: string;
  mimeType: string | null;
  filename: string | null;
}

/**
 * Baixa a mídia e guarda no storage. Retorna `null` (o caller mantém a URL
 * provisória do WAHA) quando não há storage configurado ou o download falhou —
 * nunca lança, para não derrubar o processamento da mensagem.
 */
export const ingestMedia = async (params: {
  companyId: string;
  wahaSessionId: string;
  mediaUrl?: string | null;
  messageId: string;
  chatId?: string;
}): Promise<IngestedMedia | null> => {
  if (!isStorageConfigured()) return null;

  let b64: string | null = null;
  let mime: string | null = null;
  let filename: string | null = null;

  try {
    if (params.mediaUrl) {
      // Caminho principal (WB proxyMedia): baixa direto pela URL do worker.
      const r = await wahaOrchestrator.proxyMedia(
        params.wahaSessionId,
        params.mediaUrl,
      );
      b64 = r.data ?? null;
      mime = r.mimetype ?? null;
      filename = r.filename ?? null;
    } else {
      // Fallback (WB downloadMedia): re-busca a mensagem com downloadMedia=true.
      const r = await wahaOrchestrator.downloadMedia(
        params.wahaSessionId,
        params.messageId,
        params.chatId,
      );
      b64 = r.data ?? null;
      mime = r.mimetype ?? null;
      filename = r.filename ?? null;
    }
  } catch {
    return null;
  }

  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return null;

  const key = `whatsapp-media/${params.companyId}/${randomUUID()}${extFor(mime, filename)}`;
  const url = await uploadBuffer(key, buf, mime || "application/octet-stream");
  return { url, mimeType: mime, filename };
};
