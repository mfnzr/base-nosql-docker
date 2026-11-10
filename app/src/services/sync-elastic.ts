import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getElasticClient } from "../database/elastic.js";

export const INDICE_PRODUTOS = "produtos";

/** Monta o documento do índice a partir de um produto + sua loja (MongoDB é a fonte da verdade). */
export function montarDocumento(produto: any, loja: any) {
  const preco = produto.venda?.tipo === "PESO" ? produto.venda.preco_kg : produto.venda?.preco;
  return {
    produto_id: produto._id.toString(),
    loja_id: produto.loja_id.toString(),
    loja_slug: loja?.slug ?? null,
    loja_nome: loja?.nome ?? "",
    nome: produto.nome,
    descricao: produto.descricao ?? "",
    ingredientes: Array.isArray(produto.ingredientes) ? produto.ingredientes.join(", ") : produto.ingredientes ?? "",
    categoria: produto.categoria,
    alergenos: produto.alergenos ?? [],
    tipo_venda: produto.venda?.tipo ?? "UNIDADE",
    bairro: loja?.endereco?.bairro ?? null,
    cidade: loja?.endereco?.cidade ?? null,
    preco,
    disponivel: produto.ativo !== false,
  };
}

/** (Re)indexa um produto lendo o estado atual do MongoDB. refresh=wait_for faz a busca enxergar o dado na hora. */
export async function indexarProduto(produtoId: ObjectId): Promise<void> {
  const produto = await getCollection("produtos").findOne({ _id: produtoId });
  if (!produto) {
    await getElasticClient().delete({ index: INDICE_PRODUTOS, id: produtoId.toString(), refresh: "wait_for" }, { ignore: [404] });
    return;
  }
  const loja = await getCollection("lojas").findOne({ _id: produto.loja_id });
  await getElasticClient().index({
    index: INDICE_PRODUTOS,
    id: produtoId.toString(),
    document: montarDocumento(produto, loja),
    refresh: "wait_for",
  });
}

/** Tenta indexar; se o Elasticsearch falhar, registra na fila durável sync_pendentes (MongoDB). */
export async function sincronizarProduto(produtoId: ObjectId): Promise<{ status: "OK" | "PENDENTE"; erro?: string }> {
  try {
    await indexarProduto(produtoId);
    await getCollection("sync_pendentes").deleteOne({ produto_id: produtoId });
    return { status: "OK" };
  } catch (err: any) {
    await getCollection("sync_pendentes").updateOne(
      { produto_id: produtoId },
      { $set: { erro: err.message, ultima_tentativa: new Date() }, $inc: { tentativas: 1 }, $setOnInsert: { criado_em: new Date() } },
      { upsert: true }
    );
    return { status: "PENDENTE", erro: err.message };
  }
}

/** Reprocessa todos os produtos que ficaram pendentes. */
export async function reprocessarPendentes() {
  const pendentes = await getCollection("sync_pendentes").find().toArray();
  let ok = 0;
  let falhas = 0;
  for (const p of pendentes) {
    const r = await sincronizarProduto(p.produto_id);
    r.status === "OK" ? ok++ : falhas++;
  }
  return { encontrados: pendentes.length, sincronizados: ok, ainda_pendentes: falhas };
}
