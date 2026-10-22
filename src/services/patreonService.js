// src/services/patreonService.js
import axios from "axios";
import qs from "qs";

const {
  PATREON_CLIENT_ID,
  PATREON_CLIENT_SECRET,
  PATREON_REDIRECT_URI,
  PATREON_CAMPAIGN_ID,
  PATREON_TIER_IDS,
} = process.env;

const AUTHORIZE_URL = "https://www.patreon.com/oauth2/authorize";
const TOKEN_URL = "https://www.patreon.com/api/oauth2/token";
const IDENTITY_URL = "https://www.patreon.com/api/oauth2/v2/identity";

/**
 * Token inválido, expirado ou revogado (o utilizador pode tentar renovar o token).
 * Qualquer outro erro (rede, Patreon fora do ar) é um Error comum.
 */
export class PatreonAuthError extends Error {}

/**
 * Chame uma vez ao iniciar o servidor: falha logo se faltar configuração.
 */
export function validateEnv() {
  const required = [
    "PATREON_CLIENT_ID",
    "PATREON_CLIENT_SECRET",
    "PATREON_REDIRECT_URI",
    "PATREON_CAMPAIGN_ID",
  ];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Variável de ambiente faltando: ${key}`);
    }
  }
}

/**
 * URL da tela de autorização do Patreon.
 * "identity.memberships" é o escopo que permite ler as assinaturas.
 * "state" protege contra CSRF no login.
 */
export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: PATREON_CLIENT_ID,
    redirect_uri: PATREON_REDIRECT_URI,
    scope: "identity identity.memberships",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function requestTokens(payload, failureMessage) {
  try {
    const response = await axios.post(
      TOKEN_URL,
      qs.stringify({
        client_id: PATREON_CLIENT_ID,
        client_secret: PATREON_CLIENT_SECRET,
        ...payload,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    return response.data; // { access_token, refresh_token, expires_in, ... }
  } catch (error) {
    const status = error.response?.status;
    console.error(
      `${failureMessage}:`,
      error.response?.data || error.message,
    );
    // 400/401 aqui = code ou refresh_token inválido/revogado
    if (status === 400 || status === 401) {
      throw new PatreonAuthError(failureMessage);
    }
    throw new Error(failureMessage);
  }
}

/**
 * Troca o código de autorização por tokens
 */
export function getPatreonTokens(code) {
  return requestTokens(
    {
      code,
      grant_type: "authorization_code",
      redirect_uri: PATREON_REDIRECT_URI,
    },
    "Falha na autenticação com o Patreon",
  );
}

/**
 * Renova o access token. O Patreon devolve também um refresh token novo:
 * é preciso guardá-lo, o anterior deixa de valer.
 */
export function refreshPatreonTokens(refreshToken) {
  return requestTokens(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    "Falha ao renovar o token do Patreon",
  );
}

/**
 * Verifica se o utilizador é assinante ativo da campanha (e dos tiers permitidos, se configurados)
 */
export async function checkPatreonSubscription(accessToken) {
  try {
    const url =
      `${IDENTITY_URL}` +
      "?include=memberships.campaign,memberships.currently_entitled_tiers" +
      "&fields[user]=full_name" +
      "&fields[member]=patron_status" +
      "&fields[tier]=title";

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const { data, included = [] } = response.data;

    const allowedTierIds = PATREON_TIER_IDS
      ? PATREON_TIER_IDS.split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    let isSubscriber = false;
    const tiers = [];

    for (const item of included) {
      if (item.type !== "member") continue;

      const campaignId = item.relationships?.campaign?.data?.id;
      if (campaignId !== PATREON_CAMPAIGN_ID) continue;

      if (item.attributes?.patron_status !== "active_patron") continue;

      const entitledTiers =
        item.relationships?.currently_entitled_tiers?.data || [];

      for (const tier of entitledTiers) {
        tiers.push(tier.id);
      }

      // Sem filtro de tier: qualquer assinante ativo da campanha conta.
      // (Antes, quem não tinha nenhum tier listado ficava de fora.)
      if (allowedTierIds.length === 0) {
        isSubscriber = true;
      } else if (tiers.some((id) => allowedTierIds.includes(id))) {
        isSubscriber = true;
      }
    }

    return {
      isSubscriber,
      patronDetails: {
        name: data?.attributes?.full_name || "Utilizador Patreon",
        tiers,
      },
    };
  } catch (error) {
    console.error(
      "Erro ao verificar subscrição no Patreon:",
      error.response?.data || error.message,
    );
    if (error.response?.status === 401) {
      throw new PatreonAuthError("Token do Patreon inválido ou expirado");
    }
    throw new Error("Não foi possível verificar o status da assinatura");
  }
}
