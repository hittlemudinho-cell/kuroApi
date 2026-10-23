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

// Erro comum: colar o comando do painel ("redis-cli --tls -u redis://...") em vez da URL
if (REDIS_URL && !/^rediss?:\/\/\S+$/.test(REDIS_URL.trim())) {
  throw new Error(
    'REDIS_URL inválida: coloque só a URL (rediss://default:SENHA@host.upstash.io:6379), ' +
      'sem "redis-cli", sem "--tls" e sem "-u".',
  );
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

// Quanto tempo uma requisição espera o Redis ficar pronto antes de responder 503
const STORE_TIMEOUT_MS = Number(process.env.SESSION_STORE_TIMEOUT_MS) || 8000;

/** Redis inacessível: o servidor responde 503 em vez de deixar a requisição pendurada. */
export class SessionStoreUnavailableError extends Error {
  constructor() {
    super("Armazenamento de sessões indisponível");
    this.code = "SESSION_STORE_UNAVAILABLE";
  }
}

export const cookieOptions = {
  secure: isProd || sameSite === "none", // só envia em HTTPS
  httpOnly: true, // JavaScript do browser não consegue ler
  sameSite,
  maxAge: SESSION_TTL_SECONDS * 1000,
};

// Redis (Upstash): use a URL "TCP" do banco, que começa com rediss://
// Sem REDIS_URL (só em desenvolvimento) as sessões ficam na memória e somem ao reiniciar.
let store;
let redis;
if (REDIS_URL) {
  redis = createClient({
    url: REDIS_URL, // rediss:// já ativa TLS
    socket: {
      connectTimeout: 10_000,
      // Tenta reconectar sempre, esperando até 2 s entre as tentativas
      reconnectStrategy: (retries) => Math.min(retries * 100, 2000),
    },
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

function waitUntilReady(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      redis.off("ready", onReady);
      reject(new SessionStoreUnavailableError());
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    redis.once("ready", onReady);
  });
}

/**
 * Coloque ANTES do sessionConfig. Se o Redis ainda está conectando (início a frio na
 * Vercel) ou caiu, espera um pouco; passando do prazo responde 503 em vez de travar.
 * Quem não tem cookie de sessão (visitante anônimo vendo os jogos) nem usa o Redis,
 * então continua sendo atendido normalmente mesmo com o Redis fora do ar.
 */
export async function waitForSessionStore(req, res, next) {
  if (!redis || redis.isReady) return next();

  const hasSessionCookie = req.headers.cookie?.includes(`${SESSION_COOKIE_NAME}=`);
  const startsLogin = req.path.startsWith("/auth");
  if (!hasSessionCookie && !startsLogin) return next();

  try {
    await waitUntilReady(STORE_TIMEOUT_MS);
    next();
  } catch (err) {
    next(err);
  }
}