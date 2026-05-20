export const BOOK_ID_PATTERN = "^[a-zA-Z0-9_:-]{1,100}$";
export const INPUT_MAX_LENGTH = 500;
export const QUERY_MAX_LENGTH = 100;

export const inputBodySchema = {
    additionalProperties: false,
    anyOf: [
        {
            required: ["input"]
        },
        {
            required: ["bookIdOrLink"]
        }
    ],
    properties: {
        bookIdOrLink: {
            maxLength: INPUT_MAX_LENGTH,
            minLength: 1,
            type: "string"
        },
        input: {
            maxLength: INPUT_MAX_LENGTH,
            minLength: 1,
            type: "string"
        },
        sourceId: {
            maxLength: 64,
            minLength: 1,
            type: "string"
        }
    },
    type: "object"
} as const;

export const downloadBodySchema = {
    additionalProperties: false,
    anyOf: [
        {
            required: ["input"]
        },
        {
            required: ["bookIdOrLink"]
        }
    ],
    properties: {
        bookIdOrLink: {
            maxLength: INPUT_MAX_LENGTH,
            minLength: 1,
            type: "string"
        },
        format: {
            enum: ["txt", "epub"],
            type: "string"
        },
        input: {
            maxLength: INPUT_MAX_LENGTH,
            minLength: 1,
            type: "string"
        },
        sourceId: {
            maxLength: 64,
            minLength: 1,
            type: "string"
        }
    },
    type: "object"
} as const;

export const jobIdParamsSchema = {
    additionalProperties: false,
    properties: {
        id: {
            format: "uuid",
            type: "string"
        }
    },
    required: ["id"],
    type: "object"
} as const;

export const previewKeyParamsSchema = {
    additionalProperties: false,
    properties: {
        key: {
            maxLength: 256,
            minLength: 1,
            type: "string"
        }
    },
    required: ["key"],
    type: "object"
} as const;

export const previewBookIdParamsSchema = {
    additionalProperties: false,
    properties: {
        bookId: {
            maxLength: INPUT_MAX_LENGTH,
            minLength: 1,
            pattern: BOOK_ID_PATTERN,
            type: "string"
        }
    },
    required: ["bookId"],
    type: "object"
} as const;

export const libraryBookIdParamsSchema = {
    additionalProperties: false,
    properties: {
        bookId: {
            maxLength: INPUT_MAX_LENGTH,
            minLength: 1,
            pattern: BOOK_ID_PATTERN,
            type: "string"
        }
    },
    required: ["bookId"],
    type: "object"
} as const;

export const fileQuerySchema = {
    additionalProperties: false,
    properties: {
        format: {
            enum: ["txt", "epub"],
            type: "string"
        },
        kind: {
            enum: ["original", "translated"],
            type: "string"
        }
    },
    type: "object"
} as const;

export const libraryQuerySchema = {
    additionalProperties: false,
    properties: {
        bookId: {
            maxLength: INPUT_MAX_LENGTH,
            minLength: 1,
            pattern: BOOK_ID_PATTERN,
            type: "string"
        },
        page: {
            minimum: 1,
            type: "integer"
        },
        q: {
            maxLength: QUERY_MAX_LENGTH,
            minLength: 1,
            type: "string"
        },
        pageSize: {
            maximum: 100,
            minimum: 1,
            type: "integer"
        }
    },
    type: "object"
} as const;
