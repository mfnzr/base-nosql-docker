import { Request, Response } from "express";
import { responderErro } from "../utils/erros.js";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { cacheDel } from "../database/redis.js";
import { chaveCacheLoja } from "./lojas.controller.js";
import { sincronizarProduto, reprocessarPendentes } from "../services/sync-elastic.js";

export class ProdutosController {
  /**
   * CONSULTA 2 — GET /api/produtos?categoria=Carnes&preco_max=60&sem_alergeno=ovo&ordem=preco
   * Filtro por múltiplos critérios, ordenação e projeção enxuta (telas mobile).
   */
  static async filtrar(req: Request, res: Response): Promise<void> {
    try {
      const { categoria, preco_max, sem_alergeno, ordem } = req.query as Record<string, string>;
      const filtro: Record<string, any> = { ativo: true };
      if (categoria) filtro.categoria = categoria;
      if (sem_alergeno) filtro.alergenos = { $nin: [sem_alergeno] };
      if (preco_max) filtro["venda.preco"] = { $lte: parseFloat(preco_max) };

      const produtos = await getCollection("produtos")
        .find(filtro, { projection: { nome: 1, categoria: 1, venda: 1, loja_id: 1, alergenos: 1 } })
        .sort(ordem === "preco" ? { "venda.preco": 1 } : { nome: 1 })
        .limit(50)
        .toArray();
      res.json({ origem: "MONGODB", filtros: filtro, total: produtos.length, dados: produtos });
    } catch (err: any) {
      responderErro(res, err, "Erro ao filtrar produtos");
    }
  }

  /**
   * ESCRITA COM SINCRONIZAÇÃO — PUT /api/produtos/:id
   * Body (qualquer subconjunto): { descricao, preco, preco_kg, ativo, nome }
   *  1. MongoDB (fonte da verdade): produtos + cópia embutida em lojas.cardapio
   *  2. Elasticsearch: reindexa o documento (falha → fila sync_pendentes)
   *  3. Redis: invalida o cache da loja
   */
  static async atualizar(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID inválido." });
        return;
      }
      const _id = new ObjectId(id);
      const { nome, descricao, preco, preco_kg, ativo } = req.body ?? {};

      const setProduto: Record<string, any> = { atualizado_em: new Date() };
      const setCardapio: Record<string, any> = {};
      if (nome !== undefined) { setProduto.nome = nome; setCardapio["cardapio.$[c].nome"] = nome; }
      if (descricao !== undefined) setProduto.descricao = descricao;
      if (preco !== undefined) { setProduto["venda.preco"] = Number(preco); setCardapio["cardapio.$[c].venda.preco"] = Number(preco); }
      if (preco_kg !== undefined) { setProduto["venda.preco_kg"] = Number(preco_kg); setCardapio["cardapio.$[c].venda.preco_kg"] = Number(preco_kg); }
      if (ativo !== undefined) { setProduto.ativo = !!ativo; setCardapio["cardapio.$[c].ativo"] = !!ativo; }

      // 1. MongoDB
      const produto = await getCollection("produtos").findOneAndUpdate({ _id }, { $set: setProduto }, { returnDocument: "after" });
      if (!produto) {
        res.status(404).json({ erro: "Produto não encontrado." });
        return;
      }
      const lojaFiltro = { _id: produto.loja_id };
      if (Object.keys(setCardapio).length > 0) {
        await getCollection("lojas").updateOne(
          lojaFiltro,
          { $set: { ...setCardapio, atualizada_em: new Date() } },
          { arrayFilters: [{ "c.produto_id": _id }] }
        );
      }

      // 2. Elasticsearch (best-effort + fila durável)
      const sync = await sincronizarProduto(_id);

      // 3. Redis
      const loja = await getCollection("lojas").findOne(lojaFiltro, { projection: { slug: 1 } });
      const invalidou = loja ? await cacheDel(chaveCacheLoja(loja.slug)) : true;
      const cache = invalidou ? "INVALIDADO" : "INDISPONIVEL (Redis fora do ar; o cache expira pelo TTL de 120 s)";

      res.json({
        mensagem: "Produto atualizado no MongoDB.",
        elasticsearch: sync.status === "OK" ? "REINDEXADO" : `PENDENTE (${sync.erro})`,
        cache_redis: cache,
        dados: produto,
      });
    } catch (err: any) {
      responderErro(res, err, "Erro ao atualizar produto");
    }
  }

  /** POST /api/produtos — cadastro (mesma sincronização). Body: { loja_id, nome, categoria, descricao, ingredientes[], alergenos[], preco } */
  static async criar(req: Request, res: Response): Promise<void> {
    try {
      const { loja_id, nome, categoria, descricao, ingredientes, alergenos, preco } = req.body ?? {};
      if (!loja_id || !ObjectId.isValid(loja_id) || !nome || !categoria || preco === undefined) {
        res.status(400).json({ erro: "Campos obrigatórios: loja_id, nome, categoria, preco." });
        return;
      }
      const loja = await getCollection("lojas").findOne({ _id: new ObjectId(loja_id) });
      if (!loja) {
        res.status(404).json({ erro: "Loja não encontrada." });
        return;
      }
      const agora = new Date();
      const produto = {
        _id: new ObjectId(), loja_id: loja._id, nome, categoria, descricao: descricao ?? "",
        ingredientes: ingredientes ?? [], alergenos: alergenos ?? [],
        venda: { tipo: "UNIDADE", preco: Number(preco) }, estoque: { limitado: false, quantidade: null },
        ativo: true, criado_em: agora, atualizado_em: agora,
      };
      await getCollection("produtos").insertOne(produto);
      await getCollection("lojas").updateOne(
        { _id: loja._id },
        { $push: { cardapio: { produto_id: produto._id, nome, venda: produto.venda, estoque: { limitado: false }, ativo: true } } as any, $set: { atualizada_em: agora } }
      );
      const sync = await sincronizarProduto(produto._id);
      const cache = (await cacheDel(chaveCacheLoja(loja.slug))) ? "INVALIDADO" : "INDISPONIVEL (Redis fora do ar; o cache expira pelo TTL de 120 s)";
      res.status(201).json({ mensagem: "Produto criado.", elasticsearch: sync.status === "OK" ? "INDEXADO" : `PENDENTE (${sync.erro})`, cache_redis: cache, dados: produto });
    } catch (err: any) {
      responderErro(res, err, "Erro ao criar produto");
    }
  }

  /** POST /api/sync/reprocessar — reenvia ao Elasticsearch o que ficou na fila sync_pendentes. */
  static async reprocessar(_req: Request, res: Response): Promise<void> {
    try {
      res.json(await reprocessarPendentes());
    } catch (err: any) {
      responderErro(res, err, "Erro ao reprocessar");
    }
  }
}
