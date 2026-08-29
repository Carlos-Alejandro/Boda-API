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
});
