import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getRedisPronto } from "../database/redis.js";
import { responderErro } from "../utils/erros.js";

export const CHAVE_ENTREGADORES = "domingueira:entregadores:posicao";

function lerPosicao(req: Request): { lat: number; lng: number; raio: number } | null {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const raio = Number(req.query.raio_km ?? 3);
  if ([lat, lng, raio].some((n) => Number.isNaN(n)) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || raio <= 0) return null;
  return { lat, lng, raio };
}

export class PertoController {
  /**
   * GET /api/perto/lojas?lat=-25.3954&lng=-51.4623&raio_km=3
   * Lojas (posição FIXA, no MongoDB) dentro do raio, da mais perto para a mais longe.
   * $geoNear sobre o índice 2dsphere de lojas.endereco.localizacao (GeoJSON [longitude, latitude]).
   */
  static async lojas(req: Request, res: Response): Promise<void> {
    const pos = lerPosicao(req);
    if (!pos) {
      res.status(400).json({ erro: "Informe lat, lng e (opcional) raio_km numéricos. Ex.: ?lat=-25.3954&lng=-51.4623&raio_km=3" });
      return;
    }
    try {
      const lojas = await getCollection("lojas")
        .aggregate([
          {
            $geoNear: {
              near: { type: "Point", coordinates: [pos.lng, pos.lat] }, // GeoJSON: longitude ANTES da latitude
              distanceField: "distancia_m",
              maxDistance: pos.raio * 1000,
              spherical: true,
              key: "endereco.localizacao",
              query: { ativa: true },
            },
          },
          { $sort: { distancia_m: 1 } },
          { $project: { _id: 0, nome: 1, slug: 1, bairro: "$endereco.bairro", distancia_km: { $round: [{ $divide: ["$distancia_m", 1000] }, 2] }, nota_media: "$avaliacao_resumo.media" } },
        ])
        .toArray();
      res.json({ origem: "MONGODB ($geoNear + 2dsphere)", posicao: { lat: pos.lat, lng: pos.lng }, raio_km: pos.raio, total: lojas.length, dados: lojas });
    } catch (err: any) {
      responderErro(res, err, "Erro na busca por raio");
    }
  }

  /**
   * PUT /api/entregadores/:id/posicao   Body: { "lat": -25.39, "lng": -51.46 }
   * Entregador SE MOVE: a posição vive no Redis (GEOADD), que aguenta escrita a cada poucos segundos.
   */
  static async atualizarPosicao(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      if (!ObjectId.isValid(id) || Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
        res.status(400).json({ erro: "ID inválido ou lat/lng inválidos." });
        return;
      }
      const existe = await getCollection("entregadores").countDocuments({ _id: new ObjectId(id), ativo: true });
      if (!existe) {
        res.status(404).json({ erro: "Entregador inexistente ou inativo." });
        return;
      }
      await getRedisPronto().geoadd(CHAVE_ENTREGADORES, lng, lat, id); // GEOADD: longitude ANTES da latitude
      res.json({ estrutura: "GEO (Sorted Set)", chave: CHAVE_ENTREGADORES, entregador_id: id, posicao: { lat, lng } });
    } catch (err: any) {
      responderErro(res, err, "Erro ao atualizar posição");
    }
  }

  /**
   * GET /api/perto/entregadores?lat=-25.3954&lng=-51.4623&raio_km=3
   * Entregadores no raio (posição vinda do Redis, GEOSEARCH), do mais perto para o mais longe.
   */
  static async entregadores(req: Request, res: Response): Promise<void> {
    const pos = lerPosicao(req);
    if (!pos) {
      res.status(400).json({ erro: "Informe lat, lng e (opcional) raio_km numéricos." });
      return;
    }
    try {
      const bruto = (await (getRedisPronto() as any).call(
        "GEOSEARCH", CHAVE_ENTREGADORES, "FROMLONLAT", pos.lng, pos.lat, "BYRADIUS", pos.raio, "km", "ASC", "WITHDIST"
      )) as [string, string][];

      // Nome/veículo vêm do MongoDB (cadastro); a posição vem do Redis.
      const ids = bruto.map(([id]) => new ObjectId(id));
      const cadastro = await getCollection("entregadores").find({ _id: { $in: ids } }, { projection: { nome: 1, veiculo: 1 } }).toArray();
      const porId = new Map(cadastro.map((e) => [e._id.toString(), e]));

      res.json({
        origem: "REDIS (GEOSEARCH)",
        posicao: { lat: pos.lat, lng: pos.lng },
        raio_km: pos.raio,
        total: bruto.length,
        dados: bruto.map(([id, dist]) => ({ entregador_id: id, nome: porId.get(id)?.nome ?? "(desconhecido)", veiculo: porId.get(id)?.veiculo, distancia_km: Number(Number(dist).toFixed(2)) })),
      });
    } catch (err: any) {
      responderErro(res, err, "Erro ao buscar entregadores");
    }
  }
}
