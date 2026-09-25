import { Router } from "express";

import { savePublicRsvpController } from "../controllers/publicRsvp.controller";

const publicInvitationsRouter = Router();

publicInvitationsRouter.post("/:id/rsvp", savePublicRsvpController);

export default publicInvitationsRouter;
