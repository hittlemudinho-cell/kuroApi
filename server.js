import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { sessionConfig } from "./src/config/session.js";
import { validateEnv } from "./src/services/patreonService.js";
import { revalidateSubscription } from "./src/middlewares/authMiddleware.js";
import authRoutes from "./src/routes/authRoutes.js";
import gameRoutes from "./src/routes/gameRoutes.js";

const { NODE_ENV, FRONTEND_URL, CORS_ORIGINS, PORT = 3000 } = process.env;
const isProd = NODE_ENV === "production";

// Falha logo ao iniciar se faltar configuração (em vez de falhar no primeiro login)
validateEnv();
if (isProd && !FRONTEND_URL) {
  throw new Error("FRONTEND_URL é obrigatório em produção");
}

const app = express();

// Atrás de proxy/HTTPS (Render, Railway, Heroku, Nginx...) o Express precisa confiar
// no proxy; sem isso o cookie "secure" nunca é gravado.
if (isProd) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet());
// Origens do front autorizadas a chamar a API (CORS). Aceita várias, separadas por vírgula:
//   CORS_ORIGINS=http://localhost:5173,https://meusite.com
// Se não for definida, usa só o FRONTEND_URL. Sem barra no final, com http(s)://
const allowedOrigins = (CORS_ORIGINS || FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Sem "Origin" = chamada direta (curl, health check): não é navegador, deixa passar
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(null, false); // origem não autorizada: sem cabeçalhos CORS
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "10kb" })); // limite de tamanho
app.use(express.urlencoded({ extended: true }));

app.use(sessionConfig);

// Reconfere a assinatura no Patreon quando o prazo vence (padrão: 1 hora)
app.use(["/auth/session", "/api"], revalidateSubscription);

app.use("/auth", authRoutes);
app.use("/api", gameRoutes);

app.get("/", (req, res) => {
  res.json({ status: "API do Patreon e Jogos a funcionar corretamente!" });
});

// Tratamento de erros genérico
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

app.listen(PORT, () => {
  console.log(
    `Servidor a correr na porta ${PORT} [${NODE_ENV || "development"}]`,
  );
});