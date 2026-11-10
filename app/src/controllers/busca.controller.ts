import { Request, Response } from "express";
import { getElasticClient } from "../database/elastic.js";
import { INDICE_PRODUTOS } from "../services/sync-elastic.js";

export class BuscaController {
  /**
   * GET /api/busca?q=frnago&categoria=Aves&preco_max=60&bairro=Trianon&sem_alergeno=ovo
   *  - multi_match em nome (peso 3), descricao (2), ingredientes (1.5) e loja_nome (1)
   *  - fuzziness AUTO: tolera erro de digitação
   *  - bool.filter: filtros exatos (não influenciam o score)
   */
  static async buscar(req: Request, res: Response): Promise<void> {
    try {
      const { q, categoria, preco_max, bairro, sem_alergeno } = req.query as Record<string, string>;
      if (!q || !q.trim()) {
        res.status(400).json({ erro: "Parâmetro 'q' é obrigatório. Ex.: /api/busca?q=frango" });
        return;
      }
      const filter: any[] = [{ term: { disponivel: true } }];
      if (categoria) filter.push({ term: { categoria } });
      if (bairro) filter.push({ term: { bairro } });
      if (preco_max) filter.push({ range: { preco: { lte: parseFloat(preco_max) } } });
      const must_not = sem_alergeno ? [{ term: { alergenos: sem_alergeno } }] : [];

      const r = await getElasticClient().search({
        index: INDICE_PRODUTOS,
        size: 10,
        query: {
          bool: {
            must: [{ multi_match: { query: q, fields: ["nome^3", "descricao^2", "ingredientes^1.5", "loja_nome"], fuzziness: "AUTO", prefix_length: 1 } }],
            filter,
            must_not,
          },
        },
      });
      res.json({
        origem: "ELASTICSEARCH",
        termo: q,
        total: typeof r.hits.total === "number" ? r.hits.total : r.hits.total?.value ?? 0,
        resultados: r.hits.hits.map((h: any) => ({
          score: Number(h._score.toFixed(2)), produto: h._source.nome, loja: h._source.loja_nome,
          categoria: h._source.categoria, preco: h._source.preco, tipo_venda: h._source.tipo_venda, bairro: h._source.bairro,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro na busca", detalhe: err.message, dica: "O índice 'produtos' existe? Rode ./iniciar.sh." });
    }
  }
}
