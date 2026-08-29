import { Router } from "express";

import {
  getInvitationController,
  listInvitationsController,
} from "../controllers/invitations.controller";
import { authenticateAdmin } from "../middlewares/authenticateAdmin";

const invitationsRouter = Router();

invitationsRouter.get("/", authenticateAdmin, listInvitationsController);
invitationsRouter.get("/:id", authenticateAdmin, getInvitationController);

export default invitationsRouter;
