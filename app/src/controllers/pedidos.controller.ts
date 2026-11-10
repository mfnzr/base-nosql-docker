import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";

// Máquina de estados: status novo → status anteriores permitidos
const ANTERIORES: Record<string, string[]> = {
  CONFIRMADO: ["PENDENTE"],
  PRONTO: ["CONFIRMADO"],
  ENTREGUE: ["PRONTO"],
  CANCELADO: ["PENDENTE", "CONFIRMADO"],
};
export const RANKING_PRODUTOS = "domingueira:ranking:produtos";

export class PedidosController {
  /**
   * CONSULTA 4 — GET /api/pedidos/cliente/:clienteId?limite=10
   * Histórico do cliente com projeção enxuta para a tela mobile.
   */
  static async historico(req: Request, res: Response): Promise<void> {
    try {
      const { clienteId } = req.params;
      if (!ObjectId.isValid(clienteId)) {
        res.status(400).json({ erro: "ID de cliente inválido." });
        return;
      }
      const limite = Math.min(parseInt((req.query.limite as string) ?? "10", 10) || 10, 50);
      const pedidos = await getCollection("pedidos")
        .aggregate([
          { $match: { cliente_id: new ObjectId(clienteId) } },
          { $sort: { criado_em: -1 } },
          { $limit: limite },
          { $project: { loja_nome: 1, status: 1, total: 1, tipo_entrega: 1, criado_em: 1, qtd_itens: { $size: "$itens" } } },
        ])
        .toArray();
      res.json({ origem: "MONGODB", total: pedidos.length, dados: pedidos });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao buscar histórico", detalhe: err.message });
    }
  }

  /**
   * CONSULTA 5 — PATCH /api/pedidos/:id/status  Body: { "status": "PRONTO" }
   * Atualização atômica: só muda se o pedido estiver num status anterior válido ($set + $push).
   * Ao marcar ENTREGUE, soma as quantidades ao ranking de vendas do Redis (Sorted Set).
   */
  static async atualizarStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const novo = req.body?.status as string;
      if (!ObjectId.isValid(id) || !ANTERIORES[novo]) {
        res.status(400).json({ erro: "ID inválido ou status inválido.", status_aceitos: Object.keys(ANTERIORES) });
        return;
      }
      const agora = new Date();
      const pedido = await getCollection("pedidos").findOneAndUpdate(
        { _id: new ObjectId(id), status: { $in: ANTERIORES[novo] } },
        { $set: { status: novo, atualizado_em: agora }, $push: { historico: { status: novo, em: agora } } as any },
        { returnDocument: "after" }
      );
      if (!pedido) {
        res.status(409).json({ erro: `Pedido inexistente ou não pode ir para ${novo} a partir do status atual.` });
        return;
      }
      if (novo === "ENTREGUE") {
        try {
          const pipe = getRedisClient().pipeline();
          for (const item of pedido.itens) pipe.zincrby(RANKING_PRODUTOS, Math.ceil(item.quantidade), item.produto_id.toString());
          await pipe.exec();
        } catch { /* ranking é derivado; falha não desfaz o pedido */ }
      }
      res.json({ mensagem: `Pedido atualizado para ${novo}.`, dados: pedido });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao atualizar status", detalhe: err.message });
    }
  }

  /**
   * CONSULTA 3 — GET /api/relatorios/faturamento?desde=2026-10-01
   * Faturamento por loja com taxa da plataforma ($group + $lookup + $project).
   */
  static async faturamento(req: Request, res: Response): Promise<void> {
    try {
      const filtro: Record<string, any> = { status: "ENTREGUE" };
      if (req.query.desde) filtro.criado_em = { $gte: new Date(req.query.desde as string) };
      const dados = await getCollection("pedidos")
        .aggregate([
          { $match: filtro },
          { $group: { _id: "$loja_id", pedidos: { $sum: 1 }, faturamento_bruto: { $sum: "$total" }, ticket_medio: { $avg: "$total" } } },
          { $lookup: { from: "lojas", localField: "_id", foreignField: "_id", as: "loja", pipeline: [{ $project: { nome: 1, taxa_plataforma_percentual: 1 } }] } },
          { $unwind: "$loja" },
          {
            $project: {
              _id: 0, loja: "$loja.nome", pedidos: 1,
              faturamento_bruto: { $round: ["$faturamento_bruto", 2] },
              ticket_medio: { $round: ["$ticket_medio", 2] },
              taxa_plataforma: { $round: [{ $multiply: ["$faturamento_bruto", { $divide: ["$loja.taxa_plataforma_percentual", 100] }] }, 2] },
            },
          },
          { $sort: { faturamento_bruto: -1 } },
        ])
        .toArray();
      res.json({ origem: "MONGODB (aggregation)", total: dados.length, dados });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao gerar relatório", detalhe: err.message });
    }
  }
}
