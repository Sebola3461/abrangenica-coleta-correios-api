import { createHash } from "node:crypto";
import { MODALIDADES, type Faixa, type FaixaDescartada, type Modalidade, type Snapshot } from "./tipos";

export const URL_PLANILHA =
  "https://www2.correios.com.br/encomendas/servicosOnline/logisticaReversa/abrangencia/dsp/listaAreaAbrangenciaExcel.cfm";

const CABECALHO_ESPERADO = ["UNIDADE DE COLETA", "DR", "SERVICO", "CEP INICIAL", "CEP FINAL", "PRAZO DE COLETA"];

/** Abaixo disso consideramos que a planilha veio truncada ou mudou de formato. */
export const MINIMO_LINHAS = 1000;

const MODALIDADE_POR_SERVICO = new Map<string, Modalidade>(
  Object.entries(MODALIDADES).map(([chave, nome]) => [nome.toUpperCase(), chave as Modalidade]),
);

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function textoDaCelula(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) =>
      e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : (ENTIDADES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function cepParaNumero(s: string): number | null {
  const m = /^(\d{5})-?(\d{3})$/.exec(s);
  return m ? Number(m[1] + m[2]) : null;
}

/** Extrai as linhas (já como texto) da tabela HTML que os Correios servem como ".xls". */
export function extrairLinhas(html: string): string[][] {
  const linhas = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return linhas.map((tr) => (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(textoDaCelula));
}

/**
 * Converte o HTML da planilha num snapshot compacto. Lança erro quando o layout
 * não é o esperado, para que a sincronização falhe em vez de gravar dado ruim.
 */
export function montarSnapshot(html: string, atualizadoEm: Date, fonte = URL_PLANILHA): Snapshot {
  const [cabecalho, ...dados] = extrairLinhas(html);
  if (!cabecalho || cabecalho.map(semAcento).join("|") !== CABECALHO_ESPERADO.join("|")) {
    throw new Error(`Cabeçalho inesperado na planilha: ${JSON.stringify(cabecalho)}`);
  }
  if (dados.length < MINIMO_LINHAS) {
    throw new Error(`Planilha com apenas ${dados.length} linhas (mínimo ${MINIMO_LINHAS})`);
  }

  const unidades: [string, string][] = [];
  const indiceUnidade = new Map<string, number>();
  const faixas: Record<Modalidade, Faixa[]> = { sedexReverso: [], pacReverso: [], disqueColeta: [] };
  const faixasDescartadas: FaixaDescartada[] = [];

  for (const [i, celulas] of dados.entries()) {
    if (celulas.length !== 6) {
      throw new Error(`Linha ${i + 2} com ${celulas.length} colunas: ${JSON.stringify(celulas)}`);
    }
    const [unidade, dr, servico, cepInicialTxt, cepFinalTxt, prazoTxt] = celulas;

    const modalidade = MODALIDADE_POR_SERVICO.get(servico.toUpperCase());
    if (!modalidade) throw new Error(`Serviço desconhecido na linha ${i + 2}: "${servico}"`);

    const descartar = (motivo: string) =>
      faixasDescartadas.push({ unidade, dr, servico, cepInicial: cepInicialTxt, cepFinal: cepFinalTxt, motivo });

    const cepInicial = cepParaNumero(cepInicialTxt);
    const cepFinal = cepParaNumero(cepFinalTxt);
    if (cepInicial === null || cepFinal === null) {
      descartar("CEP em formato inválido");
      continue;
    }
    if (cepInicial > cepFinal) {
      descartar("CEP inicial maior que o CEP final");
      continue;
    }

    const prazo = /^D\s*\+\s*(\d+)$/i.exec(prazoTxt);
    if (!prazo) {
      descartar(`Prazo em formato inválido: "${prazoTxt}"`);
      continue;
    }

    const chave = `${unidade}|${dr}`;
    let idx = indiceUnidade.get(chave);
    if (idx === undefined) {
      idx = unidades.push([unidade, dr]) - 1;
      indiceUnidade.set(chave, idx);
    }
    faixas[modalidade].push([cepInicial, cepFinal, idx, Number(prazo[1])]);
  }

  for (const lista of Object.values(faixas)) lista.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

  const sha256 = createHash("sha256").update(JSON.stringify({ unidades, faixas, faixasDescartadas })).digest("hex");

  return {
    meta: {
      fonte,
      atualizadoEm: atualizadoEm.toISOString(),
      sha256,
      totalLinhas: dados.length,
      totais: {
        sedexReverso: faixas.sedexReverso.length,
        pacReverso: faixas.pacReverso.length,
        disqueColeta: faixas.disqueColeta.length,
      },
      faixasDescartadas,
    },
    unidades,
    faixas,
  };
}
