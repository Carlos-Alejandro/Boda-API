import { Router } from "express";

import adminRouter from "./admin";
import docsRouter from "./docs";
import publicInvitationsRouter from "./publicInvitations";

const router = Router();

router.use(docsRouter);

router.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "boda-api",
  });
});

router.use("/public/invitations", publicInvitationsRouter);

router.use("/admin", adminRouter);

export default router;
