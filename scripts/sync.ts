/**
 * Baixa a planilha de abrangência da Logística Reversa dos Correios e grava
 * data/abrangencia.json. Só reescreve o arquivo quando o conteúdo muda.
 *
 * Uso: npm run sync [-- --force]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { montarSnapshot, URL_PLANILHA } from "../src/lib/planilha";
import type { Snapshot } from "../src/lib/tipos";

const DESTINO = resolve(import.meta.dirname, "../data/abrangencia.json");
const TENTATIVAS = 4;
const TIMEOUT_MS = 60_000;

async function baixar(url: string): Promise<string> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; abrangencia-lrs-correios/1.0)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // A planilha é HTML em ISO-8859-1.
      return new TextDecoder("latin1").decode(await resp.arrayBuffer());
    } catch (e) {
      ultimoErro = e;
      console.warn(`Tentativa ${tentativa}/${TENTATIVAS} falhou: ${e instanceof Error ? e.message : e}`);
      if (tentativa < TENTATIVAS) await new Promise((r) => setTimeout(r, 2 ** tentativa * 1000));
    }
  }
  throw new Error(`Não foi possível baixar a planilha: ${ultimoErro}`);
}

/** JSON com uma faixa por linha, para o diff no git mostrar exatamente o que mudou. */
function serializar(s: Snapshot): string {
  const lista = (itens: unknown[]) => `[\n${itens.map((i) => `    ${JSON.stringify(i)}`).join(",\n")}\n  ]`;
  const faixas = Object.entries(s.faixas)
    .map(([modalidade, itens]) => `    ${JSON.stringify(modalidade)}: ${lista(itens).replace(/\n/g, "\n  ")}`)
    .join(",\n");
  return (
    `{\n  "meta": ${JSON.stringify(s.meta, null, 2).replace(/\n/g, "\n  ")},\n` +
    `  "unidades": ${lista(s.unidades)},\n` +
    `  "faixas": {\n${faixas}\n  }\n}\n`
  );
}

async function main() {
  const forcar = process.argv.includes("--force");
  console.log(`Baixando ${URL_PLANILHA}`);
  const html = await baixar(URL_PLANILHA);
  const novo = montarSnapshot(html, new Date());

  if (!forcar && existsSync(DESTINO)) {
    const atual = JSON.parse(readFileSync(DESTINO, "utf8")) as Snapshot;
    if (atual.meta.sha256 === novo.meta.sha256) {
      console.log(`Sem mudanças (sha256 ${novo.meta.sha256.slice(0, 12)}). Arquivo mantido.`);
      return;
    }
  }

  writeFileSync(DESTINO, serializar(novo));
  const { totais, faixasDescartadas, totalLinhas } = novo.meta;
  console.log(`Gravado ${DESTINO}`);
  console.log(`Linhas: ${totalLinhas} | Unidades: ${novo.unidades.length} | Faixas: ${JSON.stringify(totais)}`);
  if (faixasDescartadas.length) {
    console.log(`Faixas descartadas (${faixasDescartadas.length}):`);
    for (const f of faixasDescartadas) console.log(`  - ${f.unidade} ${f.servico} ${f.cepInicial} → ${f.cepFinal}: ${f.motivo}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
