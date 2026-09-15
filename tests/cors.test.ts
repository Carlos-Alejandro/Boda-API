import express, { type Express } from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { sendError } from "../src/http/errorResponse";
import { createCorsMiddleware } from "../src/middlewares/cors";
import {
  errorHandler,
  routeNotFound,
} from "../src/middlewares/errorHandler";

const servers: Server[] = [];

function makeApp(origins: readonly string[]): Express {
  const app = express();
  app.use(createCorsMiddleware(origins));
  app.use(express.json());
  app.get("/api/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "boda-api" });
  });
  app.get("/api/admin/invitations", (_request, response) => {
    sendError(response, 401, "UNAUTHORIZED", "Se requiere autenticación");
  });
  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}

async function request(
  app: Express,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe("CORS", () => {
  const firstOrigin = "http://localhost:5173";
  const secondOrigin = "https://admin.example.com";

  it.each([firstOrigin, secondOrigin])(
    "authorizes configured origin %s exactly",
    async (origin) => {
      const response = await request(
        makeApp([firstOrigin, secondOrigin]),
        "/api/health",
        { headers: { Origin: origin } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    },
  );

  it("rejects an unconfigured origin without authorization headers", async () => {
    const response = await request(makeApp([firstOrigin]), "/api/health", {
      headers: { Origin: "https://evil.example.com" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Acceso denegado" },
    });
  });

  it("allows requests without Origin even with an empty allowlist", async () => {
    const response = await request(makeApp([]), "/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "boda-api",
    });
  });

  it("handles an allowed preflight", async () => {
    const response = await request(
      makeApp([firstOrigin]),
      "/api/admin/invitations",
      {
        method: "OPTIONS",
        headers: {
          Origin: firstOrigin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(firstOrigin);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
  });

  it("rejects an unconfigured preflight", async () => {
    const response = await request(
      makeApp([firstOrigin]),
      "/api/admin/invitations",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example.com",
          "Access-Control-Request-Method": "GET",
        },
      },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not treat an allowed origin as authentication", async () => {
    const response = await request(
      makeApp([firstOrigin]),
      "/api/admin/invitations",
      { headers: { Origin: firstOrigin } },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(firstOrigin);
  });
});
