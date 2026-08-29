import { describe, expect, it } from "vitest";

import { authenticateAdmin } from "../src/middlewares/authenticateAdmin";
import invitationsRouter from "../src/routes/invitations";

describe("invitations routes", () => {
  it("protects POST / with authenticateAdmin", () => {
    const postRoute = invitationsRouter.stack.find(
      (layer) => layer.route?.path === "/" && layer.route.methods.post,
    );

    expect(postRoute).toBeDefined();
    expect(postRoute?.route?.stack[0].handle).toBe(authenticateAdmin);
  });

  it("protects PATCH /:id with authenticateAdmin", () => {
    const patchRoute = invitationsRouter.stack.find(
      (layer) => layer.route?.path === "/:id" && layer.route.methods.patch,
    );

    expect(patchRoute).toBeDefined();
    expect(patchRoute?.route?.stack[0].handle).toBe(authenticateAdmin);
  });

  it("protects PATCH /:id/capacity with authenticateAdmin", () => {
    const capacityRoute = invitationsRouter.stack.find(
      (layer) => layer.route?.path === "/:id/capacity" && layer.route.methods.patch,
    );

    expect(capacityRoute).toBeDefined();
    expect(capacityRoute?.route?.stack[0].handle).toBe(authenticateAdmin);
  });

  it("protects replacement restore POST with authenticateAdmin", () => {
    const restoreRoute = invitationsRouter.stack.find(
      (layer) =>
        layer.route?.path === "/:id/guests/:guestIndex/restore-replacement" &&
        layer.route.methods.post,
    );

    expect(restoreRoute).toBeDefined();
    expect(restoreRoute?.route?.stack[0].handle).toBe(authenticateAdmin);
  });

  it.each([
    "/:id/archive",
    "/:id/restore",
  ])("protects POST %s with authenticateAdmin", (path) => {
    const route = invitationsRouter.stack.find(
      (layer) => layer.route?.path === path && layer.route.methods.post,
    );
    expect(route).toBeDefined();
    expect(route?.route?.stack[0].handle).toBe(authenticateAdmin);
  });

  it("does not expose an administrative DELETE route", () => {
    expect(
      invitationsRouter.stack.some((layer) => layer.route?.methods.delete),
    ).toBe(false);
  });
});
