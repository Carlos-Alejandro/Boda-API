import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import { openApiDocument } from "../openapi";

const docsRouter = Router();

docsRouter.get("/openapi.json", (_request, response) => {
  response.status(200).json(openApiDocument);
});
docsRouter.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

export default docsRouter;
