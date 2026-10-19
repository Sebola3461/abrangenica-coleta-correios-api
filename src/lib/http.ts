/** 24 h na CDN da Vercel; cada deploy (novo snapshot) invalida o cache. */
export const CACHE_24H = "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function json(body: unknown, status = 200, cache = CACHE_24H): Response {
  return Response.json(body, { status, headers: { ...CORS, "Cache-Control": cache } });
}

export function erro(status: number, codigo: string, mensagem: string): Response {
  return json({ erro: { codigo, mensagem } }, status, "no-store");
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
