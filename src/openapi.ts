const errorResponse = {
  description: "Error response",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
} as const;

const invitationResponse = {
  description: "Invitation",
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
  description: "Invitation ID",
} as const;

const secured = [{ firebaseBearer: [] }] as const;

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Boda API",
    version: "1.0.0",
    description: "Administrative API for wedding invitations.",
  },
  servers: [{ url: "/", description: "Current deployment" }],
  tags: [
    { name: "Health" },
    { name: "Admin" },
    { name: "Invitations" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Public health check",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublicHealth" },
              },
            },
          },
          "403": {
            ...errorResponse,
            description: "Origin forbidden by the global CORS policy",
          },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/health": {
      get: {
        tags: ["Admin"],
        summary: "Authenticated health check",
        security: secured,
        responses: {
          "200": {
            description: "Authenticated service health",
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
        tags: ["Invitations"],
        summary: "List invitations",
        description:
          "Filters are combined with AND. Search is partial and case-insensitive across id and displayName. Without archived, active and archived invitations are returned; legacy documents without isArchived are active.",
        security: secured,
        parameters: [
          {
            name: "search",
            in: "query",
            schema: { type: "string" },
            description: "Partial, case-insensitive match against id or displayName.",
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
            description: "true returns archived; false returns active including legacy.",
          },
        ],
        responses: {
          "200": {
            description: "Filtered invitation list",
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
        tags: ["Invitations"],
        summary: "Create an invitation",
        security: secured,
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
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}": {
      get: {
        tags: ["Invitations"],
        summary: "Get an invitation",
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
        tags: ["Invitations"],
        summary: "Update editable invitation fields",
        security: secured,
        parameters: [invitationIdParameter],
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
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/capacity": {
      patch: {
        tags: ["Invitations"],
        summary: "Change invitation capacity",
        description:
          "Increasing capacity adds empty open slots. Reduction only removes removable open slots and returns 400 when it cannot be performed safely.",
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
        tags: ["Invitations"],
        summary: "Restore a replaced guest",
        description: "Restores the original guest when the selected slot is a valid replacement.",
        security: secured,
        parameters: [
          invitationIdParameter,
          {
            name: "guestIndex",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0 },
          },
        ],
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
    "/api/admin/invitations/{id}/guests/{guestIndex}/remove": {
      post: {
        tags: ["Invitations"],
        summary: "Remove a known or open guest and reduce capacity",
        description: "Removes the selected position regardless of name or attendance. Replacements cannot be removed. At least one slot must remain. Preserves RSVP, replacementsAllowed and archive state; archived invitations are supported. Version is checked inside the transaction before using the index. On 412 reload and confirm again; never automatically retry with a newer version.",
        security: secured,
        parameters: [
          { ...invitationIdParameter, description: "A single document ID segment; slashes are forbidden. Legacy IDs are supported." },
          { name: "guestIndex", in: "path", required: true,
            schema: { type: "integer", minimum: 0, maximum: 9007199254740991 },
            description: "Canonical decimal index in the original guests array, without signs, spaces or leading zeros." },
          { name: "X-Invitation-Version", in: "header", required: true,
            schema: { type: "string", maxLength: 4096, pattern: "^iv1\\.[A-Za-z0-9_-]+$" },
            description: "One opaque invitation version. Missing or malformed returns 400; a different version returns 412." },
        ],
        responses: {
          "200": invitationResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "412": { ...errorResponse, description: "PRECONDITION_FAILED: Invitation has changed; reload before removing a guest" },
          "500": errorResponse,
        },
      },
    },
    "/api/admin/invitations/{id}/archive": {
      post: {
        tags: ["Invitations"],
        summary: "Archive an invitation",
        description: "Idempotent logical archive; the document is not physically deleted.",
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
        tags: ["Invitations"],
        summary: "Restore an archived invitation",
        description: "Idempotently restores an archived invitation.",
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
        description: "Firebase ID token: Authorization: Bearer <token>",
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
            description: "Present when type is replacement; may exist on legacy non-replacement data.",
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
          version: { type: "string", readOnly: true, description: "Opaque snapshot version. Return unchanged in X-Invitation-Version for remove; not persisted as document data." },
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
          "At least one total guest slot is required: knownGuests.length + openSlots must be greater than or equal to 1.",
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
