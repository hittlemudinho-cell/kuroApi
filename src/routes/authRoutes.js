// src/routes/authRoutes.js
import { Router } from 'express';
import {
  redirectToPatreon,
  handlePatreonCallback,
  getSessionStatus,
  logoutUser,
} from '../controllers/authController.js';

const router = Router();

// Endpoint para iniciar o login (o botão do Patreon no site aponta para aqui)
router.get('/patreon', redirectToPatreon);

// Endpoint de callback configurado no painel de developers do Patreon
router.get('/patreon/callback', handlePatreonCallback);

// Endpoint para o front-end checar se o utilizador está autenticado
router.get('/session', getSessionStatus);

// Endpoint para terminar sessão
router.post('/logout', logoutUser);

export default router;