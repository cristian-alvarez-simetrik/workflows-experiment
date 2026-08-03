import { describe, expect, it } from "vitest";
import { DiagnosticCodes } from "../diagnostics";
import { lex } from "../lexer";

describe("lexer", () => {
  it("reconoce palabras reservadas sin distinguir mayúsculas", () => {
    const { tokens } = lex("PROCESO Proceso proceso");
    expect(tokens.map((t) => t.type)).toEqual([
      "keyword",
      "keyword",
      "keyword",
      "eof",
    ]);
    expect(tokens[0].value).toBe("proceso");
    expect(tokens[0].lexeme).toBe("PROCESO"); // conserva el texto original
  });

  it("normaliza identificadores a minúsculas", () => {
    const { tokens } = lex("Monto_Total");
    expect(tokens[0].type).toBe("identifier");
    expect(tokens[0].value).toBe("monto_total");
  });

  it("lee cadenas con escapes", () => {
    const { tokens } = lex('"Texto con \\"comillas\\""');
    expect(tokens[0].type).toBe("string");
    expect(tokens[0].value).toBe('Texto con "comillas"');
  });

  it("reporta cadenas sin cerrar", () => {
    const { diagnostics } = lex('"abierta');
    expect(diagnostics[0].code).toBe(DiagnosticCodes.UNTERMINATED_STRING);
  });

  it("lee enteros y decimales", () => {
    const { tokens } = lex("10 10.5 0");
    expect(tokens[0].value).toBe(10);
    expect(tokens[1].value).toBe(10.5);
    expect(tokens[2].value).toBe(0);
  });

  it("rechaza identificadores que empiezan con dígito", () => {
    const { diagnostics } = lex("2monto");
    expect(diagnostics[0].code).toBe(DiagnosticCodes.INVALID_NUMBER);
  });

  it("lee todos los operadores", () => {
    const { tokens } = lex("= != > >= < <= + - * / ( ) , . $");
    expect(tokens.map((t) => t.type)).toEqual([
      "equals",
      "not_equals",
      "greater",
      "greater_equals",
      "less",
      "less_equals",
      "plus",
      "minus",
      "star",
      "slash",
      "lparen",
      "rparen",
      "comma",
      "dot",
      "dollar",
      "eof",
    ]);
  });

  it("detecta == con un diagnóstico específico", () => {
    const { diagnostics } = lex('si estado == "ACTIVO"');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(DiagnosticCodes.DOUBLE_EQUALS);
    expect(diagnostics[0].hint).toContain('"="');
  });

  it("detecta <> como operador no soportado", () => {
    const { diagnostics } = lex("a <> b");
    expect(diagnostics[0].code).toBe(DiagnosticCodes.UNSUPPORTED_OPERATOR);
  });

  it("reporta caracteres inválidos", () => {
    const { diagnostics } = lex("monto @ 3");
    expect(diagnostics[0].code).toBe(DiagnosticCodes.INVALID_CHARACTER);
  });

  it("registra línea y columna de cada token", () => {
    const { tokens } = lex("proceso demo\nsi monto > 0");
    const si = tokens.find((t) => t.value === "si")!;
    expect(si.range.start.line).toBe(2);
    expect(si.range.start.column).toBe(1);
    expect(si.atLineStart).toBe(true);
    const monto = tokens.find((t) => t.value === "monto")!;
    expect(monto.range.start.column).toBe(4);
    expect(monto.atLineStart).toBe(false);
  });
});
