const PUBLIC_HTTP_ERRORS = {
  PRECONDITION_FAILED: {
    statusCode: 412,
    message: "Invitation has changed; reload before removing a guest",
  },
  FORBIDDEN: {
    statusCode: 403,
    message: "Forbidden",
  },
  INVITATION_NOT_FOUND: {
    statusCode: 404,
    message: "Invitation not found",
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
      message !== publicError.message
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
    message: definition.message,
  };
}
