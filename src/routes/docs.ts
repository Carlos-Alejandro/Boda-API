import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import { openApiDocument } from "../openapi";

const docsRouter = Router();

docsRouter.get("/openapi.json", (_request, response) => {
  response.status(200).json(openApiDocument);
});
docsRouter.get("/docs", swaggerUi.setup(openApiDocument));
docsRouter.use("/docs", swaggerUi.serve);

export default docsRouter;
