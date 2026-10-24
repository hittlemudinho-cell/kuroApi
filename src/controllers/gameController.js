// src/controllers/gameController.js
import { GAMES_BY_LANG } from "../data/index.js";

// As capas ficam em public/cover/ no front. No site publicado o conteúdo de "public/"
// está na raiz (/cover/x.webp), então "/public/cover/x.webp" dá 404. Esta função aceita
// os dois jeitos de escrever no arquivo de dados e entrega sempre o caminho certo.
const normalizeCover = (cover) =>
  typeof cover === "string" ? cover.replace(/^\/?public\//, "/") : cover;

/**
 * Lista os jogos por idioma, aplicando a restrição de conteúdo premium
 */
export function getGamesByLanguage(req, res) {
  const lang = req.params.lang?.toLowerCase();

  if (!lang) {
    return res.status(400).json({ error: "Idioma não informado" });
  }

  const games = GAMES_BY_LANG[lang];

  if (!games || !Array.isArray(games)) {
    return res.status(404).json({ error: "Idioma de jogos não encontrado" });
  }

  const isSubscriber = Boolean(req.session?.isSubscriber);

  const sanitizedGames = games.map((original) => {
    const game = { ...original, cover: normalizeCover(original.cover) };

    // Plataformas disponíveis. Vai em todos os jogos (inclusive os bloqueados),
    // para o front poder listar os premium nas páginas PC/Android sem ver o link.
    const platforms = Object.keys(game.download || {});

    // Se for premium e o utilizador não for assinante, remove o link de download
    if (game.premium && !isSubscriber) {
      return {
        ...game,
        platforms,
        download: null,
        lockedMessage: "Conteúdo exclusivo para assinantes do Patreon.",
      };
    }

    // Remove a propriedade lockedMessage caso exista em jogos liberados
    const { lockedMessage, ...safeGame } = game;
    return { ...safeGame, platforms };
  });

  // A resposta muda conforme o login: nunca pode ficar em cache compartilhado
  res.set("Cache-Control", "private, no-store");
  res.json({
    isSubscriber,
    games: sanitizedGames,
  });
}