import systemCsv from "../../../use_cases/simple_conciliation/system_transactions.csv?raw";
import bankCsv from "../../../use_cases/simple_conciliation/bank_movements.csv?raw";
import type { StoredWorkflow } from "../workflow-store";
import type { WorkflowNode } from "../types";

const SYSTEM_PARSER = `// keep every column as string so the join on user_id matches text vs text
return parseCsv(content, { dynamicTyping: false });`;

// The DSL has no split function, so deriving user_id from the encoded
// "id:email" belongs to the file node's parser — shaping raw data is its job.
const BANK_PARSER = `// keep strings + derive user_id from "id:email"
const rows = parseCsv(content, { dynamicTyping: false });
return rows.map((r) => ({
  ...r,
  user_id: String(r.user_email ?? "").split(":")[0],
}));`;

const DSL_SYSTEM = `proceso normalizar_sistema

desde banco.public.system_transactions

agregar columna monto_sistema =
    convertir_decimal(amount)

seleccionar
    user_id,
    transaction_date,
    monto_sistema

escribir depurado.sistema
    modo reemplazar
`;

// id_verificado doubles as validation: if a user_email was malformed, the
// derived user_id is not numeric, the CAST aborts and the node fails with
// rollback — same semantics as the script-based validation it replaces.
const DSL_BANK = `proceso normalizar_banco

desde banco.public.bank_movements

agregar columna id_verificado =
    convertir_entero(user_id)

agregar columna monto_banco =
    convertir_decimal(monto)

seleccionar
    user_id,
    date,
    monto_banco,
    user_email

escribir depurado.banco
    modo reemplazar
`;

// LEFT JOIN + classification in one DSL process (unir, DSL v0.2). The two
// inputs are the target tables emitted by the upstream DSL nodes; user_id
// exists on both sides, so it is qualified and renamed in seleccionar.
const DSL_CLASSIFY = `proceso clasificar_conciliacion

desde banco.{{input0}} como s

unir izquierda banco.{{input1}} como b
    en b.user_id = s.user_id
    y b.date = s.transaction_date

agregar columna diferencia =
    monto_sistema - coalescer(monto_banco, 0)

agregar columna estado =
    si es_nulo(monto_banco) entonces "FALTANTE_EN_BANCO"
    sino si diferencia = 0 entonces "CONCILIADO"
    sino "DESCUADRE"
    fin

seleccionar
    s.user_id como user_id,
    transaction_date,
    monto_sistema,
    monto_banco,
    diferencia,
    estado,
    user_email

escribir depurado.conciliacion
    modo reemplazar
`;

/**
 * DSL-only reconciliation: normalization, validation, the LEFT JOIN and the
 * classification all live in DSL nodes — only the file nodes remain. The
 * final DSL node's preview is the result table.
 */
export function buildDslConciliationExample(): StoredWorkflow {
  const nodes: WorkflowNode[] = [
    {
      id: "file-system",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        label: "system_transactions.csv",
        status: "idle",
        fileName: "system_transactions.csv",
        fileContent: systemCsv,
        tableName: "system_transactions",
        parserScript: SYSTEM_PARSER,
      },
    },
    {
      id: "file-bank",
      type: "file",
      position: { x: 0, y: 420 },
      data: {
        label: "bank_movements.csv",
        status: "idle",
        fileName: "bank_movements.csv",
        fileContent: bankCsv,
        tableName: "bank_movements",
        parserScript: BANK_PARSER,
      },
    },
    {
      id: "dsl-system",
      type: "dsl",
      position: { x: 380, y: -40 },
      data: {
        label: "DSL: normalizar sistema",
        status: "idle",
        dsl: DSL_SYSTEM,
        description:
          "Convierte amount a decimal y escribe depurado.sistema con user_id, fecha y monto_sistema.",
        paramsJson: "",
      },
    },
    {
      id: "dsl-bank",
      type: "dsl",
      position: { x: 380, y: 380 },
      data: {
        label: "DSL: validar + normalizar banco",
        status: "idle",
        dsl: DSL_BANK,
        description:
          "Valida user_id con convertir_entero (aborta si hay emails malformados) y escribe depurado.banco.",
        paramsJson: "",
      },
    },
    {
      id: "dsl-classify",
      type: "dsl",
      position: { x: 760, y: 170 },
      data: {
        label: "DSL: unir y clasificar",
        status: "idle",
        dsl: DSL_CLASSIFY,
        description:
          "LEFT JOIN sistema × banco por usuario y fecha; clasifica cada fila en CONCILIADO, DESCUADRE o FALTANTE_EN_BANCO.",
        paramsJson: "",
      },
    },
  ];

  return {
    id: crypto.randomUUID(),
    name: "Conciliation with DSL (example)",
    nodes,
    edges: [
      { id: "e-system-dsl", source: "file-system", target: "dsl-system" },
      { id: "e-bank-dsl", source: "file-bank", target: "dsl-bank" },
      // Edge order matters: {{input0}} = depurado.sistema, {{input1}} = depurado.banco.
      { id: "e-dslsystem-classify", source: "dsl-system", target: "dsl-classify" },
      { id: "e-dslbank-classify", source: "dsl-bank", target: "dsl-classify" },
    ],
    updatedAt: Date.now(),
  };
}

export const dslConciliationMeta = {
  title: "Conciliation with DSL",
  description:
    "The same reconciliation, rebuilt entirely on DSL nodes: normalize both CSVs, validate with convertir_entero, then LEFT JOIN and classify matches with «unir» — no SQL or script nodes involved.",
  nodeCount: 5,
  build: buildDslConciliationExample,
};
