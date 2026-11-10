import { Router } from "express";
import { BuscaController } from "../controllers/busca.controller.js";

const router = Router();
router.get("/", BuscaController.buscar);
export default router;
