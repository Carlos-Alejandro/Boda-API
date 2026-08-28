import app from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
  console.log(`Boda API listening on port ${env.port}`);
});
