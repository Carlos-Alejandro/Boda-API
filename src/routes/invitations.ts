import { Router } from "express";

import {
  removeInvitationGuestController,
  updateInvitationGuestController,
  archiveInvitationController,
  changeInvitationCapacityController,
  createInvitationController,
  getInvitationController,
  listInvitationsController,
  restoreInvitationReplacementController,
  restoreArchivedInvitationController,
  updateInvitationController,
} from "../controllers/invitations.controller";
import { authenticateAdmin } from "../middlewares/authenticateAdmin";

const invitationsRouter = Router();

invitationsRouter.patch(
  "/:id/guests/:guestIndex",
  authenticateAdmin,
  updateInvitationGuestController,
);

invitationsRouter.post(
  "/:id/guests/:guestIndex/remove",
  authenticateAdmin,
  removeInvitationGuestController,
);

invitationsRouter.get("/", authenticateAdmin, listInvitationsController);
invitationsRouter.post("/", authenticateAdmin, createInvitationController);
invitationsRouter.post(
  "/:id/guests/:guestIndex/restore-replacement",
  authenticateAdmin,
  restoreInvitationReplacementController,
);
invitationsRouter.post(
  "/:id/archive",
  authenticateAdmin,
  archiveInvitationController,
);
invitationsRouter.post(
  "/:id/restore",
  authenticateAdmin,
  restoreArchivedInvitationController,
);
invitationsRouter.get("/:id", authenticateAdmin, getInvitationController);
invitationsRouter.patch(
  "/:id/capacity",
  authenticateAdmin,
  changeInvitationCapacityController,
);
invitationsRouter.patch("/:id", authenticateAdmin, updateInvitationController);

export default invitationsRouter;
