// src/config/session.js
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";

const { SESSION_SECRET, NODE_ENV, COOKIE_SAMESITE, REDIS_URL } = process.env;

const isProd = NODE_ENV === "production";

// Em produção o secret é obrigatório
if (isProd && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET é obrigatório em produção");
}

// Em produção (Vercel, Render...) as sessões PRECISAM ficar no Redis: em serverless
// cada requisição pode cair numa instância diferente, e a memória não é compartilhada.
if (isProd && !REDIS_URL) {
  throw new Error("REDIS_URL é obrigatório em produção");
}

// SameSite do cookie de sessão:
//  - "lax"  : front e API no MESMO site (ex.: meusite.com e api.meusite.com). Padrão.
//  - "none" : front e API em sites DIFERENTES (ex.: meusite.com e minha-api.vercel.app).
//             Exige HTTPS (secure é ligado automaticamente).
const sameSite = (COOKIE_SAMESITE || "lax").toLowerCase();
if (!["lax", "strict", "none"].includes(sameSite)) {
  throw new Error('COOKIE_SAMESITE deve ser "lax", "strict" ou "none"');
}

export const SESSION_COOKIE_NAME = "sid";

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 horas

export const cookieOptions = {
  secure: isProd || sameSite === "none", // só envia em HTTPS
  httpOnly: true, // JavaScript do browser não consegue ler
  sameSite,
  maxAge: SESSION_TTL_SECONDS * 1000,
};

// Redis (Upstash): use a URL "TCP" do banco, que começa com rediss://
// Sem REDIS_URL (só em desenvolvimento) as sessões ficam na memória e somem ao reiniciar.
let store;
if (REDIS_URL) {
  const redis = createClient({
    url: REDIS_URL, // rediss:// já ativa TLS
    socket: { connectTimeout: 10_000 },
  });
  redis.on("error", (err) => console.error("Redis:", err.message));
  // Sem await: os comandos ficam na fila até a conexão abrir
  redis.connect().catch((err) => console.error("Redis (conexão):", err.message));

  store = new RedisStore({
    client: redis,
    prefix: "sess:",
    ttl: SESSION_TTL_SECONDS,
  });
} else {
  console.warn(
    "[session] REDIS_URL não definido: usando sessões em memória (apenas desenvolvimento).",
  );
}

export const sessionConfig = session({
  name: SESSION_COOKIE_NAME,
  secret: SESSION_SECRET || "dev-only-secret", // só aceitável em desenvolvimento
  resave: false,
  saveUninitialized: false,
  store, // undefined = memória
  cookie: cookieOptions,
});