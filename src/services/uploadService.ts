import { randomUUID } from "crypto";
import { uploadBuffer, isStorageConfigured } from "../lib/storage.js";

// Accepted image types → file extension used for the stored key.
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Folders inside the bucket, one per feature that uploads an image.
const ALLOWED_KINDS = new Set(["company", "attendant", "service"]);

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Validate and store an uploaded image, returning its public URL.
 * Throws (400-mapped by the controller) on missing config / bad type.
 */
export const uploadImage = async (
  file: UploadedFile,
  kind: string,
): Promise<string> => {
  if (!isStorageConfigured()) {
    throw new Error(
      "Armazenamento de imagens não configurado no servidor.",
    );
  }
  const ext = MIME_EXT[file.mimetype];
  if (!ext) {
    throw new Error("Formato inválido. Envie uma imagem JPG, PNG ou WEBP.");
  }
  const safeKind = ALLOWED_KINDS.has(kind) ? kind : "misc";
  const key = `uploads/${safeKind}/${randomUUID()}.${ext}`;
  return uploadBuffer(key, file.buffer, file.mimetype);
};

// ============================================================
// Anexos do chat WhatsApp (imagem, documento, áudio, vídeo)
// ============================================================

// Tipos aceitos no chat → extensão. Mais amplo que o upload de imagens, mas
// ainda allowlist (nunca application/octet-stream cru) — o arquivo vai parar
// num bucket público e no WhatsApp do cliente.
const CHAT_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
};

export const isChatMediaMime = (mime: string): boolean => {
  // audio/webm;codecs=opus → audio/webm
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return base in CHAT_MIME_EXT;
};

export interface ChatMediaUpload {
  url: string;
  mimetype: string;
  filename: string;
}

/**
 * Guarda um anexo do chat no storage e devolve URL pública + metadados que o
 * worker WAHA usa pra baixar e enviar. Chave em whatsapp-media/{companyId}/out-*
 * (mesma pasta da mídia recebida, prefixo "out-" para diferenciar).
 */
export const uploadChatMedia = async (
  file: UploadedFile & { originalname?: string },
  companyId: string,
): Promise<ChatMediaUpload> => {
  if (!isStorageConfigured()) {
    throw new Error("Armazenamento de arquivos não configurado no servidor.");
  }
  const base = file.mimetype.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = CHAT_MIME_EXT[base];
  if (!ext) {
    throw new Error(
      "Formato não suportado. Envie imagem, PDF, documento, áudio ou vídeo MP4.",
    );
  }
  const key = `whatsapp-media/${companyId}/out-${randomUUID()}.${ext}`;
  const url = await uploadBuffer(key, file.buffer, base);
  // Nome exibido no WhatsApp (documentos): usa o original quando existir.
  const filename =
    (file.originalname || "").trim() || `arquivo.${ext}`;
  return { url, mimetype: base, filename };
};
