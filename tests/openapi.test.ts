import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openApiDocument } from "../src/openapi";
import docsRouter from "../src/routes/docs";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/api", docsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

describe("OpenAPI documentation", () => {
  it("serves Swagger UI at /api/docs", async () => {
    const response = await fetch(`${baseUrl}/api/docs`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Swagger UI");
  });

  it("serves the OpenAPI document as JSON", async () => {
    const response = await fetch(`${baseUrl}/api/openapi.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ openapi: "3.0.3" });
  });

  it("documents exactly every current business endpoint", () => {
    expect(Object.keys(openApiDocument.paths).sort()).toEqual(
      [
        "/api/health",
        "/api/admin/health",
        "/api/admin/invitations",
        "/api/admin/invitations/{id}",
        "/api/admin/invitations/{id}/capacity",
        "/api/admin/invitations/{id}/guests/{guestIndex}/restore-replacement",
        "/api/admin/invitations/{id}/guests/{guestIndex}/remove",
        "/api/admin/invitations/{id}/guests/{guestIndex}",
        "/api/admin/invitations/{id}/archive",
        "/api/admin/invitations/{id}/restore",
      ].sort(),
    );
  });

  it("does not document an invitation DELETE operation", () => {
    expect(JSON.stringify(openApiDocument.paths)).not.toContain('"delete"');
  });

  it("secures every admin operation and leaves public health unsecured", () => {
    for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (path.startsWith("/api/admin/")) {
          expect(operation).toMatchObject({
            security: [{ firebaseBearer: [] }],
          });
        }
      }
    }
    expect(openApiDocument.paths["/api/health"].get).not.toHaveProperty(
      "security",
    );
  });

  it("defines the Firebase bearer scheme", () => {
    expect(openApiDocument.components.securitySchemes.firebaseBearer).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Se requiere un Firebase ID Token válido en el encabezado Authorization: Bearer <token>",
    });
  });

  it("documents every real Invitation and Guest field", () => {
    expect(
      Object.keys(openApiDocument.components.schemas.Invitation.properties),
    ).toEqual(
      expect.arrayContaining([
        "id",
        "displayName",
        "maxGuests",
        "replacementsAllowed",
        "rsvpStatus",
        "message",
        "isArchived",
        "archivedAt",
        "updatedAt",
        "editOverrideUntil",
        "guests",
      ]),
    );
    expect(openApiDocument.components.schemas.Guest.properties.type.enum).toEqual([
      "known",
      "open",
      "replacement",
    ]);
    expect(openApiDocument.components.schemas.Guest.properties).toHaveProperty(
      "originalName",
    );
  });

  it("documents HTTP dates as nullable ISO date-time strings", () => {
    const properties = openApiDocument.components.schemas.Invitation.properties;
    for (const field of ["updatedAt", "editOverrideUntil", "archivedAt"] as const) {
      expect(properties[field]).toMatchObject({
        type: "string",
        format: "date-time",
        nullable: true,
      });
    }
  });

  it("documents list filters and their exact enum values", () => {
    const parameters = openApiDocument.paths["/api/admin/invitations"].get.parameters;
    expect(parameters.map(({ name }) => name)).toEqual([
      "search",
      "rsvpStatus",
      "archived",
    ]);
    expect(parameters[1].schema).toMatchObject({
      enum: ["pending", "confirmed", "partial", "declined"],
    });
    expect(parameters[2].schema).toMatchObject({ type: "boolean" });
  });

  it("documents only client-controlled creation fields", () => {
    expect(
      Object.keys(
        openApiDocument.components.schemas.CreateInvitationInput.properties,
      ).sort(),
    ).toEqual(
      ["displayName", "knownGuests", "openSlots", "replacementsAllowed"].sort(),
    );
    expect(
      openApiDocument.components.schemas.CreateInvitationInput.description,
    ).toContain("knownGuests.length + openSlots");
    expect(
      openApiDocument.components.schemas.CreateInvitationInput.description,
    ).toContain("mayor o igual a 1");
  });

  it("documents public health CORS rejection without requiring bearer auth", () => {
    const health = openApiDocument.paths["/api/health"].get;
    expect(health.responses["403"]).toMatchObject({
      description: "Origen no permitido por la política global de CORS",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorResponse" },
        },
      },
    });
    expect(health).not.toHaveProperty("security");
  });

  it("documents only editable general PATCH fields", () => {
    expect(
      Object.keys(
        openApiDocument.components.schemas.UpdateInvitationInput.properties,
      ).sort(),
    ).toEqual(
      ["displayName", "replacementsAllowed", "editOverrideUntil"].sort(),
    );
  });

  it("documents optional creation idempotency without adding endpoints", () => {
    const operation = openApiDocument.paths["/api/admin/invitations"].post;
    expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", in: "header", required: false }));
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "201", "400", "401", "403", "409", "500"]);
    expect(operation.description).toContain("sin recreación");
    expect(operation.description).toContain("orden de knownGuests importa");
  });

  it("documents conditional version and extraordinary permission on the existing PATCH", () => {
    const operation = openApiDocument.paths["/api/admin/invitations/{id}"].patch;
    const header = operation.parameters.find(parameter => parameter.name === "X-Invitation-Version");
    expect(header).toMatchObject({ in: "header", required: false });
    expect(header?.description).toContain("Obligatorio únicamente cuando el body incluye editOverrideUntil");
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "401", "403", "404", "412", "500"]);
    expect(operation.description).toContain("null revoca");
    expect(operation.description).toContain("archivadas");
    expect(operation.description).toContain("futura");
    expect(openApiDocument.components.schemas.UpdateInvitationInput.properties.editOverrideUntil).toMatchObject({ type: "string", format: "date-time", nullable: true });
  });

  it("does not define request bodies for archive or restore", () => {
    expect(
      openApiDocument.paths["/api/admin/invitations/{id}/archive"].post,
    ).not.toHaveProperty("requestBody");
    expect(
      openApiDocument.paths["/api/admin/invitations/{id}/restore"].post,
    ).not.toHaveProperty("requestBody");
  });

  it("documents the uniform error body and current stable codes", () => {
    const schema = openApiDocument.components.schemas.ErrorResponse;
    expect(schema.properties.error.properties.code.enum).toEqual([
      "VALIDATION_ERROR",
      "PRECONDITION_FAILED",
      "IDEMPOTENCY_CONFLICT",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "INVITATION_NOT_FOUND",
      "NOT_FOUND",
      "INTERNAL_ERROR",
    ]);
    expect(schema.properties.error.required).toEqual(["code", "message"]);
  });

  it("contains no credentials, UIDs or literal bearer tokens", () => {
    const serialized = JSON.stringify(openApiDocument);
    expect(serialized).not.toMatch(/private[_ -]?key/i);
    expect(serialized).not.toMatch(/adminFirebaseUids/i);
    expect(serialized).not.toMatch(/Bearer eyJ/i);
  });
});


it("documents remove and read-only version without request body", () => {
  const operation = openApiDocument.paths["/api/admin/invitations/{id}/guests/{guestIndex}/remove"].post;
  expect(operation.security).toEqual([{ firebaseBearer: [] }]);
  expect(operation).not.toHaveProperty("requestBody");
  expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "X-Invitation-Version", in: "header", required: true }));
  expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "401", "403", "404", "412", "500"]);
  expect(openApiDocument.components.schemas.Invitation.properties.version).toMatchObject({ type: "string", readOnly: true });
  expect(openApiDocument.components.schemas.Invitation.required).toContain("version");
});

it("documents restore-replacement with the same required version header as remove", () => {
  const restore = openApiDocument.paths["/api/admin/invitations/{id}/guests/{guestIndex}/restore-replacement"].post;
  const remove = openApiDocument.paths["/api/admin/invitations/{id}/guests/{guestIndex}/remove"].post;
  expect(restore.parameters.find(parameter => parameter.name === "X-Invitation-Version")).toEqual(remove.parameters.find(parameter => parameter.name === "X-Invitation-Version"));
  expect(restore).not.toHaveProperty("requestBody");
  expect(Object.keys(restore.responses).sort()).toEqual(["200", "400", "401", "403", "404", "412", "500"]);
  expect(restore.responses["412"].description).toBe("PRECONDITION_FAILED: La invitación cambió. Recarga los datos antes de restaurar al invitado original.");
});

it("documents strict guest name editing", () => {
  const operation = openApiDocument.paths["/api/admin/invitations/{id}/guests/{guestIndex}"].patch;
  expect(operation.requestBody.required).toBe(true);
  expect(operation.requestBody.content["application/json"].schema).toMatchObject({ type: "object", additionalProperties: false, required: ["name"] });
  expect(Object.keys(operation.requestBody.content["application/json"].schema.properties)).toEqual(["name"]);
  expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "401", "403", "404", "412", "500"]);
  expect(operation.parameters.find(p => p.name === "X-Invitation-Version")?.required).toBe(true);
});
