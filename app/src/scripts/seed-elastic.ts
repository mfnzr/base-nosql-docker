import fs from "fs";
import path from "path";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";
import { connectElastic, getElasticClient, closeElastic } from "../database/elastic.js";
import { INDICE_PRODUTOS, montarDocumento } from "../services/sync-elastic.js";

function lerConfigIndice() {
  const candidatos = [
    path.resolve(process.cwd(), "init", "elastic-init.json"),
    path.resolve(process.cwd(), "..", "init", "elastic-init.json"),
    path.resolve("/app", "init", "elastic-init.json"),
  ];
  for (const p of candidatos) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  throw new Error("init/elastic-init.json não encontrado.");
}

/** Recria o índice 'produtos' (mapping de init/elastic-init.json) e carrega todos os produtos do MongoDB. */
export async function seedElasticsearch() {
  await connectMongo();
  await connectElastic();
  const elastic = getElasticClient();
  const config = lerConfigIndice();

  if (await elastic.indices.exists({ index: INDICE_PRODUTOS })) {
    await elastic.indices.delete({ index: INDICE_PRODUTOS });
  }
  await elastic.indices.create({ index: INDICE_PRODUTOS, settings: config.settings, mappings: config.mappings });

  const lojas = await getCollection("lojas").find().toArray();
  const porId = new Map(lojas.map((l) => [l._id.toString(), l]));
  const produtos = await getCollection("produtos").find().toArray();

  const operations = produtos.flatMap((p) => [
    { index: { _index: INDICE_PRODUTOS, _id: p._id.toString() } },
    montarDocumento(p, porId.get(p.loja_id.toString())),
  ]);
  const r = await elastic.bulk({ operations, refresh: true });
  if (r.errors) throw new Error("Falha ao indexar alguns documentos: " + JSON.stringify(r.items.find((i: any) => i.index?.error)));

  await getCollection("sync_pendentes").deleteMany({}); // índice reconstruído do zero = nada pendente
  console.log(`[Elasticsearch] Índice '${INDICE_PRODUTOS}' criado com ${produtos.length} produtos.`);
}

if (process.argv[1] && process.argv[1].includes("seed-elastic")) {
  seedElasticsearch()
    .then(async () => { await closeMongo(); await closeElastic(); })
    .catch((err) => { console.error("Erro ao popular Elasticsearch:", err.message); process.exit(1); });
}
