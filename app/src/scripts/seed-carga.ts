import { ObjectId } from "mongodb";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";
import { COLECAO_CARGA } from "../controllers/desempenho.controller.js";

const TOTAL = 100_000;
const CLIENTES = 2_000;
const LOTE = 10_000;

// IDs de clientes sintéticos e previsíveis: cliente nº n → 670b0000 + n em hexadecimal (16 dígitos)
export const idCliente = (n: number) => new ObjectId("670b0000" + n.toString(16).padStart(16, "0"));

const LOJAS = [
  ["670a1c2e8f3b4a5d6e7f8a01", "Assados do Trianon"],
  ["670a1c2e8f3b4a5d6e7f8a02", "Cozinha da Neusa"],
  ["670a1c2e8f3b4a5d6e7f8a03", "Churrasqueira do Rogério"],
  ["670a1c2e8f3b4a5d6e7f8a04", "Fornada Boa"],
  ["670a1c2e8f3b4a5d6e7f8a05", "Porcão da Vila"],
];
const STATUS: [string, number][] = [["ENTREGUE", 0.7], ["CANCELADO", 0.1], ["PRONTO", 0.1], ["CONFIRMADO", 0.05], ["PENDENTE", 0.05]];

// Sorteio com semente fixa (mulberry32): a carga é igual em qualquer máquina
function sorteador(semente: number) {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grava 100 mil pedidos (2.000 clientes) em "pedidos_carga", com o mesmo formato de "pedidos",
 * SEM nenhum índice além do _id. Fica separada de "pedidos" para não alterar os dados dos
 * Checkpoints 1 e 2. Sempre recria a coleção (apaga também os índices criados antes).
 */
async function seedCarga() {
  await connectMongo();
  const col = getCollection(COLECAO_CARGA);
  await col.drop().catch(() => {});

  const aleatorio = sorteador(2026);
  const inicio = new Date("2026-01-01T00:00:00Z").getTime();
  const periodo = 314 * 24 * 60 * 60 * 1000; // até ~10/11/2026
  const t0 = Date.now();

  for (let n = 0; n < TOTAL; n += LOTE) {
    const lote = [];
    for (let i = n; i < n + LOTE; i++) {
      const sorteio = aleatorio();
      let acumulado = 0;
      const status = STATUS.find(([, p]) => (acumulado += p) > sorteio)![0];
      const [lojaId, lojaNome] = LOJAS[Math.floor(aleatorio() * LOJAS.length)];
      const qtdItens = 1 + Math.floor(aleatorio() * 3);
      const itens = Array.from({ length: qtdItens }, () => {
        const preco = Math.round((9 + aleatorio() * 80) * 100) / 100;
        const quantidade = 1 + Math.floor(aleatorio() * 3);
        return { produto_id: new ObjectId("670a1d4f8f3b4a5d6e7f8b" + String(1 + Math.floor(aleatorio() * 15)).padStart(2, "0")), quantidade, preco_unitario: preco, subtotal: Math.round(preco * quantidade * 100) / 100 };
      });
      const subtotal = Math.round(itens.reduce((t, x) => t + x.subtotal, 0) * 100) / 100;
      const criado = new Date(inicio + Math.floor(aleatorio() * periodo));
      lote.push({
        cliente_id: idCliente(1 + Math.floor(aleatorio() * CLIENTES)), loja_id: new ObjectId(lojaId), loja_nome: lojaNome,
        tipo_entrega: aleatorio() < 0.8 ? "ENTREGA" : "RETIRADA", itens, subtotal, taxa_entrega: 7, total: Math.round((subtotal + 7) * 100) / 100,
        status, criado_em: criado, atualizado_em: criado,
      });
    }
    await col.insertMany(lote, { ordered: false });
    console.log(`[Carga] ${n + LOTE} / ${TOTAL}`);
  }
  console.log(`[Carga] "${COLECAO_CARGA}": ${await col.countDocuments()} pedidos de ${CLIENTES} clientes em ${((Date.now() - t0) / 1000).toFixed(1)} s (apenas o índice _id).`);
  console.log(`[Carga] Cliente de exemplo: ${idCliente(7).toString()}`);
  await closeMongo();
}

seedCarga().catch((err) => {
  console.error("Erro na carga:", err.message);
  process.exit(1);
});
