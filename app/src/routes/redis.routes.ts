import { Router } from "express";
import { EstruturasRedisController as C } from "../controllers/estruturas-redis.controller.js";

const router = Router();
router.put("/carrinho/:clienteId/itens", C.adicionarItem);
router.get("/carrinho/:clienteId", C.verCarrinho);
router.delete("/carrinho/:clienteId", C.limparCarrinho);
router.get("/ranking/produtos", C.ranking);
export default router;
