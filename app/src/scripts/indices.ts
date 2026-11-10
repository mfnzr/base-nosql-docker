import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";
import { COLECAO_CARGA } from "../controllers/desempenho.controller.js";

/**
 * Índice da consulta "pedidos entregues de um cliente, do mais recente para o mais antigo".
 * Ordem das chaves (regra ESR): igualdade (cliente_id, status) e depois ordenação (criado_em).
 *   npm run indice:criar    → cria o índice composto
 *   npm run indice:remover  → remove (volta ao estado "sem índice" da carga)
 */
const NOME = "cliente_status_data";
const acao = process.argv[2];

async function main() {
  if (!["criar", "remover", "listar"].includes(acao)) {
    console.error("Uso: tsx src/scripts/indices.ts criar|remover|listar");
    process.exit(1);
  }
  await connectMongo();
  const col = getCollection(COLECAO_CARGA);
  if (acao === "criar") {
    await col.createIndex({ cliente_id: 1, status: 1, criado_em: -1 }, { name: NOME });
    console.log(`[Índice] "${NOME}" criado em ${COLECAO_CARGA}.`);
  } else if (acao === "remover") {
    await col.dropIndex(NOME).catch(() => console.log(`[Índice] "${NOME}" não existia.`));
    console.log(`[Índice] "${NOME}" removido de ${COLECAO_CARGA}.`);
  }
  console.log("[Índice] Índices atuais:", (await col.indexes()).map((i) => i.name).join(", "));
  await closeMongo();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
