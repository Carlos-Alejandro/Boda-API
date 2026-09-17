import { request as httpRequest, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { CreationFirestore } from "./helpers/creationFirestore";

const mocks = vi.hoisted(() => ({ db: undefined as unknown as CreationFirestore, verifyIdToken: vi.fn(), generateId: vi.fn() }));
vi.mock("../src/config/env", () => ({ env: { adminFirebaseUids: ["admin"], corsAllowedOrigins: ["https://admin.example.com"] } }));
vi.mock("../src/config/firebaseAdmin", () => ({
  auth: { verifyIdToken: mocks.verifyIdToken },
  firestore: {
    collection: (name: string) => mocks.db.collection(name),
    runTransaction: (callback: Parameters<CreationFirestore["runTransaction"]>[0]) => mocks.db.runTransaction(callback),
  },
}));
vi.mock("../src/services/invitationId.service", () => ({ generateInvitationId: mocks.generateId }));

import app from "../src/app";
import { INVITATION_CREATION_RECEIPTS, invitationCreationReceiptId, invitationCreationFingerprint } from "../src/services/invitationCreationReceipt.service";
import { createInvitationData } from "../src/services/invitationModel.service";
import { invitationVersion } from "../src/services/invitationVersion.service";

const input = { displayName: "Familia Ruiz", knownGuests: [{ name: "José Ruiz" }], openSlots: 1, replacementsAllowed: false };
let server: Server;
let url: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  url = `http://127.0.0.1:${address.port}/api/admin/invitations`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
  mocks.db = new CreationFirestore();
  mocks.verifyIdToken.mockReset().mockResolvedValue({ uid: "admin" });
  mocks.generateId.mockReset().mockReturnValueOnce("ABCDEFGH").mockReturnValue("BCDEFGHJ");
});
const post = (body: unknown = input, headers: Record<string, string> = { Authorization: "Bearer valid", "Idempotency-Key": "operation-1" }) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

describe("POST invitation optional idempotency HTTP", () => {
  it("keeps manual 201 without header and without receipts", async () => {
    const response = await post({ ...input, displayName: "  Familia Ruiz  ", knownGuests: [{ name: "  José   Ruiz  " }] }, { Authorization: "Bearer valid" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "ABCDEFGH", displayName: "Familia Ruiz", guests: [
      { name: "José Ruiz", shortName: "José", type: "known", attending: null },
      { name: "", shortName: "Acompañante", type: "open", attending: null },
    ] });
    expect(mocks.db.documents.size).toBe(1);
    expect(mocks.db.runTransaction).not.toHaveBeenCalled();
  });
  it("returns 201 then 200 with the same complete invitation and version", async () => {
    const first = await post();
    expect(first.status).toBe(201);
    const invitation = await first.json();
    expect(invitation).toEqual({
      id: "ABCDEFGH", version: invitationVersion("invitations/ABCDEFGH", new Timestamp(1, 0)),
      displayName: "Familia Ruiz", maxGuests: 2, replacementsAllowed: false, rsvpStatus: "pending", message: "",
      isArchived: false, archivedAt: null, editOverrideUntil: null, updatedAt: new Timestamp(1, 0).toDate().toISOString(),
      guests: [{ name: "José Ruiz", shortName: "José", type: "known", attending: null },
        { name: "", shortName: "Acompañante", type: "open", attending: null }],
    });
    const second = await post({ ...input, knownGuests: [{ name: " José   Ruiz " }] });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(invitation);
    expect(mocks.db.committedCreates).toHaveLength(2);
  });
  it("returns safe 409 for same key with different input", async () => {
    await post();
    const response = await post({ ...input, replacementsAllowed: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: {
      code: "IDEMPOTENCY_CONFLICT",
      message: "Esta clave de idempotencia ya se utilizó con otros datos. Usa la clave original solo para reintentar la misma creación.",
    } });
    expect(mocks.db.committedCreates).toHaveLength(2);
  });
  it.each(["", "a".repeat(201), "one,two", "one two", "one/two"])("rejects invalid key %j", async key => {
    const response = await post(input, { Authorization: "Bearer valid", "Idempotency-Key": key });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mocks.db.documents.size).toBe(0);
  });
  it.each([["same", "same"], ["first", "second"]])("rejects duplicate HTTP header lines %j", async (first, second) => {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(url, { method: "POST", headers: {
        Authorization: "Bearer valid", "Content-Type": "application/json", "Idempotency-Key": [first, second],
      } }, res => {
        let body = "";
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      });
      request.on("error", reject);
      request.end(JSON.stringify(input));
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_ERROR");
    expect(mocks.db.documents.size).toBe(0);
  });
  it.each([{}, { openSlots: -1 }, { ...input, guests: [] }])("retains body validation %j", async body => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mocks.db.documents.size).toBe(0);
  });
  it.each(["missing", "invalid", "non-admin"])("protects creation: %s", async reason => {
    if (reason === "invalid") mocks.verifyIdToken.mockRejectedValue(new Error("invalid"));
    if (reason === "non-admin") mocks.verifyIdToken.mockResolvedValue({ uid: "other" });
    const response = await post(input, reason === "missing" ? { "Idempotency-Key": "key" } : undefined);
    expect(response.status).toBe(reason === "non-admin" ? 403 : 401);
    expect((await response.json()).error.code).toBe(reason === "non-admin" ? "FORBIDDEN" : "UNAUTHORIZED");
    expect(mocks.db.documents.size).toBe(0);
  });
  it("returns safe 500 for missing referenced invitation without recreation", async () => {
    mocks.db.put(INVITATION_CREATION_RECEIPTS + "/" + invitationCreationReceiptId("operation-1"), {
      fingerprint: invitationCreationFingerprint(createInvitationData(input)), invitationId: "ABCDEFGH", createdAt: new Timestamp(1, 0),
    });
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
    expect(mocks.db.committedCreates).toHaveLength(0);
  });
  it("recovers via HTTP after commit succeeded but reread failed", async () => {
    mocks.db.onRead = (_path, transactional) => { if (!transactional) throw new Error("private infrastructure details"); };
    const first = await post();
    expect(first.status).toBe(500);
    expect(await first.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
    expect(mocks.db.runTransaction).toHaveBeenCalledOnce();
    mocks.db.onRead = undefined;
    const second = await post();
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe("ABCDEFGH");
    expect(mocks.db.documents.size).toBe(2);
  });
  it("allows Idempotency-Key in an authenticated-origin preflight", async () => {
    const response = await fetch(url, { method: "OPTIONS", headers: {
      Origin: "https://admin.example.com", "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
    } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("idempotency-key");
    expect(mocks.db.documents.size).toBe(0);
  });
});
