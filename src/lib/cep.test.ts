import { describe, expect, it } from "vitest";
import { formatarCep, normalizarCep } from "./cep";

describe("normalizarCep", () => {
  it.each([
    ["01310100", "01310100"],
    ["01310-100", "01310100"],
    ["01.310-100", "01310100"],
    [" 69945-000 ", "69945000"],
  ])("aceita %s", (entrada, esperado) => {
    expect(normalizarCep(entrada)).toBe(esperado);
  });

  it.each(["", "1310100", "013101000", "01310-10a", "abcdefgh", "00000-000", "01310_100"])(
    "rejeita %j",
    (entrada) => {
      expect(normalizarCep(entrada)).toBeNull();
    },
  );
});

describe("formatarCep", () => {
  it("preenche zeros à esquerda e insere o hífen", () => {
    expect(formatarCep(1310100)).toBe("01310-100");
    expect(formatarCep("69945000")).toBe("69945-000");
  });
});
