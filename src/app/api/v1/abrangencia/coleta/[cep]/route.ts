import { consultarColeta } from "@/lib/abrangencia";
import { normalizarCep } from "@/lib/cep";
import { erro, json, preflight } from "@/lib/http";
import { snapshot } from "@/lib/snapshot";

export async function GET(_req: Request, { params }: { params: Promise<{ cep: string }> }) {
  const { cep: bruto } = await params;
  const cep = normalizarCep(bruto);
  if (!cep) {
    return erro(400, "CEP_INVALIDO", "Informe um CEP com 8 dígitos, com ou sem hífen. Ex.: 01310-100");
  }
  return json(consultarColeta(snapshot, cep));
}

export const OPTIONS = preflight;
