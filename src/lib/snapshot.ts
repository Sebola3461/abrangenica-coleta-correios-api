import dados from "../../data/abrangencia.json";
import type { Snapshot } from "./tipos";

/** Snapshot gerado por `npm run sync` e embutido no bundle da função. */
export const snapshot = dados as unknown as Snapshot;
