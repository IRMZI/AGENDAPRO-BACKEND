import type { Request, Response } from "express";
import { sendEmail } from "../services/emailService.js";

export const sendEmailHandler = async (req: Request, res: Response) => {
  try {
    const { to, subject, type, data } = req.body || {};

    if (!to || !subject || !type) {
      return res.status(400).json({
        error: "Missing required fields: to, subject, type",
      });
    }

    const result = await sendEmail({ to, subject, type, data });

    return res.status(200).json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to send email",
      details: error.message,
    });
  }
};
