import { useMemo } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { ClipboardList, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyListItem,
  parseFormSchema,
  type FormField,
  type FormSchema,
} from "@/lib/form-schema";
import type { FormNodeData } from "@/lib/types";
import { CodeEditorDrawer } from "../code-editor-drawer";
import { NodeWrapper } from "./node-wrapper";

const SCHEMA_HELP = `YAML schema for the form. Example:

title: My form
fields:
  - name: table_name
    label: Table
    type: text
    required: true
  - name: mode
    type: select
    options: [full, partial]
  - name: limit
    type: number
    default: 100
  - name: sweeps
    type: list
    item_label: Sweep
    fields:
      - { name: left_column, type: text }
      - { name: right_column, type: text }
      - { name: tolerance, type: number, default: 0 }

Types: text, textarea, number, select, boolean, list.
The node's output is the JSON object of form values,
usable by downstream script nodes (as \`input\`).`;

interface FieldProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ScalarFieldControl({ field, value, onChange }: FieldProps) {
  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-16 font-mono text-xs"
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
          className="h-7 text-xs"
        />
      );
    case "select":
      return (
        <Select
          value={value === undefined ? undefined : String(value)}
          onValueChange={onChange}
        >
          <SelectTrigger size="sm" className="h-7 w-full text-xs">
            <SelectValue placeholder={field.placeholder ?? "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "boolean":
      return (
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={value === true || value === "true"}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span className="text-muted-foreground">{field.help ?? "Enabled"}</span>
        </label>
      );
    default:
      return (
        <Input
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 text-xs"
        />
      );
  }
}

function ListFieldControl({ field, value, onChange }: FieldProps) {
  const items = (Array.isArray(value) ? value : []) as Record<string, unknown>[];

  const patchItem = (index: number, name: string, v: unknown) => {
    onChange(
      items.map((item, i) => (i === index ? { ...item, [name]: v } : item))
    );
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div
          key={index}
          className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {field.itemLabel ?? field.label} {index + 1}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          {field.fields.map((sub) => (
            <div key={sub.name} className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">
                {sub.label}
                {sub.required && <span className="text-red-400">*</span>}
              </Label>
              <ScalarFieldControl
                field={sub}
                value={item[sub.name]}
                onChange={(v) => patchItem(index, sub.name, v)}
              />
            </div>
          ))}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-6 w-full text-xs"
        onClick={() => onChange([...items, emptyListItem(field)])}
      >
        <Plus className="h-3 w-3" />
        Add {field.itemLabel ?? field.label}
      </Button>
    </div>
  );
}

function DynamicForm({
  schema,
  values,
  onChange,
}: {
  schema: FormSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const setValue = (name: string, value: unknown) =>
    onChange({ ...values, [name]: value });

  return (
    <div className="space-y-2">
      {schema.title && (
        <div className="text-xs font-medium">{schema.title}</div>
      )}
      {schema.fields.map((field) => (
        <div key={field.name} className="space-y-0.5">
          {field.type !== "boolean" && (
            <Label className="text-[10px] text-muted-foreground">
              {field.label}
              {field.required && <span className="text-red-400">*</span>}
            </Label>
          )}
          {field.type === "list" ? (
            <ListFieldControl
              field={field}
              value={values[field.name] ?? field.default}
              onChange={(v) => setValue(field.name, v)}
            />
          ) : (
            <ScalarFieldControl
              field={field}
              value={values[field.name] ?? field.default}
              onChange={(v) => setValue(field.name, v)}
            />
          )}
          {field.help && field.type !== "boolean" && (
            <p className="text-[10px] leading-snug text-muted-foreground/80">
              {field.help}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function FormNode({ id, data, selected }: NodeProps) {
  const nodeData = data as FormNodeData;
  const { updateNodeData } = useReactFlow();

  const parsed = useMemo(() => {
    try {
      return { schema: parseFormSchema(nodeData.schemaYaml), error: null };
    } catch (err) {
      return {
        schema: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [nodeData.schemaYaml]);

  return (
    <NodeWrapper
      id={id}
      icon={ClipboardList}
      iconClassName="text-rose-400"
      typeLabel="Form"
      label={nodeData.label}
      status={nodeData.status}
      error={nodeData.error}
      selected={selected}
      hasInput={false}
      headerExtra={
        <CodeEditorDrawer
          title="Edit form schema"
          description={SCHEMA_HELP}
          value={nodeData.schemaYaml}
          language="yaml"
          placeholder={"fields:\n  - name: my_field\n    type: text"}
          onSave={(schemaYaml) => updateNodeData(id, { schemaYaml })}
        />
      }
    >
      <div className="nodrag nowheel space-y-2">
        {parsed.schema ? (
          <DynamicForm
            schema={parsed.schema}
            values={nodeData.values ?? {}}
            onChange={(values) => updateNodeData(id, { values })}
          />
        ) : nodeData.schemaYaml.trim() ? (
          <p className="whitespace-pre-wrap text-[10px] text-red-400">
            {parsed.error}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Open the editor (⤢) to define the form fields in YAML.
          </p>
        )}
      </div>
    </NodeWrapper>
  );
}
