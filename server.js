import "dotenv/config";
// env.js precisa vir logo depois do dotenv: ele limpa as variáveis (aspas, espaços, barra
// no final) antes de os outros módulos lerem process.env.
import { allowedOrigins, frontendUrl, isProd } from "./src/config/env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  sessionConfig,
  waitForSessionStore,
} from "./src/config/session.js";
import { validateEnv } from "./src/services/patreonService.js";
import { revalidateSubscription } from "./src/middlewares/authMiddleware.js";
import authRoutes from "./src/routes/authRoutes.js";
import gameRoutes from "./src/routes/gameRoutes.js";

const { NODE_ENV, PORT = 3000, VERCEL, DEBUG_CORS } = process.env;

// Falha logo ao iniciar se faltar configuração (em vez de falhar no primeiro login)
validateEnv();

const app = express();

// Atrás de proxy/HTTPS (Vercel, Render, Railway...) o Express precisa confiar no proxy;
// sem isso o cookie "secure" nunca é gravado.
if (isProd) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet());

/* ----------------------------------------------------------------------------
 * CORS: só as origens EXATAS de FRONTEND_URL + CORS_ORIGINS (ver src/config/env.js).
 * Não use curingas como "*.vercel.app": como o cookie vai junto (credentials), qualquer
 * site de terceiros nessa lista poderia ler dados de quem está logado.
 * -------------------------------------------------------------------------- */
console.log("[cors] origens permitidas:", JSON.stringify(allowedOrigins));

app.use(
  cors({
    origin(origin, callback) {
      // Sem "Origin" = chamada direta (curl, health check, mesma origem): não é navegador
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);

      // Origem barrada: não é erro do servidor, só não enviamos os cabeçalhos CORS
      // e o navegador bloqueia. O log mostra qual origem foi barrada.
      console.warn(
        `[cors] BLOQUEADO: origem ${JSON.stringify(origin)} não está em ${JSON.stringify(allowedOrigins)}`,
      );
      callback(null, false);
    },
    credentials: true,
    maxAge: 600, // o navegador guarda a resposta do preflight por 10 min
  }),
);

/* ----------------------------------------------------------------------------
 * Rotas que não usam sessão (continuam respondendo mesmo com o Redis fora do ar)
 * -------------------------------------------------------------------------- */
app.get("/", (req, res) => {
  res.json({ status: "API do Patreon e Jogos a funcionar corretamente!" });
});

app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

// Diagnóstico opcional: só existe se você definir DEBUG_CORS=true. Desligue depois de usar.
if (DEBUG_CORS === "true") {
  app.get("/debug/cors", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ allowedOrigins, frontendUrl, nodeEnv: NODE_ENV ?? null });
  });
}

/* ----------------------------------------------------------------------------
 * Corpo das requisições, sessão e rotas da aplicação
 * -------------------------------------------------------------------------- */
app.use(express.json({ limit: "10kb" })); // limite de tamanho
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

app.use(waitForSessionStore); // espera o Redis (ou responde 503) antes de ler a sessão
app.use(sessionConfig);

// Reconfere a assinatura no Patreon quando o prazo vence (padrão: 1 hora)
app.use(["/auth/session", "/api"], revalidateSubscription);

app.use("/auth", authRoutes);
app.use("/api", gameRoutes);

/* ----------------------------------------------------------------------------
 * Rota inexistente e tratamento de erros
 * -------------------------------------------------------------------------- */
app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

const STORE_ERROR_CODES = new Set([
  "SESSION_STORE_UNAVAILABLE",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
]);

function isStoreUnavailable(err) {
  return (
    STORE_ERROR_CODES.has(err.code) ||
    ["ClientClosedError", "ClientOfflineError", "ConnectionTimeoutError", "SocketClosedUnexpectedlyError"].includes(
      err.constructor?.name,
    ) ||
    /socket closed|connection timeout|client is closed/i.test(err.message || "")
  );
}

// Tratamento de erros (precisa dos 4 parâmetros para o Express reconhecer como handler)
app.use((err, req, res, next) => {
  // Se a resposta já começou, não dá para mandar JSON: deixa o Express encerrar a conexão
  if (res.headersSent) return next(err);

  // Corpo da requisição mal formado ou grande demais
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido na requisição" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Requisição grande demais" });
  }

  // Outros erros 4xx gerados por middlewares (ex.: charset ou encoding não suportado)
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: "Requisição inválida" });
  }

  // Redis/sessões fora do ar: 503 = "tente de novo daqui a pouco"
  if (isStoreUnavailable(err)) {
    console.error(`[sessão] armazenamento indisponível em ${req.method} ${req.path}:`, err.message);
    res.set("Retry-After", "5");

    // No login (o navegador navega até aqui), volta para o site com uma mensagem
    if (req.method === "GET" && req.path.startsWith("/auth/patreon")) {
      return res.redirect(`${frontendUrl}/login?error=server_error`);
    }
    return res
      .status(503)
      .json({ error: "Serviço temporariamente indisponível. Tente novamente em instantes." });
  }

  // Qualquer outro erro: registra tudo no log, mas não revela detalhes para quem chamou
  console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);

  if (req.method === "GET" && req.path.startsWith("/auth/patreon")) {
    return res.redirect(`${frontendUrl}/login?error=server_error`);
  }
  res.status(500).json({ error: "Erro interno do servidor" });
});

/* ----------------------------------------------------------------------------
 * Erros fora das requisições
 * -------------------------------------------------------------------------- */
process.on("unhandledRejection", (reason) => {
  // Só registra: uma promessa esquecida não deve derrubar o servidor inteiro
  console.error("[unhandledRejection]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  // Num servidor comum o processo fica em estado incerto: sai e deixa o supervisor reiniciar.
  // Na Vercel a própria plataforma descarta a instância.
  if (!VERCEL) process.exit(1);
});

/* ----------------------------------------------------------------------------
 * Inicialização
 * -------------------------------------------------------------------------- */
// Na Vercel o app é exportado e a plataforma cuida da porta. Fora dela (npm run dev,
// Render, Railway...) abrimos a porta normalmente.
if (!VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(
      `Servidor a correr na porta ${PORT} [${NODE_ENV || "development"}]`,
    );
  });

  server.on("error", (err) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `A porta ${PORT} já está em uso. Feche o outro processo ou mude a PORT.`
        : err,
    );
    process.exit(1);
  });

  // Encerramento limpo: termina as requisições em andamento antes de sair
  const shutdown = (signal) => {
    console.log(`${signal} recebido: encerrando...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref(); // não espera para sempre
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export default app;