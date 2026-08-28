import { Router } from "express";

import adminRouter from "./admin";

const router = Router();

router.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "boda-api",
  });
});

router.use("/admin", adminRouter);

export default router;
