import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { sessionConfig } from "./src/config/session.js";
import { validateEnv } from "./src/services/patreonService.js";
import { revalidateSubscription } from "./src/middlewares/authMiddleware.js";
import authRoutes from "./src/routes/authRoutes.js";
import gameRoutes from "./src/routes/gameRoutes.js";

const { NODE_ENV, FRONTEND_URL, PORT = 3000 } = process.env;
const isProd = NODE_ENV === "production";

// Falha logo ao iniciar se faltar configuração (em vez de falhar no primeiro login)
validateEnv();
if (isProd && !FRONTEND_URL) {
  throw new Error("FRONTEND_URL é obrigatório em produção");
}

const app = express();

// Atrás de proxy/HTTPS o Express precisa confiar no proxy; sem isso o cookie "secure" nunca é gravado.
if (isProd) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet());

// Lista de origens permitidas (inclui desenvolvimento local e produção)
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5500",
  FRONTEND_URL,
  "https://kuro-api-63m7.vercel.app"
].filter(Boolean); // Remove valores vazios ou duplicados

app.use(
  cors({
    origin: function (origin, callback) {
      // Permite requisições sem origin (como Postman ou chamadas server-to-server)
      if (!origin) return callback(null, true);

      // Verifica se a origem está na lista permitida ou se é um preview/produção da Vercel
      if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        console.warn(`[cors] BLOQUEADO: origem "${origin}" não está permitida.`);
        callback(new Error("Bloqueado pela política de CORS"));
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10kb" }));
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