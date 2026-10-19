import { describe, expect, it } from "vitest";
import { consultarColeta } from "./abrangencia";
import { extrairLinhas, MINIMO_LINHAS, montarSnapshot } from "./planilha";

const CABECALHO = `
<tr>
  <td align="center" bgcolor="#c0c0c0"><b>UNIDADE DE COLETA</b></td>
  <td align="center" bgcolor="#c0c0c0"><b>DR</b></td>
  <td align="center" bgcolor="#c0c0c0"><b>SERVIÇO</b></td>
  <td align="center" bgcolor="#c0c0c0"><b>CEP INICIAL</b></td>
  <td align="center" bgcolor="#c0c0c0"><b>CEP FINAL</b></td>
  <td align="center" bgcolor="#c0c0c0"><b>PRAZO DE COLETA</b></td>
</tr>`;

function linha(unidade: string, servico: string, ini: string, fim: string, prazo = "D + 1", dr = "SE/SPM") {
  return `<tr><td align="center">${unidade}</td><td align="center">${dr}                 </td>` +
    `<td align="center">${servico}</td><td align="center">${ini}</td>` +
    `<td align="center">${fim}</td><td align="center">${prazo}</td></tr>`;
}

/** Linhas de preenchimento num CEP distante, só para passar do mínimo de linhas. */
function preenchimento(n: number) {
  return Array.from({ length: n }, () => linha("CDD FILLER", "PAC Reverso", "99990-000", "99990-000"));
}

function planilha(linhas: string[]) {
  return `<table border="2">${CABECALHO}${linhas.join("\n")}${preenchimento(MINIMO_LINHAS).join("")}</table>`;
}

const AGORA = new Date("2026-10-19T12:00:00Z");

describe("extrairLinhas", () => {
  it("remove tags, decodifica entidades e apara espaços", () => {
    const [cab, l] = extrairLinhas(`<table>${CABECALHO}${linha("CDD A &amp; B", "SEDEX Reverso", "01000-000", "01000-999")}</table>`);
    expect(cab[2]).toBe("SERVIÇO");
    expect(l).toEqual(["CDD A & B", "SE/SPM", "SEDEX Reverso", "01000-000", "01000-999", "D + 1"]);
  });
});

describe("montarSnapshot", () => {
  it("descarta faixas invertidas e as registra no meta", () => {
    const s = montarSnapshot(
      planilha([
        linha("CDD HELENA MARIA", "SEDEX Reverso", "06246-000", "06046-999"),
        linha("CDD OK", "SEDEX Reverso", "06000-000", "06099-999"),
      ]),
      AGORA,
    );
    expect(s.meta.faixasDescartadas).toHaveLength(1);
    expect(s.meta.faixasDescartadas[0]).toMatchObject({
      unidade: "CDD HELENA MARIA",
      motivo: "CEP inicial maior que o CEP final",
    });
    expect(s.meta.totais.sedexReverso).toBe(1);
    expect(s.meta.atualizadoEm).toBe(AGORA.toISOString());
  });

  it("deduplica unidades e lê o prazo em dias", () => {
    const s = montarSnapshot(
      planilha([
        linha("AC FEIJO", "SEDEX Reverso", "69960-000", "69960-999", "D + 2", "SE/ACR"),
        linha("AC FEIJO", "PAC Reverso", "69960-000", "69960-999", "D + 2", "SE/ACR"),
      ]),
      AGORA,
    );
    const feijo = s.unidades.findIndex(([nome]) => nome === "AC FEIJO");
    expect(s.unidades.filter(([nome]) => nome === "AC FEIJO")).toHaveLength(1);
    expect(s.faixas.sedexReverso).toContainEqual([69960000, 69960999, feijo, 2]);
  });

  it("gera o mesmo hash para o mesmo conteúdo, independentemente da data", () => {
    const html = planilha([linha("CDD X", "Disque Coleta", "01000-000", "01000-999")]);
    expect(montarSnapshot(html, AGORA).meta.sha256).toBe(montarSnapshot(html, new Date()).meta.sha256);
  });

  it("falha com cabeçalho diferente do esperado", () => {
    expect(() => montarSnapshot(planilha([]).replace("CEP INICIAL", "CEP DE"), AGORA)).toThrow(/Cabeçalho/);
  });

  it("falha com poucas linhas", () => {
    expect(() => montarSnapshot(`<table>${CABECALHO}</table>`, AGORA)).toThrow(/mínimo/);
  });

  it("falha com serviço desconhecido", () => {
    expect(() => montarSnapshot(planilha([linha("X", "Carta Reversa", "01000-000", "01000-999")]), AGORA)).toThrow(
      /Serviço desconhecido/,
    );
  });
});

describe("consultarColeta", () => {
  const s = montarSnapshot(
    planilha([
      linha("CDD A", "SEDEX Reverso", "01000-000", "01999-999"),
      linha("CDD B", "SEDEX Reverso", "01310-000", "01310-999"), // sobrepõe CDD A
      linha("CDD A", "PAC Reverso", "01000-000", "01999-999"),
      linha("CDD C", "Disque Coleta", "02000-000", "02000-000"),
    ]),
    AGORA,
  );

  it("retorna todas as unidades quando as faixas se sobrepõem", () => {
    const r = consultarColeta(s, "01310100");
    expect(r.cepFormatado).toBe("01310-100");
    expect(r.atendido).toBe(true);
    expect(r.modalidades.sedexReverso.unidades.map((u) => u.unidade)).toEqual(["CDD A", "CDD B"]);
    expect(r.modalidades.pacReverso.aceito).toBe(true);
    expect(r.modalidades.disqueColeta.aceito).toBe(false);
  });

  it("inclui as bordas da faixa", () => {
    expect(consultarColeta(s, "01000000").modalidades.sedexReverso.aceito).toBe(true);
    expect(consultarColeta(s, "01999999").modalidades.sedexReverso.aceito).toBe(true);
    expect(consultarColeta(s, "02000000").modalidades.disqueColeta.aceito).toBe(true);
    expect(consultarColeta(s, "02000001").modalidades.disqueColeta.aceito).toBe(false);
  });

  it("CEP fora de qualquer faixa não é atendido", () => {
    const r = consultarColeta(s, "50000000");
    expect(r.atendido).toBe(false);
    expect(Object.values(r.modalidades).every((m) => !m.aceito && m.unidades.length === 0)).toBe(true);
  });

  it("formata a unidade de atendimento", () => {
    expect(consultarColeta(s, "02000000").modalidades.disqueColeta.unidades[0]).toEqual({
      unidade: "CDD C",
      dr: "SE/SPM",
      prazo: "D + 1",
      prazoDias: 1,
      cepInicial: "02000-000",
      cepFinal: "02000-000",
    });
  });
});
