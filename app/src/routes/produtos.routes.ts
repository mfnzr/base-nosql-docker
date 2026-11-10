import { Router } from "express";
import { ProdutosController } from "../controllers/produtos.controller.js";

const router = Router();
router.get("/", ProdutosController.filtrar);
router.post("/", ProdutosController.criar);
router.put("/:id", ProdutosController.atualizar);
export default router;
