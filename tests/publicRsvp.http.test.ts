import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ savePublicRsvp: vi.fn() }));

vi.mock("../src/config/env", () => ({
  env: {
    adminFirebaseUids: ["admin"],
    corsAllowedOrigins: ["https://boda.example.com", "https://admin.example.com"],
  },
}));
vi.mock("../src/config/firebaseAdmin", () => ({
  auth: { verifyIdToken: vi.fn() },
  firestore: {},
}));
vi.mock("../src/services/publicRsvp.service", () => ({
  savePublicRsvp: mocks.savePublicRsvp,
}));

import app from "../src/app";
import { HttpError } from "../src/errors/HttpError";

const body = {
  expectedState: "baseline",
  responses: [true, null],
  replacementNames: ["", ""],
  openGuestNames: ["", "Ana López"],
  message: "Gracias",
};

let server: Server;
let url: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  url = `http://127.0.0.1:${address.port}/api/public/invitations/ABC12345/rsvp`;
});

afterAll(() => new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

beforeEach(() => {
  mocks.savePublicRsvp.mockReset().mockResolvedValue({
    id: "ABC12345",
    version: "private-version",
    displayName: "Familia Pérez",
    maxGuests: 2,
    replacementsAllowed: true,
    rsvpStatus: "confirmed",
    message: "Gracias",
    isArchived: false,
    archivedAt: null,
    updatedAt: new Date("2026-09-25T12:00:00.000Z"),
    editOverrideUntil: null,
    guests: [
      { name: "Carlos Pérez", shortName: "Carlos", type: "known", attending: true },
      { name: "Ana López", shortName: "Ana", type: "open", attending: true },
    ],
  });
});

function post(payload: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://boda.example.com", ...headers },
    body: JSON.stringify(payload),
  });
}

describe("POST public RSVP HTTP", () => {
  it("accepts the public request without admin authentication and exposes only the public invitation", async () => {
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(mocks.savePublicRsvp).toHaveBeenCalledWith("ABC12345", body);
    const payload = await response.json();
    expect(payload).toMatchObject({
      id: "ABC12345",
      displayName: "Familia Pérez",
      rsvpStatus: "confirmed",
      updatedAt: "2026-09-25T12:00:00.000Z",
    });
    expect(payload).not.toHaveProperty("version");
    expect(payload).not.toHaveProperty("searchPrefixes");
  });

  it("rejects unexpected administrative fields before calling the service", async () => {
    const response = await post({ ...body, maxGuests: 99 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Campo no permitido: maxGuests" },
    });
    expect(mocks.savePublicRsvp).not.toHaveBeenCalled();
  });

  it("returns the stable public conflict contract", async () => {
    mocks.savePublicRsvp.mockRejectedValueOnce(new HttpError(
      409,
      "RSVP_CONFLICT",
      "La invitación cambió. Actualiza la información antes de volver a guardar.",
    ));
    const response = await post(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "RSVP_CONFLICT",
        message: "La invitación cambió. Actualiza la información antes de volver a guardar.",
      },
    });
  });

  it("rejects bodies above the global JSON limit without leaking parser details", async () => {
    const response = await post({ ...body, message: "x".repeat(110_000) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "El cuerpo de la solicitud es demasiado grande" },
    });
    expect(mocks.savePublicRsvp).not.toHaveBeenCalled();
  });
});
