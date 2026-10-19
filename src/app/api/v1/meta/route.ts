import { json, preflight } from "@/lib/http";
import { snapshot } from "@/lib/snapshot";

export function GET() {
  return json({ ...snapshot.meta, totalUnidades: snapshot.unidades.length });
}

export const OPTIONS = preflight;
