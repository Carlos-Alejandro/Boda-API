import { Router } from "express";

import { authenticateAdmin } from "../middlewares/authenticateAdmin";
import invitationsRouter from "./invitations";

const adminRouter = Router();

adminRouter.get("/health", authenticateAdmin, (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "boda-api",
    authenticated: true,
  });
});

adminRouter.use("/invitations", invitationsRouter);

export default adminRouter;
