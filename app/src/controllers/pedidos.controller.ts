import { Request, Response } from "express";
import { responderErro } from "../utils/erros.js";
import { ObjectId, MongoWriteConcernError } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getRedisPronto } from "../database/redis.js";

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
   * ESCRITA CRÍTICA — POST /api/pedidos
   * Body: { cliente_id, loja_id, tipo_entrega: "ENTREGA"|"RETIRADA", endereco_idx?: 0,
   *         itens: [{ produto_id, quantidade }] }
   * Um pedido pago NÃO pode ser perdido: gravado com writeConcern { w: "majority" } explícito,
   * isto é, só é confirmado depois que a maioria dos nós do replica set guardou o dado.
   * Preços e nomes são copiados do catálogo (snapshot imutável).
   */
  static async criar(req: Request, res: Response): Promise<void> {
    try {
      const { cliente_id, loja_id, tipo_entrega, endereco_idx, itens } = req.body ?? {};
      if (!ObjectId.isValid(cliente_id) || !ObjectId.isValid(loja_id) || !["ENTREGA", "RETIRADA"].includes(tipo_entrega) || !Array.isArray(itens) || itens.length === 0) {
        res.status(400).json({ erro: "Informe cliente_id, loja_id, tipo_entrega (ENTREGA|RETIRADA) e itens [{produto_id, quantidade}]." });
        return;
      }
      const cliente = await getCollection("usuarios").findOne({ _id: new ObjectId(cliente_id), papel: "CLIENTE" });
      const loja = await getCollection("lojas").findOne({ _id: new ObjectId(loja_id), ativa: true });
      if (!cliente || !loja) {
        res.status(404).json({ erro: "Cliente ou loja não encontrados." });
        return;
      }
      if (itens.some((i: any) => !ObjectId.isValid(i?.produto_id) || !(Number(i?.quantidade) > 0))) {
        res.status(400).json({ erro: "Cada item precisa de produto_id válido e quantidade maior que zero." });
        return;
      }
      const ids = itens.map((i: any) => new ObjectId(i.produto_id));
      const produtos = await getCollection("produtos").find({ _id: { $in: ids }, loja_id: loja._id, ativo: true }).toArray();
      const porId = new Map(produtos.map((p) => [p._id.toString(), p]));
      if (itens.some((i: any) => !porId.has(i.produto_id))) {
        res.status(422).json({ erro: "Algum produto não existe, está inativo ou não pertence a esta loja." });
        return;
      }

      const itensPedido = itens.map((i: any) => {
        const p = porId.get(i.produto_id)!;
        const unit = p.venda.tipo === "PESO" ? p.venda.preco_kg : p.venda.preco;
        const quantidade = Number(i.quantidade);
        return { produto_id: p._id, nome: p.nome, tipo_venda: p.venda.tipo, quantidade, preco_unitario: unit, subtotal: Math.round(unit * quantidade * 100) / 100 };
      });
      const subtotal = Math.round(itensPedido.reduce((t: number, i: any) => t + i.subtotal, 0) * 100) / 100;

      let endereco: any = null;
      let taxa = 0;
      if (tipo_entrega === "ENTREGA") {
        if (!loja.atendimento?.entrega?.ativa) {
          res.status(422).json({ erro: "Esta loja não faz entrega." });
          return;
        }
        if (subtotal < loja.atendimento.entrega.pedido_minimo) {
          res.status(422).json({ erro: `Pedido mínimo para entrega: R$ ${loja.atendimento.entrega.pedido_minimo.toFixed(2)}.` });
          return;
        }
        const { apelido, ...resto } = cliente.enderecos?.[Number(endereco_idx ?? 0)] ?? ({} as any);
        if (!resto.logradouro) {
          res.status(422).json({ erro: "Endereço do cliente não encontrado (endereco_idx)." });
          return;
        }
        endereco = resto;
        taxa = loja.atendimento.entrega.taxa;
      }

      const agora = new Date();
      const pedido = {
        _id: new ObjectId(), cliente_id: cliente._id, loja_id: loja._id, loja_nome: loja.nome, tipo_entrega, endereco_entrega: endereco,
        itens: itensPedido, subtotal, taxa_entrega: taxa, total: Math.round((subtotal + taxa) * 100) / 100,
        status: "PENDENTE", historico: [{ status: "PENDENTE", em: agora }], pagamento: { forma: "PIX", status: "PAGO" },
        criado_em: agora, atualizado_em: agora,
      };

      try {
        // writeConcern EXPLÍCITO: a gravação só é confirmada quando a maioria dos nós a tem.
        await getCollection("pedidos").insertOne(pedido, { writeConcern: { w: "majority", wtimeout: 5000 } });
      } catch (err: any) {
        if (err instanceof MongoWriteConcernError) {
          // ATENÇÃO: este erro NÃO significa "não gravou". O primário JÁ gravou o pedido; o que não
          // deu tempo foi a confirmação da maioria. Repetir o POST criaria um pedido DUPLICADO.
          res.status(202).json({
            situacao: "GRAVADO_AGUARDANDO_CONFIRMACAO",
            aviso: "O pedido foi gravado, mas a confirmação da maioria dos nós não chegou a tempo. NÃO repita o envio: consulte o pedido pelo id.",
            pedido_id: pedido._id,
            detalhe: err.message,
          });
          return;
        }
        throw err;
      }
      res.status(201).json({ mensagem: "Pedido gravado e confirmado pela maioria dos nós (w: majority).", dados: pedido });
    } catch (err: any) {
      responderErro(res, err, "Erro ao criar pedido");
    }
  }

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
      responderErro(res, err, "Erro ao buscar histórico");
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
          const pipe = getRedisPronto().pipeline();
          for (const item of pedido.itens) pipe.zincrby(RANKING_PRODUTOS, Math.ceil(item.quantidade), item.produto_id.toString());
          await pipe.exec();
        } catch { /* ranking é derivado; falha não desfaz o pedido */ }
      }
      res.json({ mensagem: `Pedido atualizado para ${novo}.`, dados: pedido });
    } catch (err: any) {
      responderErro(res, err, "Erro ao atualizar status");
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
      responderErro(res, err, "Erro ao gerar relatório");
    }
  }
}
