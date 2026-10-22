// src/middlewares/authMiddleware.js
import {
  PatreonAuthError,
  checkPatreonSubscription,
  refreshPatreonTokens,
} from "../services/patreonService.js";

// De quanto em quanto tempo a assinatura é conferida de novo no Patreon
const REVALIDATE_INTERVAL_MS =
  Number(process.env.SUBSCRIPTION_RECHECK_MS) || 60 * 60 * 1000; // 1 hora
const RETRY_AFTER_ERROR_MS = 60 * 1000; // Patreon fora do ar: tenta de novo em 1 min

/**
 * Middleware para garantir que o utilizador está autenticado (tem sessão)
 */
export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      error: "Acesso não autorizado. Por favor, faça login com o Patreon.",
    });
  }
  next();
}

/**
 * Middleware para garantir que o utilizador é um assinante ativo do Patreon
 * (já inclui a verificação de autenticação)
 */
export function requireSubscriber(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      error: "Acesso não autorizado. Autenticação necessária.",
    });
  }

  if (!req.session.isSubscriber) {
    return res.status(403).json({
      error: "Acesso proibido. Conteúdo exclusivo para assinantes do Patreon.",
    });
  }

  next();
}

// Evita que duas requisições da mesma sessão (ex.: /auth/session e /api/games ao mesmo
// tempo) renovem o token em paralelo: o refresh token só pode ser usado uma vez.
const inflight = new Map();

async function checkWithRefresh({ accessToken, refreshToken }) {
  try {
    const status = await checkPatreonSubscription(accessToken);
    return { isSubscriber: status.isSubscriber, accessToken, refreshToken };
  } catch (err) {
    if (!(err instanceof PatreonAuthError)) throw err;

    // Access token expirou: renova e tenta de novo
    const tokens = await refreshPatreonTokens(refreshToken);
    const newAccess = tokens.access_token;
    const newRefresh = tokens.refresh_token || refreshToken;
    const status = await checkPatreonSubscription(newAccess);
    return {
      isSubscriber: status.isSubscriber,
      accessToken: newAccess,
      refreshToken: newRefresh,
    };
  }
}

/**
 * Reconfere a assinatura no Patreon quando o prazo vence, para que quem cancelou
 * (ou teve o pagamento recusado) perca o acesso premium sem precisar sair e entrar.
 * Use em rotas que devolvem conteúdo premium ou o estado da sessão.
 */
export async function revalidateSubscription(req, res, next) {
  const session = req.session;
  const patreon = session?.patreon;

  if (!session?.user || !patreon || Date.now() < patreon.nextCheckAt) {
    return next();
  }

  const key = req.sessionID;
  let job = inflight.get(key);
  if (!job) {
    job = checkWithRefresh(patreon).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }

  try {
    const result = await job;
    session.isSubscriber = result.isSubscriber;
    session.patreon = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      nextCheckAt: Date.now() + REVALIDATE_INTERVAL_MS,
    };
  } catch (err) {
    if (err instanceof PatreonAuthError) {
      // Autorização revogada pelo utilizador no Patreon: sem acesso premium
      session.isSubscriber = false;
      session.patreon.nextCheckAt = Date.now() + REVALIDATE_INTERVAL_MS;
    } else {
      // Patreon fora do ar / erro de rede: mantém o estado atual e tenta de novo em breve
      session.patreon.nextCheckAt = Date.now() + RETRY_AFTER_ERROR_MS;
    }
    console.error("Falha ao revalidar assinatura:", err.message);
  }

  next();
}
