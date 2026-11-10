/**
 * ============================================================================
 * MONGODB INIT — DOMINGUEIRA (marketplace de assados e comidas de fim de semana)
 * ============================================================================
 * Executado automaticamente na primeira inicialização do container MongoDB.
 * Coleções: usuarios, lojas, produtos, pedidos, avaliacoes, sync_pendentes
 * Os IDs são fixos para que as referências entre coleções sejam funcionais.
 */

db = db.getSiblingDB("domingueira");

const oid = (s) => ObjectId(s);
const arred = (n) => Math.round(n * 100) / 100;

// ── 1. USUÁRIOS (3 donos de loja + 4 clientes) ───────────────────────────────
const U = {
  valdir: "670a1b9d8f3b4a5d6e7f8900",
  neusa: "670a1b9d8f3b4a5d6e7f8901",
  rogerio: "670a1b9d8f3b4a5d6e7f8902",
  mariana: "670a1b9d8f3b4a5d6e7f8910",
  carlos: "670a1b9d8f3b4a5d6e7f8911",
  juliana: "670a1b9d8f3b4a5d6e7f8912",
  thiago: "670a1b9d8f3b4a5d6e7f8913",
};
const L = {
  trianon: "670a1c2e8f3b4a5d6e7f8a01",
  neusa: "670a1c2e8f3b4a5d6e7f8a02",
  rogerio: "670a1c2e8f3b4a5d6e7f8a03",
  fornada: "670a1c2e8f3b4a5d6e7f8a04",
  porcao: "670a1c2e8f3b4a5d6e7f8a05",
};
const P = (n) => "670a1d4f8f3b4a5d6e7f8b" + String(n).padStart(2, "0");

const ponto = (lng, lat) => ({ type: "Point", coordinates: [lng, lat] });

db.createCollection("usuarios");
db.usuarios.createIndex({ email: 1 }, { unique: true });
db.usuarios.createIndex({ papel: 1 });
db.usuarios.insertMany([
  { _id: oid(U.valdir), nome: "Valdir Menezes", email: "valdir@assadosdotrianon.com.br", telefone: "42999123456", papel: "DONO", enderecos: [], lojas_favoritas: [], criado_em: ISODate("2026-08-10T12:00:00Z") },
  { _id: oid(U.neusa), nome: "Neusa Kovalski", email: "neusa@cozinhadaneusa.com.br", telefone: "42998877001", papel: "DONO", enderecos: [], lojas_favoritas: [], criado_em: ISODate("2026-08-12T12:00:00Z") },
  { _id: oid(U.rogerio), nome: "Rogério Padilha", email: "rogerio@churrasqueira.com.br", telefone: "42998877002", papel: "DONO", enderecos: [], lojas_favoritas: [], criado_em: ISODate("2026-08-13T12:00:00Z") },
  {
    _id: oid(U.mariana), nome: "Mariana Souza", email: "mariana.souza@email.com", telefone: "42991110001", papel: "CLIENTE",
    enderecos: [
      { apelido: "Casa", logradouro: "Rua Visconde de Guarapuava", numero: "320", bairro: "Centro", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4625, -25.3948) },
      { apelido: "Trabalho", logradouro: "Av. Manoel Ribas", numero: "1020", bairro: "Batel", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4660, -25.3880) },
    ],
    lojas_favoritas: [oid(L.trianon), oid(L.rogerio)], criado_em: ISODate("2026-09-01T15:00:00Z"),
  },
  {
    _id: oid(U.carlos), nome: "Carlos Pietro", email: "carlos.pietro@email.com", telefone: "42991110002", papel: "CLIENTE",
    enderecos: [{ apelido: "Casa", logradouro: "Rua das Araucárias", numero: "980", bairro: "Trianon", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4570, -25.3900) }],
    lojas_favoritas: [oid(L.trianon)], criado_em: ISODate("2026-09-03T15:00:00Z"),
  },
  {
    _id: oid(U.juliana), nome: "Juliana Ferreira", email: "juliana.ferreira@email.com", telefone: "42991110003", papel: "CLIENTE",
    enderecos: [{ apelido: "Casa", logradouro: "Rua Santos Dumont", numero: "55", bairro: "Vila Carli", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4400, -25.4050) }],
    lojas_favoritas: [oid(L.porcao), oid(L.neusa)], criado_em: ISODate("2026-09-10T15:00:00Z"),
  },
  {
    _id: oid(U.thiago), nome: "Thiago Almeida", email: "thiago.almeida@email.com", telefone: "42991110004", papel: "CLIENTE",
    enderecos: [{ apelido: "Apartamento", logradouro: "Rua Brasil", numero: "700", bairro: "Centro", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4610, -25.3960) }],
    lojas_favoritas: [], criado_em: ISODate("2026-09-15T15:00:00Z"),
  },
]);

// ── 2. PRODUTOS (catálogo completo; fonte da verdade de preço/estoque) ───────
const unidade = (preco) => ({ tipo: "UNIDADE", preco });
const peso = (preco_kg, peso_medio_kg) => ({ tipo: "PESO", preco_kg, peso_medio_kg });

const produtos = [
  { n: 1, loja: L.trianon, nome: "Frango assado inteiro", categoria: "Aves", descricao: "Frango caipira assado no forno a lenha, pele crocante e suculento, servido inteiro.", ingredientes: ["frango caipira", "alho", "limão", "sal", "ervas"], alergenos: [], venda: unidade(52.0), estoque: { limitado: true, quantidade: 30 }, detalhes: { recheio: "Farofa de miúdos", tempero: "Alho e limão" } },
  { n: 2, loja: L.trianon, nome: "Costela bovina fogo de chão", categoria: "Carnes", descricao: "Costela bovina assada por 8 horas no fogo de chão, macia e que desmancha no garfo.", ingredientes: ["costela bovina", "sal grosso"], alergenos: [], venda: peso(84.9, 1.8), estoque: { limitado: true, quantidade: 12 }, detalhes: { corte: "Janela", horas_no_fogo: 8 } },
  { n: 3, loja: L.trianon, nome: "Maionese caseira 500 g", categoria: "Acompanhamentos", descricao: "Maionese caseira cremosa, feita no dia com ovos caipiras.", ingredientes: ["ovo", "óleo", "limão", "alho"], alergenos: ["ovo"], venda: unidade(16.0), estoque: { limitado: false, quantidade: null } },
  { n: 4, loja: L.trianon, nome: "Arroz carreteiro 1 kg", categoria: "Pratos", descricao: "Arroz carreteiro com charque desfiado e bacon, tempero tropeiro de fogão a lenha.", ingredientes: ["arroz", "charque", "bacon", "cebola", "alho"], alergenos: [], venda: unidade(38.0), estoque: { limitado: true, quantidade: 15 } },
  { n: 5, loja: L.neusa, nome: "Marmita rural completa", categoria: "Pratos", descricao: "Arroz, feijão tropeiro, frango caipira ensopado e mandioca cozida. Comida de sítio.", ingredientes: ["arroz", "feijão", "frango caipira", "mandioca"], alergenos: [], venda: unidade(28.0), estoque: { limitado: true, quantidade: 40 } },
  { n: 6, loja: L.neusa, nome: "Pão de milho caseiro", categoria: "Padaria", descricao: "Pão de milho macio feito com fubá moído na pedra, perfeito para o café da tarde.", ingredientes: ["fubá", "leite", "ovos", "manteiga"], alergenos: ["leite", "ovo", "glúten"], venda: unidade(14.0), estoque: { limitado: true, quantidade: 25 } },
  { n: 7, loja: L.neusa, nome: "Queijo colonial 500 g", categoria: "Laticínios", descricao: "Queijo colonial curado de leite cru de produtor local, sabor marcante.", ingredientes: ["leite"], alergenos: ["leite"], venda: unidade(29.0), estoque: { limitado: true, quantidade: 18 } },
  { n: 8, loja: L.rogerio, nome: "Espeto de coração de frango (5 un)", categoria: "Espetos", descricao: "Cinco espetos de coração de frango temperados com sal grosso, grelhados na brasa.", ingredientes: ["coração de frango", "sal grosso"], alergenos: [], venda: unidade(22.0), estoque: { limitado: false, quantidade: null } },
  { n: 9, loja: L.rogerio, nome: "Linguiça artesanal", categoria: "Carnes", descricao: "Linguiça suína artesanal com alho, vendida por quilo e grelhada na hora.", ingredientes: ["carne suína", "alho", "sal"], alergenos: [], venda: peso(39.9, 0.6), estoque: { limitado: true, quantidade: 20 } },
  { n: 10, loja: L.rogerio, nome: "Picanha na chapa 400 g", categoria: "Carnes", descricao: "Picanha bovina fatiada, selada na chapa e finalizada com sal grosso.", ingredientes: ["picanha", "sal grosso"], alergenos: [], venda: unidade(58.0), estoque: { limitado: true, quantidade: 14 } },
  { n: 11, loja: L.fornada, nome: "Cuca de banana com farofa", categoria: "Padaria", descricao: "Cuca alemã de banana com cobertura de farofa doce crocante, receita de família.", ingredientes: ["farinha de trigo", "banana", "ovos", "açúcar", "manteiga"], alergenos: ["glúten", "ovo", "leite"], venda: unidade(32.0), estoque: { limitado: true, quantidade: 10 } },
  { n: 12, loja: L.fornada, nome: "Pão caseiro de fermentação natural", categoria: "Padaria", descricao: "Pão artesanal de fermentação natural, casca crocante e miolo úmido.", ingredientes: ["farinha de trigo", "água", "sal"], alergenos: ["glúten"], venda: unidade(18.0), estoque: { limitado: true, quantidade: 22 } },
  { n: 13, loja: L.porcao, nome: "Porco no rolete", categoria: "Carnes", descricao: "Pernil suíno assado lentamente no rolete, vendido por quilo, tempero de alho e limão.", ingredientes: ["pernil suíno", "alho", "limão", "ervas"], alergenos: [], venda: peso(49.9, 2.5), estoque: { limitado: true, quantidade: 8 } },
  { n: 14, loja: L.porcao, nome: "Costelinha suína barbecue", categoria: "Carnes", descricao: "Costelinha suína assada com molho barbecue defumado, acompanha farofa.", ingredientes: ["costela suína", "molho barbecue"], alergenos: ["soja"], venda: unidade(46.0), estoque: { limitado: true, quantidade: 16 } },
  { n: 15, loja: L.porcao, nome: "Vinagrete 300 g", categoria: "Acompanhamentos", descricao: "Vinagrete fresco de tomate, cebola e pimentão, ideal para acompanhar assados.", ingredientes: ["tomate", "cebola", "pimentão", "vinagre"], alergenos: [], venda: unidade(9.0), estoque: { limitado: false, quantidade: null } },
];
const prodPorN = {};
produtos.forEach((p) => (prodPorN[p.n] = p));

db.createCollection("produtos");
db.produtos.createIndex({ loja_id: 1, categoria: 1 });
db.produtos.createIndex({ categoria: 1, "venda.preco": 1 });
db.produtos.createIndex({ ativo: 1 });
db.produtos.insertMany(
  produtos.map((p) => ({
    _id: oid(P(p.n)), loja_id: oid(p.loja), nome: p.nome, categoria: p.categoria, descricao: p.descricao,
    ingredientes: p.ingredientes, alergenos: p.alergenos, venda: p.venda, estoque: p.estoque,
    ...(p.detalhes ? { detalhes: p.detalhes } : {}),
    ativo: true, criado_em: ISODate("2026-08-20T12:00:00Z"), atualizado_em: ISODate("2026-09-29T21:14:08Z"),
  }))
);

// Cardápio embutido na loja (cópia resumida do catálogo → leitura da tela da loja em 1 consulta)
const cardapioDe = (lojaId) =>
  produtos.filter((p) => p.loja === lojaId).map((p) => ({
    produto_id: oid(P(p.n)), nome: p.nome, venda: p.venda,
    estoque: { limitado: p.estoque.limitado },
    ...(p.detalhes ? { detalhes: p.detalhes } : {}),
    ativo: true,
  }));

// ── 3. LOJAS ─────────────────────────────────────────────────────────────────
const horariosFds = (abre, fecha) => [
  { dia: "SABADO", abre, fecha },
  { dia: "DOMINGO", abre, fecha },
];

db.createCollection("lojas");
db.lojas.createIndex({ slug: 1 }, { unique: true });
db.lojas.createIndex({ "endereco.localizacao": "2dsphere" });
db.lojas.createIndex({ dono_id: 1 });
db.lojas.createIndex({ ativa: 1, "endereco.cidade": 1 });
db.lojas.createIndex({ "cardapio.produto_id": 1 });
db.lojas.insertMany([
  {
    _id: oid(L.trianon), nome: "Assados do Trianon", slug: "assados-do-trianon", dono_id: oid(U.valdir),
    whatsapp: "42999123456", ativa: true, taxa_plataforma_percentual: 1.5,
    endereco: { logradouro: "Rua das Araucárias", numero: "1450", bairro: "Trianon", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4582, -25.3921) },
    atendimento: { retirada: true, entrega: { ativa: true, raio_km: 4.5, taxa: 7.0, pedido_minimo: 50.0 } },
    horarios: [{ dia: "SABADO", abre: "08:00", fecha: "13:30" }, { dia: "DOMINGO", abre: "08:00", fecha: "13:00" }],
    cardapio: cardapioDe(L.trianon),
    avaliacao_resumo: { total: 132, soma_notas: 621, media: 4.7 },
    criada_em: ISODate("2026-08-14T13:20:00Z"), atualizada_em: ISODate("2026-09-29T21:14:08Z"),
  },
  {
    _id: oid(L.neusa), nome: "Cozinha da Neusa", slug: "cozinha-da-neusa", dono_id: oid(U.neusa),
    whatsapp: "42998877001", ativa: true, taxa_plataforma_percentual: 1.5,
    endereco: { logradouro: "Rua Pedro Álvares Cabral", numero: "210", bairro: "Boqueirão", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4780, -25.4100) },
    atendimento: { retirada: true, entrega: { ativa: true, raio_km: 6.0, taxa: 8.0, pedido_minimo: 30.0 } },
    horarios: horariosFds("10:00", "14:00"),
    cardapio: cardapioDe(L.neusa),
    avaliacao_resumo: { total: 58, soma_notas: 272, media: 4.7 },
    criada_em: ISODate("2026-08-15T13:20:00Z"), atualizada_em: ISODate("2026-09-20T18:00:00Z"),
  },
  {
    _id: oid(L.rogerio), nome: "Churrasqueira do Rogério", slug: "churrasqueira-do-rogerio", dono_id: oid(U.rogerio),
    whatsapp: "42998877002", ativa: true, taxa_plataforma_percentual: 2.0,
    endereco: { logradouro: "Av. Manoel Ribas", numero: "2300", bairro: "Batel", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4700, -25.3850) },
    atendimento: { retirada: true, entrega: { ativa: true, raio_km: 5.0, taxa: 6.0, pedido_minimo: 40.0 } },
    horarios: horariosFds("11:00", "15:00"),
    cardapio: cardapioDe(L.rogerio),
    avaliacao_resumo: { total: 94, soma_notas: 423, media: 4.5 },
    criada_em: ISODate("2026-08-16T13:20:00Z"), atualizada_em: ISODate("2026-09-25T18:00:00Z"),
  },
  {
    _id: oid(L.fornada), nome: "Fornada Boa", slug: "fornada-boa", dono_id: oid(U.valdir),
    whatsapp: "42999123457", ativa: true, taxa_plataforma_percentual: 1.5,
    endereco: { logradouro: "Rua XV de Novembro", numero: "801", bairro: "Centro", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4590, -25.3930) },
    atendimento: { retirada: true, entrega: { ativa: false, raio_km: 0, taxa: 0, pedido_minimo: 0 } },
    horarios: [{ dia: "SABADO", abre: "07:00", fecha: "12:00" }],
    cardapio: cardapioDe(L.fornada),
    avaliacao_resumo: { total: 41, soma_notas: 200, media: 4.9 },
    criada_em: ISODate("2026-08-20T13:20:00Z"), atualizada_em: ISODate("2026-09-28T18:00:00Z"),
  },
  {
    _id: oid(L.porcao), nome: "Porcão da Vila", slug: "porcao-da-vila", dono_id: oid(U.rogerio),
    whatsapp: "42998877003", ativa: true, taxa_plataforma_percentual: 2.0,
    endereco: { logradouro: "Rua Santos Dumont", numero: "300", bairro: "Vila Carli", cidade: "Guarapuava", uf: "PR", localizacao: ponto(-51.4410, -25.4040) },
    atendimento: { retirada: true, entrega: { ativa: true, raio_km: 7.0, taxa: 9.0, pedido_minimo: 60.0 } },
    horarios: horariosFds("11:30", "15:30"),
    cardapio: cardapioDe(L.porcao),
    avaliacao_resumo: { total: 77, soma_notas: 331, media: 4.3 },
    criada_em: ISODate("2026-08-22T13:20:00Z"), atualizada_em: ISODate("2026-09-30T18:00:00Z"),
  },
]);

// ── 4. PEDIDOS (itens em snapshot: preço histórico imutável) ─────────────────
const lojaInfo = {
  [L.trianon]: { nome: "Assados do Trianon", taxa: 7.0 },
  [L.neusa]: { nome: "Cozinha da Neusa", taxa: 8.0 },
  [L.rogerio]: { nome: "Churrasqueira do Rogério", taxa: 6.0 },
  [L.fornada]: { nome: "Fornada Boa", taxa: 0 },
  [L.porcao]: { nome: "Porcão da Vila", taxa: 9.0 },
};
const FLUXO = {
  ENTREGUE: ["PENDENTE", "CONFIRMADO", "PRONTO", "ENTREGUE"],
  CONFIRMADO: ["PENDENTE", "CONFIRMADO"],
  CANCELADO: ["PENDENTE", "CANCELADO"],
};
function pedido(id, cliente, loja, itensSpec, status, tipo, dataIso, endIdx) {
  const t0 = new Date(dataIso);
  const itens = itensSpec.map(([n, qtd]) => {
    const p = prodPorN[n];
    const unit = p.venda.tipo === "PESO" ? p.venda.preco_kg : p.venda.preco;
    return { produto_id: oid(P(n)), nome: p.nome, tipo_venda: p.venda.tipo, quantidade: qtd, preco_unitario: unit, subtotal: arred(unit * qtd) };
  });
  const subtotal = arred(itens.reduce((s, i) => s + i.subtotal, 0));
  const taxa = tipo === "ENTREGA" ? lojaInfo[loja].taxa : 0;
  const cli = db.usuarios.findOne({ _id: oid(cliente) });
  return {
    _id: oid(id), cliente_id: oid(cliente), loja_id: oid(loja), loja_nome: lojaInfo[loja].nome,
    tipo_entrega: tipo,
    endereco_entrega: tipo === "ENTREGA" ? (({ apelido, ...e }) => e)(cli.enderecos[endIdx || 0]) : null,
    itens, subtotal, taxa_entrega: taxa, total: arred(subtotal + taxa), status,
    historico: FLUXO[status].map((s, i) => ({ status: s, em: new Date(t0.getTime() + i * 25 * 60000) })),
    pagamento: { forma: "PIX", status: status === "CANCELADO" ? "ESTORNADO" : "PAGO" },
    criado_em: t0, atualizado_em: new Date(t0.getTime() + (FLUXO[status].length - 1) * 25 * 60000),
  };
}
const PD = (n) => "670a3000" + "8f3b4a5d6e7f8c" + String(n).padStart(2, "0");

db.createCollection("pedidos");
db.pedidos.createIndex({ cliente_id: 1, criado_em: -1 });
db.pedidos.createIndex({ loja_id: 1, status: 1, criado_em: -1 });
db.pedidos.createIndex({ status: 1 });
db.pedidos.insertMany([
  pedido(PD(1), U.mariana, L.trianon, [[1, 1], [3, 1]], "ENTREGUE", "ENTREGA", "2026-10-17T15:10:00Z", 0),
  pedido(PD(2), U.carlos, L.trianon, [[2, 2.0]], "ENTREGUE", "ENTREGA", "2026-10-18T14:30:00Z", 0),
  pedido(PD(3), U.mariana, L.rogerio, [[9, 1.2], [10, 1]], "ENTREGUE", "ENTREGA", "2026-10-24T16:00:00Z", 1),
  pedido(PD(4), U.juliana, L.porcao, [[13, 2.5]], "ENTREGUE", "ENTREGA", "2026-10-25T15:45:00Z", 0),
  pedido(PD(5), U.juliana, L.neusa, [[5, 2], [6, 1]], "ENTREGUE", "ENTREGA", "2026-10-31T14:50:00Z", 0),
  pedido(PD(6), U.thiago, L.fornada, [[11, 1]], "ENTREGUE", "RETIRADA", "2026-11-01T09:20:00Z"),
  pedido(PD(7), U.carlos, L.trianon, [[1, 2], [4, 1]], "CONFIRMADO", "ENTREGA", "2026-11-08T14:05:00Z", 0),
  pedido(PD(8), U.thiago, L.porcao, [[14, 1], [15, 1]], "CANCELADO", "ENTREGA", "2026-11-08T15:15:00Z", 0),
]);

// ── 5. AVALIAÇÕES (1 por pedido entregue) ────────────────────────────────────
db.createCollection("avaliacoes");
db.avaliacoes.createIndex({ pedido_id: 1 }, { unique: true });
db.avaliacoes.createIndex({ loja_id: 1, criada_em: -1 });
db.avaliacoes.createIndex({ cliente_id: 1 });
db.avaliacoes.insertMany([
  { pedido_id: oid(PD(1)), loja_id: oid(L.trianon), cliente_id: oid(U.mariana), nota: 5, comentario: "Frango perfeito, pele crocante e chegou quentinho.", criada_em: ISODate("2026-10-17T18:00:00Z") },
  { pedido_id: oid(PD(2)), loja_id: oid(L.trianon), cliente_id: oid(U.carlos), nota: 5, comentario: "A costela desmancha. Melhor do fim de semana.", resposta_loja: { texto: "Obrigado, Carlos! Volte sempre.", em: ISODate("2026-10-19T10:00:00Z") }, criada_em: ISODate("2026-10-18T17:30:00Z") },
  { pedido_id: oid(PD(3)), loja_id: oid(L.rogerio), cliente_id: oid(U.mariana), nota: 4, comentario: "Picanha ótima, a linguiça poderia ter vindo mais quente.", criada_em: ISODate("2026-10-24T19:00:00Z") },
  { pedido_id: oid(PD(4)), loja_id: oid(L.porcao), cliente_id: oid(U.juliana), nota: 4, comentario: "Porco no rolete muito saboroso, entrega um pouco demorada.", criada_em: ISODate("2026-10-25T18:30:00Z") },
  { pedido_id: oid(PD(5)), loja_id: oid(L.neusa), cliente_id: oid(U.juliana), nota: 5, comentario: "Comida de vó, o pão de milho é sensacional.", criada_em: ISODate("2026-10-31T17:00:00Z") },
  { pedido_id: oid(PD(6)), loja_id: oid(L.fornada), cliente_id: oid(U.thiago), nota: 5, comentario: "A cuca de banana é a melhor da cidade.", criada_em: ISODate("2026-11-01T12:00:00Z") },
]);

// ── 6. SYNC_PENDENTES (fila de reindexações do Elasticsearch que falharam) ───
db.createCollection("sync_pendentes");
db.sync_pendentes.createIndex({ produto_id: 1 }, { unique: true });

print("[init] domingueira pronto: " +
  db.usuarios.countDocuments() + " usuarios, " + db.lojas.countDocuments() + " lojas, " +
  db.produtos.countDocuments() + " produtos, " + db.pedidos.countDocuments() + " pedidos, " +
  db.avaliacoes.countDocuments() + " avaliacoes");
