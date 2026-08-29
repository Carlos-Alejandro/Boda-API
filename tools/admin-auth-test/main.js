import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDcon-gpJXiWDnwJPfIwuia9Qy2mMep2To",
  authDomain: "boda-america-y-carlos.firebaseapp.com",
  projectId: "boda-america-y-carlos",
  storageBucket: "boda-america-y-carlos.firebasestorage.app",
  messagingSenderId: "1077064926354",
  appId: "1:1077064926354:web:15fdf0bd1ce9b8148a924b",
};

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: inMemoryPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
const provider = new GoogleAuthProvider();

const signInButton = document.querySelector("#sign-in");
const copyTokenButton = document.querySelector("#copy-token");
const userDetails = document.querySelector("#user-details");
const status = document.querySelector("#status");

let currentUser = null;

signInButton.addEventListener("click", async () => {
  signInButton.disabled = true;
  status.textContent = "Abriendo inicio de sesión…";

  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    document.querySelector("#name").textContent = currentUser.displayName ?? "";
    document.querySelector("#email").textContent = currentUser.email ?? "";
    document.querySelector("#uid").textContent = currentUser.uid;
    userDetails.hidden = false;
    copyTokenButton.disabled = false;
    status.textContent = "Sesión iniciada. El token aún no se ha solicitado.";
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "unknown";
    status.textContent = `No se pudo iniciar sesión (${code}).`;
    signInButton.disabled = false;
  }
});

copyTokenButton.addEventListener("click", async () => {
  if (!currentUser) return;
  copyTokenButton.disabled = true;
  status.textContent = "Obteniendo token…";

  try {
    const idToken = await currentUser.getIdToken();
    await navigator.clipboard.writeText(idToken);
    status.textContent = "ID Token copiado temporalmente al portapapeles.";
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "clipboard-error";
    status.textContent = `No se pudo copiar el token (${code}).`;
  } finally {
    copyTokenButton.disabled = false;
  }
});
