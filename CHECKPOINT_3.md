# Checkpoint 3 — Domingueira: localização, resiliência e desempenho

> Como rodar do zero: `git clone <repo> && cd <repo> && ./iniciar.sh`. O Checkpoint 2 continua valendo (cache, estruturas do Redis, busca e sincronização) e é a base deste.
> Os comandos abaixo usam `B=http://localhost:3400/api` e o ponto de referência `P="lat=-25.3954&lng=-51.4623"` (centro de Guarapuava).

---

## Seção 1 — Localização

| O que tem localização | Fica parado ou se move? | Onde fica | Por quê |
|---|---|---|---|
| **Loja** (`lojas.endereco.localizacao`) | Parado | **MongoDB**, GeoJSON + índice **2dsphere** | A loja muda de endereço quase nunca. É dado cadastral e durável; a consulta "quem fica perto de mim" usa o índice geoespacial. |
| **Endereço de entrega do cliente** (`usuarios.enderecos[].localizacao`) | Parado | **MongoDB** (copiado para `pedidos.endereco_entrega`) | Só é lido junto com o usuário/pedido. Nenhuma consulta busca "clientes perto de um ponto", então **não** tem índice 2dsphere (índice sem consulta seria custo sem benefício). |
| **Entregador** (posição atual) | **Se move** (atualiza a cada poucos segundos) | **Redis**, `GEOADD`/`GEOSEARCH` na chave `domingueira:entregadores:posicao` | A posição muda o tempo todo e só a última interessa. Redis aguenta esse volume de escrita em memória, e perder a posição não é grave (o app reenvia em segundos). O cadastro (nome, veículo) fica no MongoDB (`entregadores`). |

**Coordenadas** sempre no formato GeoJSON, **longitude antes da latitude**: `{ "type": "Point", "coordinates": [-51.4582, -25.3921] }` (`init/mongo-init.js`). No Redis, `GEOADD chave <longitude> <latitude> <membro>` (`init/redis-init.commands`).

**Índice 2dsphere:** `db.lojas.createIndex({ "endereco.localizacao": "2dsphere" })` está em `init/mongo-init.js`. O `./iniciar.sh` sobe o MongoDB com esse script montado, então o índice é criado sem intervenção manual. O mesmo `iniciar.sh` carrega as posições iniciais dos entregadores no Redis.

**Rotas** (`app/src/controllers/perto.controller.ts`, `app/src/routes/perto.routes.ts`):

| Rota | Banco | Técnica |
|---|---|---|
| `GET /api/perto/lojas?lat=&lng=&raio_km=` | MongoDB | `$geoNear` com `maxDistance` (raio em metros) sobre o 2dsphere e `$sort` por `distancia_m`: do mais perto para o mais longe |
| `GET /api/perto/entregadores?lat=&lng=&raio_km=` | Redis | `GEOSEARCH ... FROMLONLAT ... BYRADIUS ... ASC WITHDIST` (nome e veículo vêm do MongoDB) |
| `PUT /api/entregadores/:id/posicao` | Redis | `GEOADD` (o entregador se moveu) |

---

## Seção 2 — O sistema com um banco fora do ar

| Banco fora do ar | O que o usuário vê | Código |
|---|---|---|
| **Redis** | `GET /api/lojas/:slug` continua em **HTTP 200**, lendo direto do MongoDB. Cabeçalho `X-Cache: BYPASS` e aviso na resposta. Sem 500 e sem esperar. As rotas que *só* existem por causa do Redis (carrinho, ranking, entregadores) respondem **503** com mensagem clara. | `database/redis.ts`: `redisPronto()` (só usa o Redis se o status do cliente é `ready`; o ioredis enfileira comandos enquanto reconecta, então nem tentamos) e `comLimite()` (desiste em 300 ms). `cacheGet` devolve `null` (como um MISS) e `cacheSet`/`cacheDel` devolvem `false`, sem lançar erro. Usado em `controllers/lojas.controller.ts`. |
| **Elasticsearch** | `GET /api/busca` responde **200** com uma **busca simples no MongoDB** (trecho do texto em nome, descrição e ingredientes) e um campo `aviso` explicando que não há relevância nem tolerância a erro de digitação. Demora ~1,5 s (o limite de espera). Escritas de produto continuam funcionando: o que não foi indexado vai para `sync_pendentes` (Checkpoint 2). | `controllers/busca.controller.ts`: a chamada ao Elasticsearch fica dentro de `comLimite(..., 1500)`; em caso de falha segue para o `find` com `$regex` (texto escapado). |
| **MongoDB** (fonte da verdade) | **HTTP 503** com a mensagem "MongoDB (fonte da verdade) indisponível no momento", em ~2 s. Sem 500 e sem travar. Se a loja ainda estiver no cache do Redis, a leitura em cache continua respondendo até o TTL expirar. Quando o MongoDB volta, a API volta sozinha (o driver reconecta). | `utils/erros.ts`: `responderErro()` reconhece os erros de conexão do driver (`MongoServerSelectionError`, `MongoNetworkError`...) e responde 503. `database/mongo.ts`: `serverSelectionTimeoutMS: 2000`. Todos os controllers usam `responderErro`. |

Também: ao subir, a API tenta conectar ao MongoDB até 15 vezes (`server.ts`), e o `connectMongo` não deixa um cliente quebrado "preso" entre tentativas.

---

## Seção 3 — Escrita crítica

| Dado | Não pode ser perdido | Pode atrasar ou ser refeito |
|---|---|---|
| **Pedido** (itens, preços, total, endereço) e status de **pagamento** | ✅ É dinheiro do cliente e do produtor | |
| Cadastro de usuários, lojas, produtos e preços (catálogo) | ✅ Fonte da verdade, não dá para recalcular | |
| Avaliações | ✅ Conteúdo escrito pelo cliente | |
| Cadastro de entregadores | ✅ | |
| Índice de busca (Elasticsearch) | | ✅ Reconstruído do MongoDB por `seed-elastic.ts` ou pela fila `sync_pendentes` |
| Cache da loja (Redis) | | ✅ Expira em 120 s e é recriado na próxima leitura |
| Carrinho (Redis) | | ✅ Dado temporário de 24 h; perder obriga só a remontar |
| Ranking de mais vendidos (Redis) | | ✅ Derivado dos pedidos entregues |
| Posição do entregador (Redis) | | ✅ Reenviada a cada poucos segundos |
| Fila `sync_pendentes` | | ✅ Se perdida, `seed-elastic.ts` reconstrói o índice |

**Código:** `POST /api/pedidos` (`controllers/pedidos.controller.ts`, método `criar`) grava o pedido com **`writeConcern: { w: "majority", wtimeout: 5000 }` explícito** no `insertOne`. O pedido só é confirmado depois que a maioria dos nós do MongoDB o guardou.

```ts
await getCollection("pedidos").insertOne(pedido, { writeConcern: { w: "majority", wtimeout: 5000 } });
// ...
if (err instanceof MongoWriteConcernError) { /* HTTP 202, GRAVADO_AGUARDANDO_CONFIRMACAO */ }
```

**`MongoWriteConcernError` não é tratado como "não gravou".** Esse erro significa que o primário *já gravou* e só a confirmação da maioria não chegou dentro do `wtimeout`. Por isso a API responde **202** com `situacao: "GRAVADO_AGUARDANDO_CONFIRMACAO"`, devolve o `pedido_id` e orienta a **não repetir o envio** (repetir criaria um pedido duplicado). Um erro de conexão, ao contrário, vira 503 (nada foi gravado).

*Observação honesta:* o MongoDB do laboratório é um único nó (`mongod.conf` tem o replica set comentado). Com um nó só, "maioria" é 1 e a confirmação é imediata; o erro de confirmação só ocorre num replica set de produção. O código está pronto para esse cenário, mas ele não é reproduzível neste laboratório.

---

## Seção 4 — Desempenho

**1. Carga de teste.** `app/src/scripts/seed-carga.ts` grava **100.000 pedidos de 2.000 clientes** (semente fixa: iguais em qualquer máquina) na coleção `pedidos_carga`, que tem o mesmo formato de `pedidos` mas fica separada para não alterar os dados dos Checkpoints 1 e 2. A coleção é recriada **só com o índice `_id`**.

```bash
docker exec nosql_app npm run seed:carga        # ~3 s
```

**2. Consulta escolhida:** "meus pedidos entregues, do mais recente para o mais antigo" (`GET /api/desempenho/pedidos/:clienteId`).
É a tela mais aberta do app (todo cliente consulta o histórico repetidamente) e a coleção de pedidos é a que mais cresce, a cada fim de semana. Sem índice, o custo cresce com a tabela inteira, não com os pedidos do cliente.

```js
db.pedidos_carga.find({ cliente_id: ObjectId("670b00000000000000000007"), status: "ENTREGUE" }).sort({ criado_em: -1 }).limit(20)
```

**3. `explain("executionStats")`, antes e depois** (`GET /api/desempenho/explain/:clienteId`; etapas em ordem de execução):

| | Sem índice | Com índice `{cliente_id:1, status:1, criado_em:-1}` |
|---|---|---|
| Etapas | `COLLSCAN → SORT → PROJECTION_SIMPLE` | `IXSCAN → FETCH → PROJECTION_SIMPLE → LIMIT` |
| Documentos examinados | **100.000** | **20** |
| Chaves de índice examinadas | 0 | 20 |
| Documentos devolvidos | 20 | 20 |
| Tempo (`executionTimeMillis`) | **76 ms** | **2 ms** |

Sem índice o banco lê a coleção inteira (`COLLSCAN`) e ordena em memória (`SORT`) para devolver 20 documentos. Com o índice composto, as chaves já estão ordenadas por data dentro de cada `cliente_id + status`, então o banco lê só 20 entradas e **não precisa do `SORT`**.

**4. Benchmark** (`npm run benchmark`, **1.000 requisições, 20 simultâneas**, a mesma rota, com 0 erros):

| | Vazão | Latência média | p50 | **p95** | p99 |
|---|---|---|---|---|---|
| Sem índice | **54 req/s** | 365,2 ms | 348,0 ms | **536,8 ms** | 637,0 ms |
| Com índice | **606 req/s** | 31,7 ms | 29,5 ms | **53,8 ms** | 67,7 ms |

A vazão é ~11× maior e o p95 cai ~10×. (Os valores variam conforme a máquina; a proporção se mantém.)

**5. Índices da coleção `pedidos_carga`** (`db.pedidos_carga.getIndexes()`):

| Índice | Chave | Por que existe |
|---|---|---|
| `_id_` | `{ _id: 1 }` | Criado automaticamente pelo MongoDB em toda coleção. |
| `cliente_status_data` | `{ cliente_id: 1, status: 1, criado_em: -1 }` | Atende à consulta escolhida seguindo a regra **ESR**: as chaves de **igualdade** (`cliente_id`, `status`) primeiro e a de **ordenação** (`criado_em`, decrescente) por último, eliminando o `SORT`. Só um índice, porque é a única consulta da coleção. Um índice só em `cliente_id` ainda exigiria o `SORT`. |

Gerenciamento: `npm run indice:remover` (volta ao estado "sem índice") e `npm run indice:criar`.

---

## Seção 5 — Roteiro de demonstração

Pré-requisito: `./iniciar.sh` recém-executado. Execute **na ordem**.

```bash
B=http://localhost:3400/api
P="lat=-25.3954&lng=-51.4623"
```

### 5.1 Busca por raio (dois raios diferentes)
```bash
curl -s "$B/perto/lojas?$P&raio_km=1" | jq -c '{raio_km,total,dados:[.dados[]|{nome,distancia_km}]}'
curl -s "$B/perto/lojas?$P&raio_km=3" | jq -c '{raio_km,total,dados:[.dados[]|{nome,distancia_km}]}'
```
```
{"raio_km":1,"total":2,"dados":[{"nome":"Fornada Boa","distancia_km":0.43},{"nome":"Assados do Trianon","distancia_km":0.55}]}
{"raio_km":3,"total":5,"dados":[{"nome":"Fornada Boa","distancia_km":0.43},{"nome":"Assados do Trianon","distancia_km":0.55},{"nome":"Churrasqueira do Rogério","distancia_km":1.39},{"nome":"Cozinha da Neusa","distancia_km":2.27},{"nome":"Porcão da Vila","distancia_km":2.35}]}
```
Com raio maior entram mais lojas, sempre da mais perto para a mais longe.

### 5.2 Entregadores (posição que se move, no Redis)
```bash
curl -s "$B/perto/entregadores?$P&raio_km=1.5" | jq -c '{origem,total,dados:[.dados[]|{nome,distancia_km}]}'
curl -s -X PUT $B/entregadores/670a50008f3b4a5d6e7f8e03/posicao -H 'Content-Type: application/json' -d '{"lat":-25.3960,"lng":-51.4630}' | jq -c .
curl -s "$B/perto/entregadores?$P&raio_km=1.5" | jq -c '{total,dados:[.dados[]|{nome,distancia_km}]}'
```
```
{"origem":"REDIS (GEOSEARCH)","total":2,"dados":[{"nome":"Anderson Lima","distancia_km":0.24},{"nome":"Beatriz Campos","distancia_km":1.3}]}
{"estrutura":"GEO (Sorted Set)","chave":"domingueira:entregadores:posicao","entregador_id":"670a50008f3b4a5d6e7f8e03","posicao":{"lat":-25.396,"lng":-51.463}}
{"total":3,"dados":[{"nome":"Cássio Ribas","distancia_km":0.1},{"nome":"Anderson Lima","distancia_km":0.24},{"nome":"Beatriz Campos","distancia_km":1.3}]}
```

### 5.3 Leitura com cache e busca, com todos os bancos no ar
```bash
curl -s -o /dev/null -D - -w 'tempo: %{time_total}s\n' $B/lojas/assados-do-trianon | grep -i 'x-cache\|tempo'
curl -s -o /dev/null -D - -w 'tempo: %{time_total}s\n' $B/lojas/assados-do-trianon | grep -i 'x-cache\|tempo'
curl -s "$B/busca?q=fraango" | jq -c '{origem,total,primeiro:.resultados[0].produto}'
```
```
X-Cache: MISS
tempo: 0.008041s
X-Cache: HIT
tempo: 0.003080s
{"origem":"ELASTICSEARCH","total":3,"primeiro":"Frango assado inteiro"}
```

### 5.4 Bancos fora do ar
**Redis parado**, a mesma leitura:
```bash
docker stop nosql_redis
curl -s -o /tmp/r.json -D - -w 'tempo: %{time_total}s\n' $B/lojas/assados-do-trianon | grep -i 'http/\|x-cache\|tempo'; jq -c '{origem,aviso}' /tmp/r.json
```
```
HTTP/1.1 200 OK
X-Cache: BYPASS
tempo: 0.008744s
{"origem":"MONGODB (Redis fora do ar, sem cache)","aviso":"Cache indisponível; resposta lida direto do MongoDB."}
```
**Elasticsearch parado**, a mesma busca (agora com um texto que a busca simples consegue achar):
```bash
docker stop nosql_elasticsearch
curl -s -o /tmp/b.json -w 'http=%{http_code} tempo=%{time_total}s\n' "$B/busca?q=frango"; jq -c '{origem,aviso,total,resultados:[.resultados[].produto]}' /tmp/b.json
```
```
http=200 tempo=1.5s
{"origem":"MONGODB (busca simples, Elasticsearch fora do ar)","aviso":"Elasticsearch indisponível: busca simples por trecho do texto, sem relevância e sem tolerância a erro de digitação.","total":3,"resultados":["Frango assado inteiro","Marmita rural completa","Espeto de coração de frango (5 un)"]}
```
(Com o Elasticsearch parado, o erro de digitação `fraango` não acha nada: a busca simples não tem tolerância. É exatamente o que o aviso diz.)

**Extra, MongoDB parado** (fonte da verdade): resposta 503.
```bash
docker stop nosql_mongo
curl -s -w ' http=%{http_code}\n' "$B/perto/lojas?$P&raio_km=3"
```
```
{"erro":"MongoDB (fonte da verdade) indisponível no momento. Tente novamente em instantes.","banco":"mongodb"} http=503
```
**Religar tudo e esperar o cluster:**
```bash
docker start nosql_mongo nosql_redis nosql_elasticsearch
curl -s 'localhost:9234/_cluster/health?wait_for_status=green&timeout=90s' | jq -c .status
sleep 5
curl -s "$B/health" | jq -c '{status_geral, bancos: (.bancos|map_values(.status))}'
curl -s "$B/busca?q=fraango" | jq -c '{origem,total,primeiro:.resultados[0].produto}'
```
```
"green"
{"status_geral":"OK","bancos":{"mongodb":"ONLINE","redis":"ONLINE","elasticsearch":"ONLINE"}}
{"origem":"ELASTICSEARCH","total":3,"primeiro":"Frango assado inteiro"}
```

### 5.5 Escrita crítica (`w: "majority"`)
```bash
curl -s -X POST $B/pedidos -H 'Content-Type: application/json' -d '{"cliente_id":"670a1b9d8f3b4a5d6e7f8910","loja_id":"670a1c2e8f3b4a5d6e7f8a01","tipo_entrega":"ENTREGA","itens":[{"produto_id":"670a1d4f8f3b4a5d6e7f8b01","quantidade":1},{"produto_id":"670a1d4f8f3b4a5d6e7f8b03","quantidade":1}]}' | jq -c '{mensagem,status:.dados.status,total:.dados.total,itens:[.dados.itens[]|{nome,subtotal}]}'
docker exec nosql_mongo mongosh -u root -p root --quiet --authenticationDatabase admin domingueira --eval 'db.pedidos.countDocuments({status:"PENDENTE", cliente_id: ObjectId("670a1b9d8f3b4a5d6e7f8910")})'
```
```
{"mensagem":"Pedido gravado e confirmado pela maioria dos nós (w: majority).","status":"PENDENTE","total":75,"itens":[{"nome":"Frango assado inteiro","subtotal":52},{"nome":"Maionese caseira 500 g","subtotal":16}]}
1
```
Regra de negócio validada no mesmo endpoint: um pedido de entrega abaixo do mínimo da loja volta `422 {"erro":"Pedido mínimo para entrega: R$ 50.00."}`.

### 5.6 `explain()` e benchmark, antes e depois do índice
```bash
docker exec nosql_app npm run seed:carga 2>&1 | grep '\[Carga\] "\|exemplo'
docker exec nosql_app npm run indice:remover 2>&1 | grep 'Índices atuais'
curl -s $B/desempenho/explain/670b00000000000000000007 | jq -c '{etapas,documentos_examinados,chaves_examinadas,documentos_devolvidos,tempo_ms}'
docker exec nosql_app npm run benchmark -- "$B/desempenho/pedidos/670b00000000000000000007" 1000 20
```
```
[Carga] "pedidos_carga": 100000 pedidos de 2000 clientes em 2.4 s (apenas o índice _id).
[Carga] Cliente de exemplo: 670b00000000000000000007
[Índice] Índices atuais: _id_
{"etapas":"COLLSCAN → SORT → PROJECTION_SIMPLE","documentos_examinados":100000,"chaves_examinadas":0,"documentos_devolvidos":20,"tempo_ms":76}
requisições  1000 (20 ao mesmo tempo), 0 com erro
vazão        54 requisições por segundo
latência     média 365.2 ms
             p50 348.0 ms · p95 536.8 ms · p99 637.0 ms
```
Agora com o índice:
```bash
docker exec nosql_app npm run indice:criar 2>&1 | grep 'Índices atuais'
curl -s $B/desempenho/explain/670b00000000000000000007 | jq -c '{etapas,documentos_examinados,chaves_examinadas,documentos_devolvidos,tempo_ms}'
docker exec nosql_app npm run benchmark -- "$B/desempenho/pedidos/670b00000000000000000007" 1000 20
docker exec nosql_mongo mongosh -u root -p root --quiet --authenticationDatabase admin domingueira --eval 'db.pedidos_carga.getIndexes().forEach(i => print(i.name, JSON.stringify(i.key)))'
```
```
[Índice] Índices atuais: _id_, cliente_status_data
{"etapas":"IXSCAN → FETCH → PROJECTION_SIMPLE → LIMIT","documentos_examinados":20,"chaves_examinadas":20,"documentos_devolvidos":20,"tempo_ms":2}
requisições  1000 (20 ao mesmo tempo), 0 com erro
vazão        606 requisições por segundo
latência     média 31.7 ms
             p50 29.5 ms · p95 53.8 ms · p99 67.7 ms
_id_ {"_id":1}
cliente_status_data {"cliente_id":1,"status":1,"criado_em":-1}
```
(Os tempos e a vazão variam por máquina. O que deve se repetir: `COLLSCAN` com 100.000 examinados antes, `IXSCAN` com 20 depois, e a vazão muito maior com o índice.)
