const errorResponse = {
  description: "Respuesta de error",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
} as const;

const invitationResponse = {
  description: "Invitación",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Invitation" },
    },
  },
} as const;

const invitationIdParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "ID de invitación",
} as const;

const secured = [{ firebaseBearer: [] }] as const;

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Boda API",
    version: "1.0.0",
    description: "API administrativa para invitaciones de boda.",
  },
  servers: [{ url: "/", description: "Despliegue actual" }],
  tags: [
    { name: "Estado del servicio" },
    { name: "Administración" },
    { name: "Invitaciones" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Estado del servicio"],
        summary: "Consultar el estado público del servicio",
        responses: {
          "200": {
            description: "El servicio funciona correctamente",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublicHealth" },
              },
            },
          },
          "403": {
            ...errorResponse,
            description: "Origen no permitido por la política global de CORS",
          },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/health": {
      get: {
        tags: ["Administración"],
        summary: "Consultar el estado del servicio con autenticación",
        security: secured,
        responses: {
          "200": {
            description: "Estado del servicio con autenticación",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AdminHealth" },
              },
            },
          },
          "401": errorResponse,
          "403": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations": {
      get: {
        tags: ["Invitaciones"],
        summary: "Listar invitaciones",
        description:
          "Los filtros se combinan con AND. La búsqueda encuentra coincidencias parciales en id y displayName, sin distinguir mayúsculas de minúsculas. Si se omite archived, se devuelven invitaciones activas y archivadas; los documentos antiguos sin isArchived se consideran activos.",
        security: secured,
        parameters: [
          {
            name: "search",
            in: "query",
            schema: { type: "string" },
            description: "Coincidencia parcial en id o displayName, sin distinguir mayúsculas de minúsculas.",
          },
          {
            name: "rsvpStatus",
            in: "query",
            schema: {
              type: "string",
              enum: ["pending", "confirmed", "partial", "declined"],
            },
          },
          {
            name: "archived",
            in: "query",
            schema: { type: "boolean" },
            description: "true devuelve invitaciones archivadas; false devuelve las activas, incluidas las de documentos antiguos.",
          },
        ],
        responses: {
          "200": {
            description: "Lista de invitaciones filtrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InvitationList" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "500": errorResponse,
        },
      },
      post: {
        tags: ["Invitaciones"],
        summary: "Crear una invitación",
        description: "Sin Idempotency-Key conserva la creación manual (201). Con una clave nueva crea atómicamente la invitación y un recibo privado (201). Repetir la misma clave con el mismo input normalizado recupera la invitación actual y su versión (200), sin crear otra. El orden de knownGuests importa. Misma clave con otros datos: 409. Los recibos no caducan automáticamente; una referencia ausente o corrupta devuelve 500, sin recreación. Ante respuesta perdida, reintenta con la misma clave y los mismos datos. Las claves distinguen mayúsculas y se comparten entre administradores para esta operación.",
        security: secured,
        parameters: [{
          name: "Idempotency-Key", in: "header", required: false,
          schema: { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9._:-]{1,200}$" },
          description: "Opcional. Un único valor no vacío, de 1 a 200 caracteres ASCII: letras, números, punto, guion, guion bajo o dos puntos. Se almacena su hash, no la clave cruda. Valores duplicados o inválidos devuelven 400.",
        }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateInvitationInput" },
            },
          },
        },
        responses: {
          "201": invitationResponse,
          "200": invitationResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "409": { ...errorResponse, description: "IDEMPOTENCY_CONFLICT: clave reutilizada con datos diferentes." },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}": {
      get: {
        tags: ["Invitaciones"],
        summary: "Obtener una invitación por ID",
        security: secured,
        parameters: [invitationIdParameter],
        responses: {
          "200": invitationResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "500": errorResponse,
        },
      },
      patch: {
        tags: ["Invitaciones"],
        summary: "Actualizar los campos editables de la invitación",
        description: "Cuando el body incluye editOverrideUntil (incluso null), exige un único X-Invitation-Version válido y aplica todos los campos enviados en una transacción. La versión se compara antes de validar el estado actual; si cambió, devuelve 412. No reintentes automáticamente con una versión nueva. Sin editOverrideUntil se conserva el PATCH sin versión obligatoria. La fecha debe ser estrictamente futura según el servidor; null revoca. En archivadas solo se permite revocar el permiso, no concederlo ni modificarlo a una fecha. Devuelve la invitación completa con su nueva versión.",
        security: secured,
        parameters: [
          invitationIdParameter,
          { name: "X-Invitation-Version", in: "header", required: false,
            schema: { type: "string", maxLength: 4096, pattern: "^iv1\\.[A-Za-z0-9_-]+$" },
            description: "Obligatorio únicamente cuando el body incluye editOverrideUntil, incluso si es null o viene junto con otros campos. Debe enviarse una sola vez. Ausente, malformado o duplicado: 400; versión desactualizada: 412." },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateInvitationInput" },
            },
          },
        },
        responses: {
          "200": invitationResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "412": { ...errorResponse, description: "PRECONDITION_FAILED: La invitación cambió. Recarga los datos antes de modificar el permiso extraordinario." },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/capacity": {
      patch: {
        tags: ["Invitaciones"],
        summary: "Cambiar la capacidad de la invitación",
        description:
          "Al aumentar la capacidad se agregan lugares vacíos de tipo open. Al reducirla solo se eliminan lugares de tipo open que se puedan quitar; se devuelve 400 si no es posible hacerlo de forma segura.",
        security: secured,
        parameters: [invitationIdParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChangeCapacityInput" },
            },
          },
        },
        responses: {
          "200": invitationResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/guests/{guestIndex}/restore-replacement": {
      post: {
        tags: ["Invitaciones"],
        summary: "Restaurar al invitado original",
        description: "Restaura al invitado original cuando el lugar seleccionado contiene un invitado de reemplazo válido. Requiere X-Invitation-Version; la versión se compara con la del snapshot leído dentro de la transacción antes de usar el índice. Ante un 412, recarga los datos y confirma de nuevo; nunca reintentes automáticamente con una versión más reciente.",
        security: secured,
        parameters: [
          invitationIdParameter,
          {
            name: "guestIndex",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0 },
          },
          { name: "X-Invitation-Version", in: "header", required: true,
            schema: { type: "string", maxLength: 4096, pattern: "^iv1\\.[A-Za-z0-9_-]+$" },
            description: "Una sola versión opaca de la invitación. Si falta o tiene un formato inválido, se devuelve 400; si no coincide con la versión actual, se devuelve 412." },
        ],
        responses: {
          "200": invitationResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "412": { ...errorResponse, description: "PRECONDITION_FAILED: La invitación cambió. Recarga los datos antes de restaurar al invitado original." },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/guests/{guestIndex}": {
      patch: {
        tags: ["Invitaciones"],
        summary: "Corregir el nombre de un invitado identificado",
        description: "Corrige name en known, open o replacement ya nombrados; rechaza espacios abiertos vacíos. Normaliza espacios y deriva shortName de la primera palabra. Conserva asistencia, originalName, RSVP, capacidad, orden, campos legacy y archivo; admite invitaciones archivadas. Compara la versión dentro de la transacción antes del índice. Ante 412 recarga y confirma de nuevo; nunca reintentes automáticamente con una versión nueva.",
        security: secured,
        parameters: [
          { ...invitationIdParameter, description: "Un ID de documento de un solo segmento; no se permiten barras diagonales. Se admiten IDs antiguos." },
          { name: "guestIndex", in: "path", required: true,
            schema: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            description: "Índice decimal canónico del invitado en el arreglo guests original, sin signos, espacios ni ceros a la izquierda." },
          { name: "X-Invitation-Version", in: "header", required: true,
            schema: { type: "string", maxLength: 4096, pattern: "^iv1\\.[A-Za-z0-9_-]+$" },
            description: "Una sola versión opaca de la invitación. Si falta o tiene un formato inválido, se devuelve 400; si no coincide con la versión actual, se devuelve 412." },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", additionalProperties: false, required: ["name"],
            properties: { name: { type: "string", minLength: 1, description: "Nombre no vacío tras normalizar espacios.", example: "José Carlos Martínez" } },
          } } },
        },
        responses: {
          "200": invitationResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "412": { ...errorResponse, description: "PRECONDITION_FAILED: La invitación cambió. Recarga los datos antes de corregir el nombre del invitado." },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/guests/{guestIndex}/remove": {
      post: {
        tags: ["Invitaciones"],
        summary: "Eliminar un invitado de tipo known u open y reducir la capacidad",
        description: "Elimina la posición seleccionada sin importar el nombre ni la asistencia. No se pueden eliminar invitados de reemplazo. Debe quedar al menos un lugar. Conserva RSVP, replacementsAllowed y el estado de archivo; admite invitaciones archivadas. La versión se comprueba dentro de la transacción antes de usar el índice. Ante un 412, recarga los datos y confirma de nuevo; nunca reintentes automáticamente con una versión más reciente.",
        security: secured,
        parameters: [
          { ...invitationIdParameter, description: "Un ID de documento de un solo segmento; no se permiten barras diagonales. Se admiten IDs antiguos." },
          { name: "guestIndex", in: "path", required: true,
            schema: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            description: "Índice decimal canónico del invitado en el arreglo guests original, sin signos, espacios ni ceros a la izquierda." },
          { name: "X-Invitation-Version", in: "header", required: true,
            schema: { type: "string", maxLength: 4096, pattern: "^iv1\\.[A-Za-z0-9_-]+$" },
            description: "Una sola versión opaca de la invitación. Si falta o tiene un formato inválido, se devuelve 400; si no coincide con la versión actual, se devuelve 412." },
        ],
        responses: {
          "200": invitationResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "412": { ...errorResponse, description: "PRECONDITION_FAILED: La invitación cambió. Recarga los datos antes de eliminar un invitado." },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/archive": {
      post: {
        tags: ["Invitaciones"],
        summary: "Archivar una invitación",
        description: "Archivado lógico idempotente; el documento no se elimina físicamente.",
        security: secured,
        parameters: [invitationIdParameter],
        responses: {
          "200": invitationResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/restore": {
      post: {
        tags: ["Invitaciones"],
        summary: "Restaurar una invitación archivada",
        description: "Restaura una invitación archivada de forma idempotente.",
        security: secured,
        parameters: [invitationIdParameter],
        responses: {
          "200": invitationResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "500": errorResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      firebaseBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Se requiere un Firebase ID Token válido en el encabezado Authorization: Bearer <token>",
      },
    },
    schemas: {
      Guest: {
        type: "object",
        required: ["name", "shortName", "type", "attending"],
        properties: {
          name: { type: "string" },
          shortName: { type: "string" },
          type: { type: "string", enum: ["known", "open", "replacement"] },
          attending: { type: "boolean", nullable: true },
          originalName: {
            type: "string",
            description: "Presente cuando type es replacement; también puede existir en datos antiguos de invitados que no son de reemplazo.",
          },
        },
      },
      Invitation: {
        type: "object",
        required: [
          "id",
          "version",
          "displayName",
          "maxGuests",
          "replacementsAllowed",
          "rsvpStatus",
          "message",
          "isArchived",
          "archivedAt",
          "updatedAt",
          "editOverrideUntil",
          "guests",
        ],
        properties: {
          id: { type: "string" },
          version: { type: "string", readOnly: true, description: "Versión opaca del snapshot. Envíala sin cambios en X-Invitation-Version para remove, restore-replacement y edición de nombre; no se guarda como dato del documento." },
          displayName: { type: "string" },
          maxGuests: { type: "integer", minimum: 1 },
          replacementsAllowed: { type: "boolean" },
          rsvpStatus: {
            type: "string",
            enum: ["pending", "confirmed", "partial", "declined"],
          },
          message: { type: "string" },
          isArchived: { type: "boolean" },
          archivedAt: { type: "string", format: "date-time", nullable: true },
          updatedAt: { type: "string", format: "date-time", nullable: true },
          editOverrideUntil: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          guests: {
            type: "array",
            items: { $ref: "#/components/schemas/Guest" },
          },
        },
      },
      InvitationList: {
        type: "object",
        required: ["items", "total"],
        properties: {
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/Invitation" },
          },
          total: { type: "integer", minimum: 0 },
        },
      },
      CreateInvitationInput: {
        type: "object",
        description:
          "Se requiere al menos un lugar para invitados en total: knownGuests.length + openSlots debe ser mayor o igual a 1.",
        additionalProperties: false,
        required: ["displayName", "knownGuests", "openSlots", "replacementsAllowed"],
        properties: {
          displayName: { type: "string", minLength: 1, pattern: ".*\\S.*" },
          knownGuests: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 1, pattern: ".*\\S.*" },
              },
            },
          },
          openSlots: { type: "integer", minimum: 0 },
          replacementsAllowed: { type: "boolean" },
        },
      },
      UpdateInvitationInput: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          displayName: { type: "string", minLength: 1, pattern: ".*\\S.*" },
          replacementsAllowed: { type: "boolean" },
          editOverrideUntil: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "ISO 8601 con fecha, hora, segundos y zona explícita Z o ±HH:mm; fracción opcional de 1 a 3 dígitos. Debe ser futura según el reloj del servidor, comprobado en cada intento transaccional. null revoca, incluso en archivadas; una fecha no-null no se permite en archivadas. Incluir este campo exige X-Invitation-Version.",
          },
        },
      },
      ChangeCapacityInput: {
        type: "object",
        additionalProperties: false,
        required: ["maxGuests"],
        properties: { maxGuests: { type: "integer", minimum: 1 } },
      },
      PublicHealth: {
        type: "object",
        required: ["status", "service"],
        properties: {
          status: { type: "string", enum: ["ok"] },
          service: { type: "string", enum: ["boda-api"] },
        },
      },
      AdminHealth: {
        type: "object",
        required: ["status", "service", "authenticated"],
        properties: {
          status: { type: "string", enum: ["ok"] },
          service: { type: "string", enum: ["boda-api"] },
          authenticated: { type: "boolean", enum: [true] },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                enum: [
                  "VALIDATION_ERROR",
                  "PRECONDITION_FAILED",
                  "IDEMPOTENCY_CONFLICT",
                  "UNAUTHORIZED",
                  "FORBIDDEN",
                  "INVITATION_NOT_FOUND",
                  "NOT_FOUND",
                  "INTERNAL_ERROR",
                ],
              },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
