import type { Response } from "express";

export function sendError(
  response: Response,
  statusCode: number,
  code: string,
  message: string,
): void {
  response.status(statusCode).json({ error: { code, message } });
}
