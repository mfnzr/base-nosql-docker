import { Router } from "express";
import { LojasController } from "../controllers/lojas.controller.js";

const router = Router();
router.get("/proximas", LojasController.proximas); // antes de /:slug
router.get("/:slug", LojasController.obterPorSlug);
export default router;
