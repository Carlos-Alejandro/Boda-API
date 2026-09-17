const EDIT_PRECONDITION_MESSAGE =
  "La invitación cambió. Recarga los datos antes de corregir el nombre del invitado.";

const RESTORE_PRECONDITION_MESSAGE =
  "La invitación cambió. Recarga los datos antes de restaurar al invitado original.";

const OVERRIDE_PRECONDITION_MESSAGE =
  "La invitación cambió. Recarga los datos antes de modificar el permiso extraordinario.";

const ADDITIONAL_PRECONDITION_MESSAGES = new Set([
  EDIT_PRECONDITION_MESSAGE,
  RESTORE_PRECONDITION_MESSAGE,
  OVERRIDE_PRECONDITION_MESSAGE,
]);

const PUBLIC_HTTP_ERRORS = {
  IDEMPOTENCY_CONFLICT: {
    statusCode: 409,
    message: "Esta clave de idempotencia ya se utilizó con otros datos. Usa la clave original solo para reintentar la misma creación.",
  },
  PRECONDITION_FAILED: {
    statusCode: 412,
    message: "La invitación cambió. Recarga los datos antes de eliminar un invitado.",
  },
  FORBIDDEN: {
    statusCode: 403,
    message: "Acceso denegado",
  },
  INVITATION_NOT_FOUND: {
    statusCode: 404,
    message: "Invitación no encontrada",
  },
} as const;

export type PublicHttpErrorCode = keyof typeof PUBLIC_HTTP_ERRORS;

export interface PublicHttpErrorDefinition {
  statusCode: number;
  code: PublicHttpErrorCode;
  message: string;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: PublicHttpErrorCode,
    message: string,
  ) {
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new RangeError("HttpError statusCode must be an integer from 400 to 599");
    }

    const publicError = PUBLIC_HTTP_ERRORS[code];
    if (
      !publicError ||
      statusCode !== publicError.statusCode ||
      (message !== publicError.message &&
        !(code === "PRECONDITION_FAILED" && ADDITIONAL_PRECONDITION_MESSAGES.has(message)))
    ) {
      throw new TypeError("HttpError must use an approved public error definition");
    }

    super(message);
    this.name = "HttpError";
    Object.freeze(this);
  }
}

export function resolvePublicHttpError(
  error: HttpError,
): PublicHttpErrorDefinition | null {
  const code = error.code;
  if (!Object.hasOwn(PUBLIC_HTTP_ERRORS, code)) return null;
  const definition = PUBLIC_HTTP_ERRORS[code];
  return {
    statusCode: definition.statusCode,
    code,
    message: code === "PRECONDITION_FAILED" && ADDITIONAL_PRECONDITION_MESSAGES.has(error.message)
      ? error.message
      : definition.message,
  };
}
