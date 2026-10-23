// src/config/env.js
// Sanitiza e valida as variáveis de ambiente. Precisa ser importado ANTES dos outros
// módulos do projeto (o server.js já faz isso), porque eles leem process.env ao carregar.
//
// Por que existe: em painéis como o da Vercel os valores são guardados exatamente como
// foram digitados. Aspas, espaços ou uma barra no final (ex.: "http://localhost:5173/")
// quebram o CORS e o redirecionamento do login sem nenhum erro visível.

const { NODE_ENV, FRONTEND_URL, CORS_ORIGINS } = process.env;

export const isProd = NODE_ENV === "production";

// 1. Remove espaços e aspas sobrando dos valores
const KEYS = [
  "NODE_ENV",
  "PORT",
  "FRONTEND_URL",
  "CORS_ORIGINS",
  "COOKIE_SAMESITE",
  "REDIS_URL",
  "SESSION_SECRET",
  "PATREON_CLIENT_ID",
  "PATREON_CLIENT_SECRET",
  "PATREON_REDIRECT_URI",
  "PATREON_CAMPAIGN_ID",
  "PATREON_TIER_IDS",
  "SUBSCRIPTION_RECHECK_MS",
  "SESSION_STORE_TIMEOUT_MS",
];

for (const key of KEYS) {
  const raw = process.env[key];
  if (typeof raw !== "string") continue;
  const cleaned = raw
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .trim();
  if (cleaned !== raw) {
    process.env[key] = cleaned;
    console.warn(`[env] ${key}: removi aspas/espaços sobrando do valor.`);
  }
}

// 2. Converte um endereço em "origem" (esquema + host + porta), ou null se for inválido.
//    Aceita "http://localhost:5173/" e devolve "http://localhost:5173".
//    Recusa caminhos ("https://site.com/app"), senhas e protocolos que não sejam http(s).
export function normalizeOrigin(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!text) return null;
  try {
    const url = new URL(text);
    const simple =
      ["http:", "https:"].includes(url.protocol) &&
      !url.hostname.includes("*") && // curingas como *.vercel.app não são aceitos
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
    return simple ? url.origin : null;
  } catch {
    return null;
  }
}

// 3. FRONTEND_URL: para onde a pessoa volta depois do login (e dos erros de login)
const rawFrontend = process.env.FRONTEND_URL ?? FRONTEND_URL;

if (!rawFrontend && isProd) {
  throw new Error(
    "FRONTEND_URL é obrigatório em produção (ex.: https://meusite.com, sem barra no final).",
  );
}

export const frontendUrl = rawFrontend
  ? normalizeOrigin(rawFrontend)
  : "http://localhost:5173";

if (rawFrontend && !frontendUrl) {
  throw new Error(
    `FRONTEND_URL inválida: ${JSON.stringify(rawFrontend)}. ` +
      "Use só o endereço, ex.: https://meusite.com (sem caminho e sem barra no final).",
  );
}

// Os controllers leem process.env.FRONTEND_URL: entrega o valor já limpo
process.env.FRONTEND_URL = frontendUrl;

// 4. CORS: FRONTEND_URL + CORS_ORIGINS (lista separada por vírgula). Sempre origens EXATAS.
//    Nunca use curingas como "*.vercel.app": qualquer pessoa cria um site lá.
const extra = (process.env.CORS_ORIGINS ?? CORS_ORIGINS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const invalid = [];
const extraOrigins = [];
for (const item of extra) {
  const origin = normalizeOrigin(item.replace(/^(["'])([\s\S]*)\1$/, "$2"));
  if (origin) extraOrigins.push(origin);
  else invalid.push(item);
}

if (invalid.length) {
  console.warn(
    `[env] CORS_ORIGINS: ignorei ${JSON.stringify(invalid)} ` +
      "(use http(s)://host[:porta], sem caminho e sem curingas).",
  );
}

export const allowedOrigins = [...new Set([frontendUrl, ...extraOrigins])];