import { Router } from "express";
import { PedidosController } from "../controllers/pedidos.controller.js";

const router = Router();
router.get("/cliente/:clienteId", PedidosController.historico);
router.patch("/:id/status", PedidosController.atualizarStatus);
export default router;
