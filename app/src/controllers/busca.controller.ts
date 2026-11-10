import { Request, Response } from "express";
import { getElasticClient } from "../database/elastic.js";
import { getCollection } from "../database/mongo.js";
import { responderErro } from "../utils/erros.js";
import { comLimite } from "../database/redis.js";
import { INDICE_PRODUTOS } from "../services/sync-elastic.js";

const LIMITE_ELASTIC_MS = 1500;
const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class BuscaController {
  /**
   * GET /api/busca?q=frnago&categoria=Aves&preco_max=60&bairro=Trianon&sem_alergeno=ovo
   *  - multi_match em nome (peso 3), descricao (2), ingredientes (1.5) e loja_nome (1)
   *  - fuzziness AUTO: tolera erro de digitação
   *  - bool.filter: filtros exatos (não influenciam o score)
   *
   * RESILIÊNCIA: se o Elasticsearch estiver fora do ar, responde com uma busca simples no
   * MongoDB (regex em nome/descrição/ingredientes) e um aviso na resposta. Se o MongoDB
   * também cair, responde 503.
   */
  static async buscar(req: Request, res: Response): Promise<void> {
    const { q, categoria, preco_max, bairro, sem_alergeno } = req.query as Record<string, string>;
    if (!q || !q.trim()) {
      res.status(400).json({ erro: "Parâmetro 'q' é obrigatório. Ex.: /api/busca?q=frango" });
      return;
    }

    try {
      const filter: any[] = [{ term: { disponivel: true } }];
      if (categoria) filter.push({ term: { categoria } });
      if (bairro) filter.push({ term: { bairro } });
      if (preco_max) filter.push({ range: { preco: { lte: parseFloat(preco_max) } } });
      const must_not = sem_alergeno ? [{ term: { alergenos: sem_alergeno } }] : [];

      // comLimite: a rota desiste em 1,5 s mesmo que o DNS/conexão do Elasticsearch demore (container parado)
      const r = await comLimite(getElasticClient().search(
        {
          index: INDICE_PRODUTOS,
          size: 10,
          query: {
            bool: {
              must: [{ multi_match: { query: q, fields: ["nome^3", "descricao^2", "ingredientes^1.5", "loja_nome"], fuzziness: "AUTO", prefix_length: 1 } }],
              filter,
              must_not,
            },
          },
        },
        { requestTimeout: LIMITE_ELASTIC_MS, maxRetries: 0 }
      ), LIMITE_ELASTIC_MS);
      res.json({
        origem: "ELASTICSEARCH",
        termo: q,
        total: typeof r.hits.total === "number" ? r.hits.total : r.hits.total?.value ?? 0,
        resultados: r.hits.hits.map((h: any) => ({
          score: Number(h._score.toFixed(2)), produto: h._source.nome, loja: h._source.loja_nome,
          categoria: h._source.categoria, preco: h._source.preco, tipo_venda: h._source.tipo_venda, bairro: h._source.bairro,
        })),
      });
      return;
    } catch {
      // Elasticsearch fora do ar (ou índice ausente): segue para a busca simples no MongoDB.
    }

    try {
      const regex = { $regex: escaparRegex(q.trim()), $options: "i" };
      const filtro: Record<string, any> = { ativo: true, $or: [{ nome: regex }, { descricao: regex }, { ingredientes: regex }] };
      if (categoria) filtro.categoria = categoria;
      if (sem_alergeno) filtro.alergenos = { $nin: [sem_alergeno] };
      if (preco_max) filtro["venda.preco"] = { $lte: parseFloat(preco_max) };

      const produtos = await getCollection("produtos")
        .find(filtro, { projection: { nome: 1, categoria: 1, venda: 1, loja_id: 1 } })
        .limit(10)
        .toArray();
      res.json({
        origem: "MONGODB (busca simples, Elasticsearch fora do ar)",
        aviso: "Elasticsearch indisponível: busca simples por trecho do texto, sem relevância e sem tolerância a erro de digitação" + (bairro ? "; o filtro 'bairro' não é aplicado nesta busca." : "."),
        termo: q,
        total: produtos.length,
        resultados: produtos.map((p: any) => ({
          produto: p.nome, categoria: p.categoria, preco: p.venda?.tipo === "PESO" ? p.venda.preco_kg : p.venda?.preco, tipo_venda: p.venda?.tipo, loja_id: p.loja_id,
        })),
      });
    } catch (err: any) {
      responderErro(res, err, "Erro na busca");
    }
  }
}
