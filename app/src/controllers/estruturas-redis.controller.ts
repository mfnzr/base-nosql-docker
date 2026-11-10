import { Request, Response } from "express";
import { responderErro } from "../utils/erros.js";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getRedisPronto } from "../database/redis.js";
import { RANKING_PRODUTOS } from "./pedidos.controller.js";

const chaveCarrinho = (clienteId: string) => `domingueira:carrinho:${clienteId}`;
const TTL_CARRINHO = 60 * 60 * 24; // 24 h, renovado a cada alteração

async function nomesDe(ids: string[]): Promise<Map<string, any>> {
  const validos = ids.filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i));
  const docs = await getCollection("produtos").find({ _id: { $in: validos } }, { projection: { nome: 1, venda: 1 } }).toArray();
  return new Map(docs.map((d) => [d._id.toString(), d]));
}

export class EstruturasRedisController {
  /** HASH — PUT /api/carrinho/:clienteId/itens  Body: { produto_id, quantidade } (HINCRBY; saldo <= 0 remove) */
  static async adicionarItem(req: Request, res: Response): Promise<void> {
    try {
      const { clienteId } = req.params;
      const { produto_id, quantidade } = req.body ?? {};
      const q = Number(quantidade);
      if (!ObjectId.isValid(produto_id) || !Number.isInteger(q) || q === 0) {
        res.status(400).json({ erro: "Informe produto_id válido e quantidade inteira diferente de zero." });
        return;
      }
      const existe = await getCollection("produtos").countDocuments({ _id: new ObjectId(produto_id), ativo: true });
      if (!existe) {
        res.status(404).json({ erro: "Produto inexistente ou inativo." });
        return;
      }
      const redis = getRedisPronto();
      const chave = chaveCarrinho(clienteId);
      const novaQtd = await redis.hincrby(chave, produto_id, q);
      if (novaQtd <= 0) await redis.hdel(chave, produto_id);
      await redis.expire(chave, TTL_CARRINHO);
      res.json({ estrutura: "HASH", chave, produto_id, quantidade_no_carrinho: Math.max(novaQtd, 0) });
    } catch (err: any) {
      responderErro(res, err, "Erro no carrinho");
    }
  }

  /** HASH — GET /api/carrinho/:clienteId (HGETALL + nomes/preços vindos do MongoDB) */
  static async verCarrinho(req: Request, res: Response): Promise<void> {
    try {
      const chave = chaveCarrinho(req.params.clienteId);
      const redis = getRedisPronto();
      const campos = await redis.hgetall(chave);
      const produtos = await nomesDe(Object.keys(campos));
      let total = 0;
      const itens = Object.entries(campos).map(([id, qtd]) => {
        const p = produtos.get(id);
        const preco = p?.venda?.tipo === "PESO" ? p.venda.preco_kg : p?.venda?.preco ?? 0;
        const subtotal = Math.round(preco * Number(qtd) * 100) / 100;
        total += subtotal;
        return { produto_id: id, nome: p?.nome ?? "(removido)", quantidade: Number(qtd), preco_unitario: preco, subtotal };
      });
      const ttl = await redis.ttl(chave);
      res.json({ estrutura: "HASH", chave, ttl_segundos: ttl, itens, total: Math.round(total * 100) / 100 });
    } catch (err: any) {
      responderErro(res, err, "Erro ao ler carrinho");
    }
  }

  /** HASH — DELETE /api/carrinho/:clienteId */
  static async limparCarrinho(req: Request, res: Response): Promise<void> {
    try {
      const chave = chaveCarrinho(req.params.clienteId);
      const removidas = await getRedisPronto().del(chave);
      res.json({ estrutura: "HASH", chave, removido: removidas === 1 });
    } catch (err: any) {
      responderErro(res, err, "Erro ao limpar carrinho");
    }
  }

  /** SORTED SET — GET /api/ranking/produtos?top=5 (ZREVRANGE WITHSCORES: o Redis ordena, o Mongo só dá os nomes) */
  static async ranking(req: Request, res: Response): Promise<void> {
    try {
      const top = Math.min(parseInt((req.query.top as string) ?? "5", 10) || 5, 20);
      const bruto = await getRedisPronto().zrevrange(RANKING_PRODUTOS, 0, top - 1, "WITHSCORES");
      const ids: string[] = [];
      const scores: number[] = [];
      for (let i = 0; i < bruto.length; i += 2) { ids.push(bruto[i]); scores.push(Number(bruto[i + 1])); }
      const produtos = await nomesDe(ids);
      res.json({
        estrutura: "SORTED SET", chave: RANKING_PRODUTOS,
        ranking: ids.map((id, i) => ({ posicao: i + 1, produto_id: id, nome: produtos.get(id)?.nome ?? "(removido)", vendidos: scores[i] })),
      });
    } catch (err: any) {
      responderErro(res, err, "Erro ao ler ranking");
    }
  }
}
