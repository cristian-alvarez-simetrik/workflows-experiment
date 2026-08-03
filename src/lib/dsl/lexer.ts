/**
 * Lexer for the ETL DSL. Produces tokens with absolute source positions.
 * Statement boundaries are line-based: the parser treats any token that
 * begins at column 1 as a potential statement start, so the lexer keeps
 * column information intact and skips newlines entirely.
 */

import {
  Diagnostic,
  DiagnosticCodes,
  SourcePosition,
  SourceRange,
} from "./diagnostics";

export type TokenType =
  | "keyword"
  | "identifier"
  | "number"
  | "string"
  | "dollar"
  | "dot"
  | "comma"
  | "lparen"
  | "rparen"
  | "equals"
  | "not_equals"
  | "greater"
  | "greater_equals"
  | "less"
  | "less_equals"
  | "plus"
  | "minus"
  | "star"
  | "slash"
  | "eof";

export interface Token {
  type: TokenType;
  /** Original text as written by the user (keywords keep their casing). */
  lexeme: string;
  /** Normalized value: lowercase keyword/identifier, parsed number, string content. */
  value?: string | number | boolean | null;
  range: SourceRange;
  /** True when the token is the first non-blank character of its line. */
  atLineStart: boolean;
}

export const RESERVED_WORDS = new Set([
  "proceso",
  "parametro",
  "desde",
  "si",
  "entonces",
  "sino",
  "fin",
  "agregar",
  "columna",
  "seleccionar",
  "escribir",
  "modo",
  "reemplazar",
  "y",
  "o",
  "no",
  "verdadero",
  "falso",
  "nulo",
]);

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];

  let offset = 0;
  let line = 1;
  let column = 1;
  let lineHasToken = false;

  const position = (): SourcePosition => ({ offset, line, column });

  const advance = (): string => {
    const ch = source[offset];
    offset += 1;
    if (ch === "\n") {
      line += 1;
      column = 1;
      lineHasToken = false;
    } else {
      column += 1;
    }
    return ch;
  };

  const peek = (ahead = 0): string | undefined => source[offset + ahead];

  const push = (
    type: TokenType,
    lexeme: string,
    start: SourcePosition,
    value?: string | number | boolean | null
  ) => {
    tokens.push({
      type,
      lexeme,
      value,
      range: { start, end: position() },
      atLineStart: !lineHasToken,
    });
    lineHasToken = true;
  };

  const error = (
    code: string,
    message: string,
    start: SourcePosition,
    hint?: string
  ) => {
    diagnostics.push({
      code,
      message,
      severity: "error",
      range: { start, end: position() },
      hint,
    });
  };

  while (offset < source.length) {
    const ch = peek()!;

    // Whitespace (including newlines) only affects position bookkeeping.
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    const start = position();

    if (IDENT_START.test(ch)) {
      let text = "";
      while (offset < source.length && IDENT_PART.test(peek()!)) {
        text += advance();
      }
      const normalized = text.toLowerCase();
      if (RESERVED_WORDS.has(normalized)) {
        push("keyword", text, start, normalized);
      } else {
        push("identifier", text, start, normalized);
      }
      continue;
    }

    if (DIGIT.test(ch)) {
      let text = "";
      while (offset < source.length && DIGIT.test(peek()!)) {
        text += advance();
      }
      if (peek() === "." && peek(1) !== undefined && DIGIT.test(peek(1)!)) {
        text += advance(); // "."
        while (offset < source.length && DIGIT.test(peek()!)) {
          text += advance();
        }
      }
      // "2monto" style identifiers are invalid: a digit run directly
      // followed by identifier characters is a malformed number.
      if (offset < source.length && IDENT_START.test(peek()!)) {
        while (offset < source.length && IDENT_PART.test(peek()!)) {
          text += advance();
        }
        error(
          DiagnosticCodes.INVALID_NUMBER,
          `"${text}" no es un número ni un identificador válido.`,
          start,
          "Los identificadores deben comenzar con una letra o guion bajo."
        );
        continue;
      }
      push("number", text, start, Number(text));
      continue;
    }

    if (ch === '"') {
      advance(); // opening quote
      let value = "";
      let closed = false;
      while (offset < source.length) {
        const c = peek()!;
        if (c === "\n") break;
        if (c === "\\") {
          advance();
          const escaped = peek();
          if (escaped === '"' || escaped === "\\") {
            value += advance();
          } else if (escaped === "n") {
            advance();
            value += "\n";
          } else if (escaped === "t") {
            advance();
            value += "\t";
          } else if (escaped !== undefined) {
            value += advance();
          }
          continue;
        }
        if (c === '"') {
          advance();
          closed = true;
          break;
        }
        value += advance();
      }
      if (!closed) {
        error(
          DiagnosticCodes.UNTERMINATED_STRING,
          "Cadena de texto sin cerrar.",
          start,
          'Cierre la cadena con comillas dobles: "texto".'
        );
        continue;
      }
      push("string", source.slice(start.offset, offset), start, value);
      continue;
    }

    switch (ch) {
      case "$":
        advance();
        push("dollar", "$", start);
        continue;
      case ".":
        advance();
        push("dot", ".", start);
        continue;
      case ",":
        advance();
        push("comma", ",", start);
        continue;
      case "(":
        advance();
        push("lparen", "(", start);
        continue;
      case ")":
        advance();
        push("rparen", ")", start);
        continue;
      case "+":
        advance();
        push("plus", "+", start);
        continue;
      case "-":
        advance();
        push("minus", "-", start);
        continue;
      case "*":
        advance();
        push("star", "*", start);
        continue;
      case "/":
        advance();
        push("slash", "/", start);
        continue;
      case "=": {
        advance();
        if (peek() === "=") {
          advance();
          if (peek() === "=") advance();
          error(
            DiagnosticCodes.DOUBLE_EQUALS,
            `El operador "${source.slice(start.offset, offset)}" no existe.`,
            start,
            'Utilice "=" para comparar valores.'
          );
          continue;
        }
        push("equals", "=", start);
        continue;
      }
      case "!": {
        advance();
        if (peek() === "=") {
          advance();
          push("not_equals", "!=", start);
          continue;
        }
        error(
          DiagnosticCodes.INVALID_CHARACTER,
          'Carácter inesperado "!".',
          start,
          'Para desigualdad utilice "!=".'
        );
        continue;
      }
      case ">": {
        advance();
        if (peek() === "=") {
          advance();
          push("greater_equals", ">=", start);
        } else {
          push("greater", ">", start);
        }
        continue;
      }
      case "<": {
        advance();
        if (peek() === ">") {
          advance();
          error(
            DiagnosticCodes.UNSUPPORTED_OPERATOR,
            'El operador "<>" no existe.',
            start,
            'Utilice "!=" para comparar desigualdad.'
          );
          continue;
        }
        if (peek() === "=") {
          advance();
          push("less_equals", "<=", start);
        } else {
          push("less", "<", start);
        }
        continue;
      }
      default: {
        advance();
        error(
          DiagnosticCodes.INVALID_CHARACTER,
          `Carácter inesperado "${ch}".`,
          start
        );
        continue;
      }
    }
  }

  const eofPosition = position();
  tokens.push({
    type: "eof",
    lexeme: "",
    range: { start: eofPosition, end: eofPosition },
    atLineStart: !lineHasToken,
  });

  return { tokens, diagnostics };
}
