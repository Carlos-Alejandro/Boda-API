import { Router } from "express";

import adminRouter from "./admin";
import docsRouter from "./docs";

const router = Router();

router.use(docsRouter);

router.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "boda-api",
  });
});

router.use("/admin", adminRouter);

export default router;
