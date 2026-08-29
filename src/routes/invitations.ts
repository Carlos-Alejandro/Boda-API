import { Router } from "express";

import {
  createInvitationController,
  getInvitationController,
  listInvitationsController,
  updateInvitationController,
} from "../controllers/invitations.controller";
import { authenticateAdmin } from "../middlewares/authenticateAdmin";

const invitationsRouter = Router();

invitationsRouter.get("/", authenticateAdmin, listInvitationsController);
invitationsRouter.post("/", authenticateAdmin, createInvitationController);
invitationsRouter.get("/:id", authenticateAdmin, getInvitationController);
invitationsRouter.patch("/:id", authenticateAdmin, updateInvitationController);

export default invitationsRouter;
