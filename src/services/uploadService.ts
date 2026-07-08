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
