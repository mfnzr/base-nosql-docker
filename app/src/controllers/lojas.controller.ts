import { Request, Response } from "express";
import { getCollection } from "../database/mongo.js";
import { cacheGet, cacheSet } from "../database/redis.js";

export const TTL_CACHE_LOJA = 120; // segundos
export const chaveCacheLoja = (slug: string) => `domingueira:loja:${slug}`;

export class LojasController {
  /**
   * CONSULTA 1 — GET /api/lojas/proximas?lat=-25.3954&lng=-51.4623&limite=5
   * Lojas ativas que ENTREGAM no ponto informado ($geoNear + filtro pelo raio de cada loja).
   */
  static async proximas(req: Request, res: Response): Promise<void> {
    try {
      const lat = parseFloat((req.query.lat as string) ?? "-25.3954");
      const lng = parseFloat((req.query.lng as string) ?? "-51.4623");
      const limite = Math.min(parseInt((req.query.limite as string) ?? "5", 10) || 5, 20);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        res.status(400).json({ erro: "lat e lng devem ser numéricos." });
        return;
      }
      const lojas = await getCollection("lojas")
        .aggregate([
          {
            $geoNear: {
              near: { type: "Point", coordinates: [lng, lat] },
              distanceField: "distancia_m",
              key: "endereco.localizacao",
              spherical: true,
              query: { ativa: true, "atendimento.entrega.ativa": true },
            },
          },
          { $addFields: { distancia_km: { $round: [{ $divide: ["$distancia_m", 1000] }, 2] } } },
          { $match: { $expr: { $lte: ["$distancia_km", "$atendimento.entrega.raio_km"] } } },
          { $sort: { distancia_km: 1 } },
          { $limit: limite },
          {
            $project: {
              _id: 0, nome: 1, slug: 1, bairro: "$endereco.bairro", distancia_km: 1,
              taxa_entrega: "$atendimento.entrega.taxa", pedido_minimo: "$atendimento.entrega.pedido_minimo",
              nota_media: "$avaliacao_resumo.media",
            },
          },
        ])
        .toArray();
      res.json({ origem: "MONGODB ($geoNear)", total: lojas.length, dados: lojas });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar lojas próximas", detalhe: err.message });
    }
  }

  /**
   * GET /api/lojas/:slug — PADRÃO CACHE-ASIDE (Redis → MongoDB, gravação com TTL de 120 s).
   * A chave é invalidada na rota de escrita PUT /api/produtos/:id.
   */
  static async obterPorSlug(req: Request, res: Response): Promise<void> {
    try {
      const slug = req.params.slug;
      const chave = chaveCacheLoja(slug);

      const emCache = await cacheGet<any>(chave);
      if (emCache) {
        res.setHeader("X-Cache", "HIT");
        res.json({ origem: "REDIS_CACHE", chave, dados: emCache });
        return;
      }

      const loja = await getCollection("lojas").findOne({ slug, ativa: true });
      if (!loja) {
        res.status(404).json({ erro: "Loja não encontrada." });
        return;
      }
      await cacheSet(chave, loja, TTL_CACHE_LOJA);

      res.setHeader("X-Cache", "MISS");
      res.json({ origem: `MONGODB (gravado no Redis por ${TTL_CACHE_LOJA}s)`, chave, dados: loja });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao obter loja", detalhe: err.message });
    }
  }
}
