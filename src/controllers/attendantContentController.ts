import type { Request, Response } from "express";
import {
  createAttendantBanner,
  createAttendantLink,
  deleteAttendantBanner,
  deleteAttendantLink,
  getAttendantBanner,
  getAttendantLink,
  getAttendantLinks,
  updateAttendantBanner,
  updateAttendantLink,
  upsertAttendantBanner,
  upsertAttendantLink,
} from "../services/attendantContentService.js";

export const getAttendantLinksHandler = async (req: Request, res: Response) => {
  try {
    const { attendantId } = req.params;
    const result = await getAttendantLinks(attendantId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getAttendantLinkHandler = async (req: Request, res: Response) => {
  try {
    const { attendantId } = req.params;
    const result = await getAttendantLink(attendantId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createAttendantLinkHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await createAttendantLink(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateAttendantLinkHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { linkId } = req.params;
    const result = await updateAttendantLink(linkId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const deleteAttendantLinkHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { linkId } = req.params;
    const result = await deleteAttendantLink(linkId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const upsertAttendantLinkHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await upsertAttendantLink(req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getAttendantBannerHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { attendantId } = req.params;
    const result = await getAttendantBanner(attendantId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createAttendantBannerHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await createAttendantBanner(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateAttendantBannerHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { bannerId } = req.params;
    const result = await updateAttendantBanner(bannerId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const deleteAttendantBannerHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { bannerId } = req.params;
    const result = await deleteAttendantBanner(bannerId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const upsertAttendantBannerHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await upsertAttendantBanner(req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
