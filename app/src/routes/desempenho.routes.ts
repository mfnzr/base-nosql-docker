import { Router } from "express";
import { DesempenhoController } from "../controllers/desempenho.controller.js";

const router = Router();
router.get("/pedidos/:clienteId", DesempenhoController.pedidosDoCliente);
router.get("/explain/:clienteId", DesempenhoController.explicar);
export default router;
