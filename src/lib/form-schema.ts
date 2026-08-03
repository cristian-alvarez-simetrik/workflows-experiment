import { parse as parseYaml } from "yaml";

/**
 * Schema for the dynamic form rendered by a form node. Authored as YAML in
 * the node, parsed into these types. Example:
 *
 *   title: Conciliation setup
 *   fields:
 *     - name: conciliation_name
 *       label: Name
 *       type: text
 *       required: true
 *     - name: mode
 *       type: select
 *       options: [full, partial]
 *     - name: sweeps
 *       type: list
 *       item_label: Sweep
 *       fields:
 *         - { name: left_column, type: text }
 *         - { name: right_column, type: text }
 *         - { name: tolerance, type: number, default: 0 }
 */

export type FormFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean"
  | "list";

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder?: string;
  help?: string;
  default?: unknown;
  /** select only */
  options: FormFieldOption[];
  /** list only — the fields of each item in the list */
  fields: FormField[];
  /** list only — label used for the "Add" button and item headers */
  itemLabel?: string;
}

export interface FormSchema {
  title?: string;
  fields: FormField[];
}

const FIELD_TYPES: FormFieldType[] = [
  "text",
  "textarea",
  "number",
  "select",
  "boolean",
  "list",
];

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a mapping (key: value pairs)`);
  }
  return value as Record<string, unknown>;
}

function parseField(raw: unknown, context: string): FormField {
  const obj = asRecord(raw, context);
  const name = obj.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`${context} is missing a "name"`);
  }
  const type = (obj.type ?? "text") as FormFieldType;
  if (!FIELD_TYPES.includes(type)) {
    throw new Error(
      `Field "${name}" has unknown type "${String(obj.type)}". Valid types: ${FIELD_TYPES.join(", ")}`
    );
  }

  const options: FormFieldOption[] = [];
  if (type === "select") {
    const rawOptions = obj.options;
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      throw new Error(`Select field "${name}" needs a non-empty "options" list`);
    }
    for (const opt of rawOptions) {
      if (typeof opt === "string" || typeof opt === "number") {
        options.push({ value: String(opt), label: String(opt) });
      } else {
        const o = asRecord(opt, `Option of "${name}"`);
        const value = String(o.value ?? o.label ?? "");
        if (!value) throw new Error(`Option of "${name}" needs a value`);
        options.push({ value, label: String(o.label ?? value) });
      }
    }
  }

  const fields: FormField[] = [];
  if (type === "list") {
    const rawFields = obj.fields;
    if (!Array.isArray(rawFields) || rawFields.length === 0) {
      throw new Error(`List field "${name}" needs a non-empty "fields" list`);
    }
    for (const f of rawFields) {
      const child = parseField(f, `Field of list "${name}"`);
      if (child.type === "list") {
        throw new Error(`List field "${name}" cannot contain nested lists`);
      }
      fields.push(child);
    }
  }

  return {
    name: name.trim(),
    label: typeof obj.label === "string" ? obj.label : name.trim(),
    type,
    required: obj.required === true,
    placeholder:
      typeof obj.placeholder === "string" ? obj.placeholder : undefined,
    help: typeof obj.help === "string" ? obj.help : undefined,
    default: obj.default,
    options,
    fields,
    itemLabel:
      typeof obj.item_label === "string"
        ? obj.item_label
        : typeof obj.itemLabel === "string"
          ? obj.itemLabel
          : undefined,
  };
}

/** Parse a YAML form schema. Throws a readable error on invalid input. */
export function parseFormSchema(yamlText: string): FormSchema {
  if (!yamlText.trim()) {
    throw new Error("Form schema is empty — define at least one field");
  }
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    throw new Error(
      `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const root = asRecord(doc, "Form schema");
  const rawFields = root.fields;
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw new Error(`Form schema needs a non-empty "fields" list`);
  }
  const fields = rawFields.map((f, i) => parseField(f, `fields[${i}]`));
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) throw new Error(`Duplicate field name "${f.name}"`);
    seen.add(f.name);
  }
  return {
    title: typeof root.title === "string" ? root.title : undefined,
    fields,
  };
}

function defaultForField(field: FormField): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "number":
      return undefined;
    case "boolean":
      return false;
    case "select":
      return field.options[0]?.value;
    case "list":
      return [];
    default:
      return "";
  }
}

/** A fresh item for a list field, populated with defaults. */
export function emptyListItem(field: FormField): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const f of field.fields) item[f.name] = defaultForField(f);
  return item;
}

function coerceScalar(field: FormField, value: unknown): unknown {
  if (value === undefined || value === null || value === "") {
    return defaultForField(field);
  }
  switch (field.type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      return value === true || value === "true";
    default:
      return String(value);
  }
}

/**
 * Merge stored values over schema defaults and coerce types, producing the
 * JSON object that becomes the form node's output.
 */
export function resolveFormValues(
  schema: FormSchema,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const stored = values[field.name];
    if (field.type === "list") {
      const items = Array.isArray(stored) ? stored : [];
      out[field.name] = items.map((item) => {
        const record = (
          typeof item === "object" && item !== null ? item : {}
        ) as Record<string, unknown>;
        const resolved: Record<string, unknown> = {};
        for (const f of field.fields) {
          resolved[f.name] = coerceScalar(f, record[f.name]);
        }
        return resolved;
      });
    } else {
      out[field.name] = coerceScalar(field, stored);
    }
  }
  return out;
}

/** Throw if a required field is empty. Used when the node executes. */
export function assertRequiredValues(
  schema: FormSchema,
  values: Record<string, unknown>
): void {
  for (const field of schema.fields) {
    if (!field.required) continue;
    const value = values[field.name];
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (field.type === "list" && Array.isArray(value) && value.length === 0);
    if (empty) {
      throw new Error(`Field "${field.label}" is required`);
    }
  }
}
