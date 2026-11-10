import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { responderErro } from "../utils/erros.js";

export const COLECAO_CARGA = "pedidos_carga";

/** A consulta mais frequente do app: "meus pedidos entregues", do mais recente para o mais antigo. */
function consulta(clienteId: string, status: string, limite: number) {
  return getCollection(COLECAO_CARGA).find({ cliente_id: new ObjectId(clienteId), status }, { projection: { loja_nome: 1, status: 1, total: 1, criado_em: 1 } }).sort({ criado_em: -1 }).limit(limite);
}

/** Percorre a árvore do plano e lista as etapas (ex.: ["LIMIT", "FETCH", "IXSCAN"]). */
function etapas(no: any, lista: string[] = []): string[] {
  if (!no) return lista;
  lista.push(no.stage);
  etapas(no.inputStage, lista);
  (no.inputStages ?? []).forEach((n: any) => etapas(n, lista));
  return lista;
}

export class DesempenhoController {
  /**
   * GET /api/desempenho/pedidos/:clienteId?status=ENTREGUE&limite=20
   * Rota medida pelo benchmark (usa a coleção pedidos_carga, gravada por npm run seed:carga).
   */
  static async pedidosDoCliente(req: Request, res: Response): Promise<void> {
    try {
      const { clienteId } = req.params;
      if (!ObjectId.isValid(clienteId)) {
        res.status(400).json({ erro: "ID de cliente inválido." });
        return;
      }
      const status = String(req.query.status ?? "ENTREGUE");
      const limite = Math.min(parseInt(String(req.query.limite ?? "20"), 10) || 20, 100);
      const dados = await consulta(clienteId, status, limite).toArray();
      res.json({ origem: "MONGODB", total: dados.length, dados });
    } catch (err: any) {
      responderErro(res, err, "Erro ao listar pedidos");
    }
  }

  /**
   * GET /api/desempenho/explain/:clienteId — resumo do explain("executionStats") da mesma consulta.
   */
  static async explicar(req: Request, res: Response): Promise<void> {
    try {
      const { clienteId } = req.params;
      if (!ObjectId.isValid(clienteId)) {
        res.status(400).json({ erro: "ID de cliente inválido." });
        return;
      }
      const status = String(req.query.status ?? "ENTREGUE");
      const plano: any = await consulta(clienteId, status, 20).explain("executionStats");
      const ex = plano.executionStats;
      const lista = etapas(plano.queryPlanner.winningPlan);
      res.json({
        colecao: COLECAO_CARGA,
        consulta: { cliente_id: clienteId, status, ordenacao: "criado_em desc", limite: 20 },
        etapas: lista.reverse().join(" → "),
        documentos_examinados: ex.totalDocsExamined,
        chaves_examinadas: ex.totalKeysExamined,
        documentos_devolvidos: ex.nReturned,
        tempo_ms: ex.executionTimeMillis,
      });
    } catch (err: any) {
      responderErro(res, err, "Erro ao executar explain");
    }
  }
}
