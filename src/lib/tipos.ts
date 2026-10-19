export const MODALIDADES = {
  sedexReverso: "SEDEX Reverso",
  pacReverso: "PAC Reverso",
  disqueColeta: "Disque Coleta",
} as const;

export type Modalidade = keyof typeof MODALIDADES;

/** Faixa compacta: [cepInicial, cepFinal, índice da unidade, prazo em dias]. */
export type Faixa = [number, number, number, number];

export interface FaixaDescartada {
  unidade: string;
  dr: string;
  servico: string;
  cepInicial: string;
  cepFinal: string;
  motivo: string;
}

export interface Snapshot {
  meta: {
    fonte: string;
    atualizadoEm: string;
    sha256: string;
    totalLinhas: number;
    totais: Record<Modalidade, number>;
    faixasDescartadas: FaixaDescartada[];
  };
  /** Tabela de unidades: [nome, DR]. */
  unidades: [string, string][];
  faixas: Record<Modalidade, Faixa[]>;
}
