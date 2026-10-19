import { formatarCep } from "./cep";
import { MODALIDADES, type Modalidade, type Snapshot } from "./tipos";

export interface UnidadeAtendimento {
  unidade: string;
  dr: string;
  prazo: string;
  prazoDias: number;
  cepInicial: string;
  cepFinal: string;
}

export interface ResultadoModalidade {
  servico: string;
  aceito: boolean;
  unidades: UnidadeAtendimento[];
}

export interface ResultadoColeta {
  cep: string;
  cepFormatado: string;
  atendido: boolean;
  modalidades: Record<Modalidade, ResultadoModalidade>;
  dados: { atualizadoEm: string; fonte: string };
}

/**
 * Verifica em quais modalidades o CEP (8 dígitos, já normalizado) é atendido.
 * As faixas se sobrepõem, então todas as unidades que cobrem o CEP são retornadas.
 */
export function consultarColeta(snapshot: Snapshot, cep: string): ResultadoColeta {
  const alvo = Number(cep);
  const modalidades = {} as Record<Modalidade, ResultadoModalidade>;

  for (const modalidade of Object.keys(MODALIDADES) as Modalidade[]) {
    const unidades: UnidadeAtendimento[] = [];
    for (const [ini, fim, idx, prazoDias] of snapshot.faixas[modalidade]) {
      if (ini > alvo) break; // faixas ordenadas pelo CEP inicial
      if (alvo > fim) continue;
      const [unidade, dr] = snapshot.unidades[idx];
      unidades.push({
        unidade,
        dr,
        prazo: `D + ${prazoDias}`,
        prazoDias,
        cepInicial: formatarCep(ini),
        cepFinal: formatarCep(fim),
      });
    }
    modalidades[modalidade] = { servico: MODALIDADES[modalidade], aceito: unidades.length > 0, unidades };
  }

  return {
    cep,
    cepFormatado: formatarCep(cep),
    atendido: Object.values(modalidades).some((m) => m.aceito),
    modalidades,
    dados: { atualizadoEm: snapshot.meta.atualizadoEm, fonte: snapshot.meta.fonte },
  };
}
