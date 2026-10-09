import app from "./app";
import { env, getListenHost } from "./config/env";

const onListening = () => {
  console.log(`Boda API listening on port ${env.port}`);
};
const host = getListenHost(env.useFirebaseEmulators);

if (host) {
  app.listen(env.port, host, onListening);
} else {
  app.listen(env.port, onListening);
}
