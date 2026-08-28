import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { env } from "./env";

const firebaseApp =
  getApps()[0] ??
  initializeApp({
    credential: applicationDefault(),
    projectId: env.firebaseProjectId,
  });

export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
