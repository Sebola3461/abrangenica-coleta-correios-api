/**
 * Normaliza um CEP para 8 dígitos. Aceita "01310100", "01310-100" e "01.310-100".
 * Retorna null quando o formato é inválido.
 */
export function normalizarCep(entrada: string): string | null {
  const limpo = entrada.trim().replace(/[.\-\s]/g, "");
  if (!/^\d{8}$/.test(limpo)) return null;
  if (limpo === "00000000") return null;
  return limpo;
}

export function formatarCep(cep: string | number): string {
  const s = String(cep).padStart(8, "0");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
