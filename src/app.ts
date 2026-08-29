import express from "express";

import apiRoutes from "./routes";
import { errorHandler, routeNotFound } from "./middlewares/errorHandler";

const app = express();

app.use(express.json());
app.use("/api", apiRoutes);
app.use(routeNotFound);
app.use(errorHandler);

export default app;
