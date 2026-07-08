import type { Request, Response } from "express";
import { uploadImage, type UploadedFile } from "../services/uploadService.js";

/**
 * POST /api/uploads — multipart single "file" + optional "kind" field.
 * Auth required (owner or logged-in attendant). Returns { url }.
 */
export const uploadImageHandler = async (req: Request, res: Response) => {
  try {
    const file = (req as Request & { file?: UploadedFile }).file;
    if (!file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }
    const kind = String(req.body?.kind ?? req.query?.kind ?? "misc");
    const url = await uploadImage(file, kind);
    return res.status(201).json({ url });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
