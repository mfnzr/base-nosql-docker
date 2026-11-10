import { Router } from "express";
import { PertoController } from "../controllers/perto.controller.js";

const router = Router();
router.get("/perto/lojas", PertoController.lojas);
router.get("/perto/entregadores", PertoController.entregadores);
router.put("/entregadores/:id/posicao", PertoController.atualizarPosicao);
export default router;
