import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import { connectMongo, closeMongo } from "./database/mongo.js";
import { connectRedis, closeRedis } from "./database/redis.js";
import { connectElastic, closeElastic } from "./database/elastic.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3400;

// Middlewares
app.use(cors());
app.use(express.json());

// Rota raiz com mapa simples da API
app.get("/", (req: Request, res: Response) => {
  res.json({
    titulo: "Domingueira — assados e comidas de fim de semana (Guarapuava)",
    disciplina: "Banco de Dados NoSQL (TSI34E-TSI4)",
    endpoints: {
      health: "GET /api/health",
      lojas_proximas: "GET /api/lojas/proximas?lat=&lng=",
      loja_cache_aside: "GET /api/lojas/:slug",
      produtos_filtro: "GET /api/produtos?categoria=&preco_max=",
      faturamento: "GET /api/relatorios/faturamento",
      historico_cliente: "GET /api/pedidos/cliente/:id",
      status_pedido: "PATCH /api/pedidos/:id/status",
      carrinho_redis: "PUT|GET|DELETE /api/carrinho/:clienteId",
      ranking_redis: "GET /api/ranking/produtos",
      busca_elastic: "GET /api/busca?q=",
      escrita_sincronizada: "PUT /api/produtos/:id",
    },
    interfaces_web: {
      elasticvue: "http://localhost:8400",
      mongo_express: "http://localhost:8401",
      redis_commander: "http://localhost:8402",
    },
  });
});

// Rotas da API
app.use("/api", routes);

// Inicialização dos bancos e servidor HTTP
async function bootstrap() {
  console.log("\n=======================================================");
  console.log("  Iniciando conexões com os bancos NoSQL...");
  console.log("=======================================================");

  try {
    await connectMongo();
  } catch (err: any) {
    console.error(`[MongoDB] Erro na inicialização: ${err.message}`);
  }

  try {
    await connectRedis();
  } catch (err: any) {
    console.error(`[Redis] Erro na inicialização: ${err.message}`);
  }

  try {
    await connectElastic();
  } catch (err: any) {
    console.warn(`[Elasticsearch] Aviso: Cluster não respondeu no startup (${err.message}).`);
  }

  const server = app.listen(PORT, () => {
    console.log("\n🚀 Servidor Express rodando com sucesso!");
    console.log(`📡 URL Principal: http://localhost:${PORT}`);
    console.log(`🩺 Health Check:  http://localhost:${PORT}/api/health`);
    console.log("=======================================================\n");
  });

  const shutdown = async () => {
    console.log("\nEncerrando conexões...");
    server.close();
    await closeMongo();
    await closeRedis();
    await closeElastic();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap();
