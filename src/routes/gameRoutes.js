// src/routes/gameRoutes.js
import { Router } from 'express';
import { getGamesByLanguage } from '../controllers/gameController.js';

const router = Router();

// Endpoint público/controlado para buscar jogos por idioma (ex: /api/games/en)
router.get('/games/:lang', getGamesByLanguage);

export default router;