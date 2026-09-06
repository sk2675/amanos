import { AmanosError } from "../errors.js";

/** A plain JSON object with unknown fields still attached. */
export type JsonObject = Record<string, unknown>;

/** Collects the file name and the field path so every message says where it hurts. */
export class FieldReader {
  constructor(
    private readonly file: string,
    private readonly value: JsonObject,
    private readonly prefix = "",
  ) {}

  /** The raw object, so unknown fields can be carried over unchanged. */
  get raw(): JsonObject {
    return this.value;
  }

  has(field: string): boolean {
    return this.value[field] !== undefined;
  }

  object(field: string): FieldReader {
    const nested = this.value[field];
    if (!isJsonObject(nested)) {
      throw this.reject(field, "an object", nested);
    }
    return new FieldReader(this.file, nested, this.path(field));
  }

  /** For fields that have no sensible default, such as an entry's own path. */
  requiredString(field: string): string {
    const raw = this.value[field];
    if (typeof raw !== "string" || raw.trim() === "") {
      throw this.reject(field, "a non-empty string", raw);
    }
    return raw;
  }

  string(field: string, fallback: string): string {
    const raw = this.value[field];
    if (raw === undefined) {
      return fallback;
    }
    if (typeof raw !== "string" || raw.trim() === "") {
      throw this.reject(field, "a non-empty string", raw);
    }
    return raw;
  }

  integer(field: string, fallback: number, { min, max }: { min: number; max?: number }): number {
    const raw = this.value[field];
    if (raw === undefined) {
      return fallback;
    }
    const boundary = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      throw this.reject(field, `a whole number ${boundary}`, raw);
    }
    if (raw < min || (max !== undefined && raw > max)) {
      throw this.reject(field, `a whole number ${boundary}`, raw);
    }
    return raw;
  }

  oneOf<T extends string>(field: string, allowed: readonly T[], fallback: T): T {
    const raw = this.value[field];
    if (raw === undefined) {
      return fallback;
    }
    if (typeof raw !== "string" || !allowed.includes(raw as T)) {
      throw this.reject(field, `one of: ${allowed.join(", ")}`, raw);
    }
    return raw as T;
  }

  /** Null means "not recorded yet" for timestamps, so it is an accepted value. */
  isoDateOrNull(field: string, fallback: string | null): string | null {
    const raw = this.value[field];
    if (raw === undefined) {
      return fallback;
    }
    if (raw === null) {
      return null;
    }
    if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
      throw this.reject(field, "an ISO 8601 timestamp or null", raw);
    }
    return raw;
  }

  array<T>(field: string, fallback: readonly T[], item: (entry: FieldReader) => T): readonly T[] {
    const raw = this.value[field];
    if (raw === undefined) {
      return fallback;
    }
    if (!Array.isArray(raw)) {
      throw this.reject(field, "an array", raw);
    }
    return raw.map((entry, index) => {
      if (!isJsonObject(entry)) {
        throw invalid(this.file, `${this.path(field)}[${index}]`, "an object", entry);
      }
      return item(new FieldReader(this.file, entry, `${this.path(field)}[${index}]`));
    });
  }

  private path(field: string): string {
    return this.prefix === "" ? field : `${this.prefix}.${field}`;
  }

  private reject(field: string, expected: string, actual: unknown): AmanosError {
    return invalid(this.file, this.path(field), expected, actual);
  }
}

/** Parses JSON text into an object, or explains why the file is unusable. */
export function readJsonObject(file: string, text: string): FieldReader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AmanosError(`${file} is not valid JSON: ${reason}`);
  }

  if (!isJsonObject(parsed)) {
    throw new AmanosError(`${file} must contain a JSON object, found ${describe(parsed)}.`);
  }

  return new FieldReader(file, parsed);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(file: string, path: string, expected: string, actual: unknown): AmanosError {
  return new AmanosError(`${file}: "${path}" must be ${expected}, found ${describe(actual)}.`);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return JSON.stringify(value) ?? typeof value;
}
