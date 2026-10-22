// src/controllers/authController.js
import crypto from "node:crypto";
import {
  buildAuthorizeUrl,
  getPatreonTokens,
  checkPatreonSubscription,
} from "../services/patreonService.js";
import { SESSION_COOKIE_NAME, cookieOptions } from "../config/session.js";

const {
  FRONTEND_URL = "http://localhost:5173",
  SUBSCRIPTION_RECHECK_MS,
} = process.env;

const REVALIDATE_INTERVAL_MS =
  Number(SUBSCRIPTION_RECHECK_MS) || 60 * 60 * 1000;

// Versões com Promise dos métodos da sessão (que usam callback)
const saveSession = (req) =>
  new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
const regenerateSession = (req) =>
  new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );

/**
 * Redireciona o utilizador para a página de autorização do Patreon
 */
export async function redirectToPatreon(req, res) {
  try {
    // "state": valor aleatório que o Patreon devolve no callback. Se não bater,
    // o login não foi iniciado por este navegador (proteção contra CSRF).
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    await saveSession(req); // garante que o state está gravado antes de sair do site

    res.redirect(buildAuthorizeUrl(state));
  } catch (err) {
    console.error("Erro ao iniciar login:", err.message);
    res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
  }
}

/**
 * Processa o callback enviado pelo Patreon após a autenticação
 */
export async function handlePatreonCallback(req, res) {
  const { code, error, state } = req.query;
  const frontendRedirect = FRONTEND_URL;

  // Utilizador cancelou a autorização no Patreon
  if (error) {
    return res.redirect(`${frontendRedirect}/login?error=access_denied`);
  }

  // O state precisa bater com o que guardámos ao iniciar o login
  const expectedState = req.session?.oauthState;
  if (!expectedState || typeof state !== "string" || state !== expectedState) {
    return res.redirect(`${frontendRedirect}/login?error=invalid_state`);
  }

  if (!code) {
    return res.redirect(`${frontendRedirect}/login?error=missing_code`);
  }

  try {
    // 1. Troca o código pelos tokens
    const tokenData = await getPatreonTokens(code);

    // 2. Verifica se é assinante
    const subscriptionStatus = await checkPatreonSubscription(
      tokenData.access_token,
    );

    // 3. Sessão nova após o login (evita session fixation) e guarda só o necessário
    await regenerateSession(req);
    req.session.user = {
      name: subscriptionStatus.patronDetails.name,
      tiers: subscriptionStatus.patronDetails.tiers,
    };
    req.session.isSubscriber = subscriptionStatus.isSubscriber;
    // Tokens ficam só no servidor (nunca vão para o navegador) para reconferir a assinatura depois
    req.session.patreon = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      nextCheckAt: Date.now() + REVALIDATE_INTERVAL_MS,
    };

    // 4. Garante que a sessão foi gravada antes de redirecionar
    await saveSession(req);
    res.redirect(`${frontendRedirect}?logged=true`);
  } catch (err) {
    console.error("Erro no callback de autenticação:", err.message);
    res.redirect(`${frontendRedirect}/login?error=auth_failed`);
  }
}

/**
 * Retorna o estado atual da sessão do utilizador
 */
export function getSessionStatus(req, res) {
  res.set("Cache-Control", "private, no-store");

  if (!req.session?.user) {
    return res.status(200).json({
      authenticated: false,
      isSubscriber: false,
    });
  }

  res.json({
    authenticated: true,
    user: { name: req.session.user.name }, // sem e-mail, sem tiers, sem tokens
    isSubscriber: Boolean(req.session.isSubscriber),
  });
}

/**
 * Termina a sessão do utilizador (Logout)
 */
export function logoutUser(req, res) {
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao destruir sessão:", err);
      return res.status(500).json({ error: "Erro ao terminar a sessão" });
    }

    // Mesmo nome e opções do cookie criado em config/session.js
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    res.json({ message: "Sessão terminada com sucesso" });
  });
}
