import { Router } from "express";

import {
  changeInvitationCapacityController,
  createInvitationController,
  getInvitationController,
  listInvitationsController,
  restoreInvitationReplacementController,
  updateInvitationController,
} from "../controllers/invitations.controller";
import { authenticateAdmin } from "../middlewares/authenticateAdmin";

const invitationsRouter = Router();

invitationsRouter.get("/", authenticateAdmin, listInvitationsController);
invitationsRouter.post("/", authenticateAdmin, createInvitationController);
invitationsRouter.post(
  "/:id/guests/:guestIndex/restore-replacement",
  authenticateAdmin,
  restoreInvitationReplacementController,
);
invitationsRouter.get("/:id", authenticateAdmin, getInvitationController);
invitationsRouter.patch(
  "/:id/capacity",
  authenticateAdmin,
  changeInvitationCapacityController,
);
invitationsRouter.patch("/:id", authenticateAdmin, updateInvitationController);

export default invitationsRouter;
