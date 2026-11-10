import { Router, Request, Response } from "express";
import { getDb } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { getElasticClient } from "../database/elastic.js";
import { ProdutosController } from "../controllers/produtos.controller.js";
import { PedidosController } from "../controllers/pedidos.controller.js";
import lojasRoutes from "./lojas.routes.js";
import produtosRoutes from "./produtos.routes.js";
import pedidosRoutes from "./pedidos.routes.js";
import redisRoutes from "./redis.routes.js";
import buscaRoutes from "./busca.routes.js";

const routes = Router();

routes.get("/health", async (_req: Request, res: Response) => {
  const status: Record<string, any> = { timestamp: new Date().toISOString(), status_geral: "OK", bancos: {} };
  try {
    const db = getDb();
    await db.command({ ping: 1 });
    status.bancos.mongodb = { status: "ONLINE", database: db.databaseName };
  } catch (err: any) { status.bancos.mongodb = { status: "OFFLINE", erro: err.message }; status.status_geral = "PARCIAL"; }
  try {
    status.bancos.redis = { status: "ONLINE", resposta: await getRedisClient().ping() };
  } catch (err: any) { status.bancos.redis = { status: "OFFLINE", erro: err.message }; status.status_geral = "PARCIAL"; }
  try {
    const h = await getElasticClient().cluster.health({});
    status.bancos.elasticsearch = { status: "ONLINE", cluster_status: h.status };
  } catch (err: any) { status.bancos.elasticsearch = { status: "OFFLINE", erro: err.message }; status.status_geral = "PARCIAL"; }
  res.status(status.status_geral === "OK" ? 200 : 207).json(status);
});

routes.use("/lojas", lojasRoutes);
routes.use("/produtos", produtosRoutes);
routes.use("/pedidos", pedidosRoutes);
routes.get("/relatorios/faturamento", PedidosController.faturamento);
routes.use("/", redisRoutes);
routes.use("/busca", buscaRoutes);
routes.post("/sync/reprocessar", ProdutosController.reprocessar);

export default routes;
