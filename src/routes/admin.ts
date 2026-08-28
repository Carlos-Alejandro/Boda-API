import { Router } from "express";

import { authenticateAdmin } from "../middlewares/authenticateAdmin";

const adminRouter = Router();

adminRouter.get("/health", authenticateAdmin, (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "boda-api",
    authenticated: true,
  });
});

export default adminRouter;
