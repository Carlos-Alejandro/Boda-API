import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { env } from "./env";

const existingApps = getApps();
if (
  env.useFirebaseEmulators &&
  existingApps.some((app) => app.options.projectId !== "demo-boda")
) {
  throw new Error("An existing Firebase app is not configured for demo-boda");
}

const firebaseApp =
  existingApps[0] ??
  initializeApp({
    ...(env.useFirebaseEmulators ? {} : { credential: applicationDefault() }),
    projectId: env.firebaseProjectId,
  });

export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);