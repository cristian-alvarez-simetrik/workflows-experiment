/**
 * Recursive-descent statement parser + Pratt expression parser.
 *
 * Statement boundaries are line-based: a token that starts at column 1
 * begins a new statement; indented lines continue the current one.
 *
 * Expression precedence (lowest to highest), following spec §19.2:
 *   conditional si/entonces/sino/fin
 *   o
 *   y
 *   no (prefix)
 *   = != > >= < <=
 *   + -
 *   * /
 *   unary + -
 *   calls, literals, references, parentheses
 */

import type {
  AddColumnNode,
  BinaryOperator,
  ColumnReferenceNode,
  ConditionalBranch,
  ExpressionNode,
  ParameterDeclarationNode,
  ProcessDeclarationNode,
  ProgramNode,
  SelectNode,
  SourceNode,
  TransformationNode,
  WriteNode,
} from "./ast";
import {
  Diagnostic,
  DiagnosticCodes,
  SourceRange,
  makeRange,
} from "./diagnostics";
import type { Token } from "./lexer";

/** Statement starters that belong to features explicitly out of scope. */
const EXCLUDED_STARTERS = new Set([
  "establecer",
  "eliminar",
  "renombrar",
  "validar",
  "filtrar",
  "rechazar",
  "crear",
  "actualizar",
  "insertar",
  "combinar",
  "unir",
  "union",
  "buscar",
  "join",
  "merge",
  "upsert",
  "agrupar",
  "ordenar",
  "limitar",
  "deduplicar",
  "manejar",
]);

const EXCLUDED_MODES = new Set(["anexar", "actualizar", "insertar"]);

interface ParseResult {
  program?: ProgramNode;
  diagnostics: Diagnostic[];
}

/** Thrown internally to abort the current statement and resynchronize. */
class ParseError extends Error {}

export function parse(tokens: Token[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let index = 0;

  // -------------------------------------------------------------------------
  // Token helpers
  // -------------------------------------------------------------------------

  const peek = (): Token => tokens[index];
  const advance = (): Token => tokens[index++];

  const isStatementStart = (token: Token): boolean =>
    token.type !== "eof" &&
    token.atLineStart &&
    token.range.start.column === 1;

  /** True when the current token ends the statement being parsed. */
  const atStatementEnd = (): boolean =>
    peek().type === "eof" || isStatementStart(peek());

  const error = (
    code: string,
    message: string,
    range: SourceRange,
    hint?: string
  ): ParseError => {
    diagnostics.push({ code, message, severity: "error", range, hint });
    return new ParseError(message);
  };

  const expectIdentifier = (what: string): Token => {
    const token = peek();
    if (atStatementEnd()) {
      throw error(
        DiagnosticCodes.MISSING_TOKEN,
        `Falta ${what}.`,
        token.range
      );
    }
    if (token.type !== "identifier") {
      throw error(
        DiagnosticCodes.UNEXPECTED_TOKEN,
        `Se esperaba ${what}, pero se encontró "${token.lexeme}".`,
        token.range,
        token.type === "keyword"
          ? `"${token.lexeme}" es una palabra reservada y no puede usarse como identificador.`
          : undefined
      );
    }
    return advance();
  };

  const expectType = (type: Token["type"], label: string): Token => {
    const token = peek();
    if (atStatementEnd() || token.type !== type) {
      throw error(
        DiagnosticCodes.MISSING_TOKEN,
        `Se esperaba ${label}${
          atStatementEnd() ? "" : `, pero se encontró "${token.lexeme}"`
        }.`,
        token.range
      );
    }
    return advance();
  };

  const expectStatementEnd = (statementName: string) => {
    if (!atStatementEnd()) {
      const token = peek();
      throw error(
        DiagnosticCodes.UNEXPECTED_TOKEN,
        `Texto inesperado después de la instrucción "${statementName}": "${token.lexeme}".`,
        token.range
      );
    }
  };

  const skipToNextStatement = () => {
    while (!atStatementEnd()) advance();
  };

  // -------------------------------------------------------------------------
  // Pratt expression parser
  // -------------------------------------------------------------------------

  const BINARY_PRECEDENCE: Partial<Record<string, number>> = {
    o: 1,
    y: 2,
    // "no" (prefix) sits at 3: looser than comparisons, tighter than y/o.
    "=": 4,
    "!=": 4,
    ">": 4,
    ">=": 4,
    "<": 4,
    "<=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
  };
  const UNARY_PRECEDENCE = 7;
  const NOT_PRECEDENCE = 3;

  const binaryOperatorOf = (token: Token): BinaryOperator | undefined => {
    switch (token.type) {
      case "keyword":
        if (token.value === "y" || token.value === "o") {
          return token.value;
        }
        return undefined;
      case "equals":
        return "=";
      case "not_equals":
        return "!=";
      case "greater":
        return ">";
      case "greater_equals":
        return ">=";
      case "less":
        return "<";
      case "less_equals":
        return "<=";
      case "plus":
        return "+";
      case "minus":
        return "-";
      case "star":
        return "*";
      case "slash":
        return "/";
      default:
        return undefined;
    }
  };

  const parseExpression = (minPrecedence = 0): ExpressionNode => {
    let left = parsePrefix();
    for (;;) {
      if (atStatementEnd()) break;
      const token = peek();
      const operator = binaryOperatorOf(token);
      if (!operator) break;
      const precedence = BINARY_PRECEDENCE[operator]!;
      if (precedence < minPrecedence) break;
      advance();
      const right = parseExpression(precedence + 1);
      left = {
        type: "BinaryExpression",
        operator,
        left,
        right,
        range: makeRange(left.range.start, right.range.end),
      };
    }
    return left;
  };

  const parsePrefix = (): ExpressionNode => {
    if (atStatementEnd()) {
      throw error(
        DiagnosticCodes.MISSING_EXPRESSION,
        "Falta una expresión.",
        peek().range,
        "Las líneas de continuación deben estar indentadas con al menos un espacio."
      );
    }
    const token = peek();

    if (token.type === "minus" || token.type === "plus") {
      advance();
      const operand = parseExpression(UNARY_PRECEDENCE);
      return {
        type: "UnaryExpression",
        operator: token.type === "minus" ? "-" : "+",
        operand,
        range: makeRange(token.range.start, operand.range.end),
      };
    }

    if (token.type === "keyword" && token.value === "no") {
      advance();
      const operand = parseExpression(NOT_PRECEDENCE + 1);
      return {
        type: "UnaryExpression",
        operator: "no",
        operand,
        range: makeRange(token.range.start, operand.range.end),
      };
    }

    if (token.type === "keyword" && token.value === "si") {
      return parseConditional();
    }

    return parsePrimary();
  };

  const parseConditional = (): ExpressionNode => {
    const startToken = advance(); // "si"
    const branches: ConditionalBranch[] = [];

    const parseBranch = (branchStart: Token) => {
      const condition = parseExpression(0);
      const thenToken = peek();
      if (!(thenToken.type === "keyword" && thenToken.value === "entonces")) {
        throw error(
          DiagnosticCodes.MISSING_TOKEN,
          'Se esperaba "entonces" en la expresión condicional.',
          thenToken.range
        );
      }
      advance();
      const result = parseExpression(0);
      branches.push({
        condition,
        result,
        range: makeRange(branchStart.range.start, result.range.end),
      });
    };

    parseBranch(startToken);

    for (;;) {
      const token = peek();
      if (!(token.type === "keyword" && token.value === "sino")) {
        throw error(
          DiagnosticCodes.MISSING_TOKEN,
          'Se esperaba "sino" en la expresión condicional. La rama "sino" es obligatoria.',
          token.range
        );
      }
      advance(); // "sino"
      const next = peek();
      if (next.type === "keyword" && next.value === "si") {
        advance(); // nested "si" → another branch
        parseBranch(next);
        continue;
      }
      // Final else.
      const elseResult = parseExpression(0);
      const finToken = peek();
      if (!(finToken.type === "keyword" && finToken.value === "fin")) {
        throw error(
          DiagnosticCodes.MISSING_TOKEN,
          'Se esperaba "fin" para cerrar la expresión condicional.',
          finToken.range
        );
      }
      advance();
      return {
        type: "ConditionalExpression",
        branches,
        elseResult,
        range: makeRange(startToken.range.start, finToken.range.end),
      };
    }
  };

  const parsePrimary = (): ExpressionNode => {
    const token = peek();

    switch (token.type) {
      case "number": {
        advance();
        return {
          type: "NumberLiteral",
          value: token.value as number,
          isInteger: Number.isInteger(token.value as number) &&
            !token.lexeme.includes("."),
          range: token.range,
        };
      }
      case "string": {
        advance();
        return {
          type: "StringLiteral",
          value: token.value as string,
          range: token.range,
        };
      }
      case "keyword": {
        if (token.value === "verdadero" || token.value === "falso") {
          advance();
          return {
            type: "BooleanLiteral",
            value: token.value === "verdadero",
            range: token.range,
          };
        }
        if (token.value === "nulo") {
          advance();
          return { type: "NullLiteral", range: token.range };
        }
        throw error(
          DiagnosticCodes.UNEXPECTED_TOKEN,
          `La palabra reservada "${token.lexeme}" no puede usarse aquí.`,
          token.range
        );
      }
      case "dollar": {
        const dollar = advance();
        const nameToken = peek();
        if (nameToken.type !== "identifier") {
          throw error(
            DiagnosticCodes.UNEXPECTED_TOKEN,
            'Se esperaba el nombre de un parámetro después de "$".',
            nameToken.range
          );
        }
        advance();
        return {
          type: "ParameterReference",
          name: nameToken.value as string,
          range: makeRange(dollar.range.start, nameToken.range.end),
        };
      }
      case "identifier": {
        const nameToken = advance();
        // Function call: identifier immediately followed by "(".
        if (peek().type === "lparen" && !atStatementEnd()) {
          advance(); // "("
          const args: ExpressionNode[] = [];
          if (peek().type !== "rparen") {
            for (;;) {
              args.push(parseExpression(0));
              if (peek().type === "comma") {
                advance();
                continue;
              }
              break;
            }
          }
          const closing = peek();
          if (closing.type !== "rparen") {
            throw error(
              DiagnosticCodes.MISSING_TOKEN,
              'Se esperaba ")" para cerrar la llamada a función.',
              closing.range
            );
          }
          advance();
          return {
            type: "FunctionCall",
            name: nameToken.value as string,
            args,
            range: makeRange(nameToken.range.start, closing.range.end),
          };
        }
        return {
          type: "ColumnReference",
          name: nameToken.value as string,
          range: nameToken.range,
        };
      }
      case "lparen": {
        advance();
        const inner = parseExpression(0);
        const closing = peek();
        if (closing.type !== "rparen") {
          throw error(
            DiagnosticCodes.MISSING_TOKEN,
            'Se esperaba ")".',
            closing.range
          );
        }
        advance();
        return inner;
      }
      default:
        throw error(
          DiagnosticCodes.UNEXPECTED_TOKEN,
          `Token inesperado "${token.lexeme}".`,
          token.range
        );
    }
  };

  // -------------------------------------------------------------------------
  // Statement parsers
  // -------------------------------------------------------------------------

  const parseProcess = (keyword: Token): ProcessDeclarationNode => {
    const name = expectIdentifier("el nombre del proceso");
    expectStatementEnd("proceso");
    return {
      type: "ProcessDeclaration",
      name: name.value as string,
      range: makeRange(keyword.range.start, name.range.end),
    };
  };

  const parseParameter = (keyword: Token): ParameterDeclarationNode => {
    const name = expectIdentifier("el nombre del parámetro");
    let defaultValue: ExpressionNode | undefined;
    if (!atStatementEnd() && peek().type === "equals") {
      advance();
      defaultValue = parseExpression(0);
    }
    expectStatementEnd("parametro");
    return {
      type: "ParameterDeclaration",
      name: name.value as string,
      defaultValue,
      range: makeRange(
        keyword.range.start,
        (defaultValue ?? { range: name.range }).range.end
      ),
    };
  };

  const parseDottedReference = (
    what: string
  ): { segments: Token[]; range: SourceRange } => {
    const first = expectIdentifier(what);
    const segments = [first];
    while (!atStatementEnd() && peek().type === "dot") {
      advance();
      segments.push(expectIdentifier(what));
    }
    return {
      segments,
      range: makeRange(
        first.range.start,
        segments[segments.length - 1].range.end
      ),
    };
  };

  const parseSource = (keyword: Token): SourceNode => {
    const { segments, range } = parseDottedReference(
      "un identificador de la referencia fuente"
    );
    if (segments.length !== 3) {
      throw error(
        DiagnosticCodes.INVALID_REFERENCE,
        `La referencia fuente debe tener exactamente tres segmentos (conexión.esquema.tabla), pero tiene ${segments.length}.`,
        range,
        "Ejemplo: desde banco.crudo.transacciones"
      );
    }
    expectStatementEnd("desde");
    return {
      type: "Source",
      connection: segments[0].value as string,
      schema: segments[1].value as string,
      table: segments[2].value as string,
      range: makeRange(keyword.range.start, range.end),
    };
  };

  const parseFilter = (keyword: Token): TransformationNode => {
    const condition = parseExpression(0);
    expectStatementEnd("si");
    return {
      type: "Filter",
      condition,
      range: makeRange(keyword.range.start, condition.range.end),
    };
  };

  const parseAddColumn = (keyword: Token): AddColumnNode => {
    const columnKeyword = peek();
    if (
      !(columnKeyword.type === "keyword" && columnKeyword.value === "columna")
    ) {
      throw error(
        DiagnosticCodes.UNEXPECTED_TOKEN,
        'Se esperaba "columna" después de "agregar".',
        columnKeyword.range
      );
    }
    advance();
    const name = expectIdentifier("el nombre de la columna");
    expectType("equals", '"="');
    const expression = parseExpression(0);
    expectStatementEnd("agregar columna");
    return {
      type: "AddColumn",
      name: name.value as string,
      nameRange: name.range,
      expression,
      range: makeRange(keyword.range.start, expression.range.end),
    };
  };

  const parseSelect = (keyword: Token): SelectNode => {
    const columns: ColumnReferenceNode[] = [];
    for (;;) {
      const name = expectIdentifier("el nombre de una columna");
      columns.push({
        type: "ColumnReference",
        name: name.value as string,
        range: name.range,
      });
      if (!atStatementEnd() && peek().type === "comma") {
        advance();
        // Optional trailing comma before statement end.
        if (atStatementEnd()) break;
        continue;
      }
      break;
    }
    expectStatementEnd("seleccionar");
    return {
      type: "Select",
      columns,
      range: makeRange(
        keyword.range.start,
        columns[columns.length - 1].range.end
      ),
    };
  };

  const parseWrite = (keyword: Token): WriteNode => {
    const { segments, range } = parseDottedReference(
      "un identificador de la referencia de salida"
    );
    if (segments.length !== 2) {
      throw error(
        DiagnosticCodes.INVALID_REFERENCE,
        `La referencia de salida debe tener exactamente dos segmentos (esquema.tabla), pero tiene ${segments.length}.`,
        range,
        "Ejemplo: escribir depurado.transacciones"
      );
    }
    const modeKeyword = peek();
    if (!(modeKeyword.type === "keyword" && modeKeyword.value === "modo")) {
      throw error(
        DiagnosticCodes.MISSING_TOKEN,
        'Falta "modo reemplazar" en la instrucción "escribir".',
        atStatementEnd() ? range : modeKeyword.range,
        '"modo reemplazar" es obligatorio en esta versión.'
      );
    }
    advance();
    const modeValue = peek();
    if (!(modeValue.type === "keyword" && modeValue.value === "reemplazar")) {
      const word =
        modeValue.type === "identifier" || modeValue.type === "keyword"
          ? String(modeValue.value)
          : modeValue.lexeme;
      throw error(
        DiagnosticCodes.UNSUPPORTED_MODE,
        EXCLUDED_MODES.has(word)
          ? `El modo "${word}" no está soportado en la versión 0.1.`
          : `Modo desconocido "${word}".`,
        modeValue.range,
        'El único modo soportado es "reemplazar".'
      );
    }
    const modeEnd = advance();
    expectStatementEnd("escribir");
    return {
      type: "Write",
      schema: segments[0].value as string,
      table: segments[1].value as string,
      mode: "replace",
      range: makeRange(keyword.range.start, modeEnd.range.end),
    };
  };

  // -------------------------------------------------------------------------
  // Program assembly with structural order checks
  // -------------------------------------------------------------------------

  let processNode: ProcessDeclarationNode | undefined;
  const parameters: ParameterDeclarationNode[] = [];
  let sourceNode: SourceNode | undefined;
  const operations: TransformationNode[] = [];
  let selectNode: SelectNode | undefined;
  let writeNode: WriteNode | undefined;
  let statementCount = 0;

  const structural = (code: string, message: string, range: SourceRange) => {
    diagnostics.push({ code, message, severity: "error", range });
  };

  while (peek().type !== "eof") {
    const token = peek();

    if (!isStatementStart(token)) {
      // Indented content with no owning statement (or leftovers after an
      // error): report once and resynchronize.
      structural(
        DiagnosticCodes.UNEXPECTED_TOKEN,
        `Texto inesperado "${token.lexeme}". Las instrucciones deben comenzar al inicio de la línea.`,
        token.range
      );
      advance();
      skipToNextStatement();
      continue;
    }

    const startedAfterWrite = writeNode !== undefined;
    statementCount += 1;

    try {
      if (token.type === "keyword") {
        const keyword = token.value as string;
        advance();
        switch (keyword) {
          case "proceso": {
            const node = parseProcess(token);
            if (processNode) {
              structural(
                DiagnosticCodes.DUPLICATE_STATEMENT,
                'Solo puede declararse un "proceso" por archivo.',
                node.range
              );
            } else if (statementCount !== 1) {
              structural(
                DiagnosticCodes.INVALID_PROGRAM_ORDER,
                '"proceso" debe ser la primera instrucción del archivo.',
                node.range
              );
              processNode = node;
            } else {
              processNode = node;
            }
            break;
          }
          case "parametro": {
            const node = parseParameter(token);
            if (sourceNode) {
              structural(
                DiagnosticCodes.INVALID_PROGRAM_ORDER,
                'Los parámetros deben declararse antes de la instrucción "desde".',
                node.range
              );
            }
            parameters.push(node);
            break;
          }
          case "desde": {
            const node = parseSource(token);
            if (sourceNode) {
              structural(
                DiagnosticCodes.DUPLICATE_STATEMENT,
                'Solo puede existir una instrucción "desde".',
                node.range
              );
            } else {
              sourceNode = node;
            }
            break;
          }
          case "si": {
            const node = parseFilter(token);
            if (!sourceNode) {
              structural(
                DiagnosticCodes.INVALID_PROGRAM_ORDER,
                'Las instrucciones "si" deben aparecer después de "desde".',
                node.range
              );
            }
            if (selectNode) {
              structural(
                DiagnosticCodes.INVALID_PROGRAM_ORDER,
                '"seleccionar" debe aparecer después de todas las instrucciones "si".',
                node.range
              );
            }
            operations.push(node);
            break;
          }
          case "agregar": {
            const node = parseAddColumn(token);
            if (!sourceNode) {
              structural(
                DiagnosticCodes.INVALID_PROGRAM_ORDER,
                '"agregar columna" debe aparecer después de "desde".',
                node.range
              );
            }
            if (selectNode) {
              structural(
                DiagnosticCodes.INVALID_PROGRAM_ORDER,
                '"seleccionar" debe aparecer después de todas las instrucciones "agregar columna".',
                node.range
              );
            }
            operations.push(node);
            break;
          }
          case "seleccionar": {
            const node = parseSelect(token);
            if (selectNode) {
              structural(
                DiagnosticCodes.DUPLICATE_STATEMENT,
                'Solo puede existir una instrucción "seleccionar".',
                node.range
              );
            } else {
              selectNode = node;
            }
            break;
          }
          case "escribir": {
            const node = parseWrite(token);
            if (writeNode) {
              structural(
                DiagnosticCodes.DUPLICATE_STATEMENT,
                'Solo puede existir una instrucción "escribir".',
                node.range
              );
            } else {
              writeNode = node;
            }
            break;
          }
          default:
            structural(
              DiagnosticCodes.UNKNOWN_STATEMENT,
              `La palabra reservada "${token.lexeme}" no inicia una instrucción válida.`,
              token.range
            );
            skipToNextStatement();
        }
      } else if (token.type === "identifier") {
        const word = token.value as string;
        if (EXCLUDED_STARTERS.has(word)) {
          structural(
            DiagnosticCodes.UNSUPPORTED_FEATURE,
            `La instrucción "${word}" no está soportada en la versión 0.1 del DSL.`,
            token.range
          );
        } else {
          structural(
            DiagnosticCodes.UNKNOWN_STATEMENT,
            `Instrucción desconocida "${token.lexeme}".`,
            token.range,
          );
        }
        advance();
        skipToNextStatement();
      } else {
        structural(
          DiagnosticCodes.UNKNOWN_STATEMENT,
          `Instrucción desconocida "${token.lexeme}".`,
          token.range
        );
        advance();
        skipToNextStatement();
      }
    } catch (err) {
      if (err instanceof ParseError) {
        skipToNextStatement();
      } else {
        throw err;
      }
    }

    if (startedAfterWrite) {
      structural(
        DiagnosticCodes.INVALID_PROGRAM_ORDER,
        'No puede haber instrucciones después de "escribir".',
        token.range
      );
    }
  }

  // Missing mandatory statements.
  const eofRange = tokens[tokens.length - 1].range;
  if (!processNode) {
    structural(
      DiagnosticCodes.MISSING_TOKEN,
      'Falta la instrucción "proceso".',
      eofRange
    );
  }
  if (!sourceNode) {
    structural(
      DiagnosticCodes.MISSING_TOKEN,
      'Falta la instrucción "desde".',
      eofRange
    );
  }
  if (!writeNode) {
    structural(
      DiagnosticCodes.MISSING_TOKEN,
      'Falta la instrucción "escribir".',
      eofRange
    );
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors || !processNode || !sourceNode || !writeNode) {
    return { diagnostics };
  }

  const program: ProgramNode = {
    type: "Program",
    process: processNode,
    parameters,
    source: sourceNode,
    operations,
    selection: selectNode,
    output: writeNode,
    range: makeRange(processNode.range.start, writeNode.range.end),
  };

  return { program, diagnostics };
}
