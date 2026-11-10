#!/usr/bin/env bash
#
# iniciar.sh — Sobe todos os bancos NoSQL, UIs e a aplicação Express
#             (com limpeza prévia automática de portas e carga dos arquivos declarativos em init/)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ── Portas dedicadas da disciplina TSI34E ─────────────────────────────────────
# 3400: App | 8400: ElasticVue | 8401: MongoExpress | 8402: RedisCommander
# 27034: MongoDB | 6334: Redis | 9234: Elasticsearch
APP_PORTS=(3400 8400 8401 8402 27034 6334 9234)

echo -e "${CYAN}Verificando e liberando portas para evitar conflitos no Ubuntu...${NC}"

for port in "${APP_PORTS[@]}"; do
    if command -v fuser >/dev/null 2>&1; then
        fuser -k -n tcp "$port" >/dev/null 2>&1 || true
    elif command -v lsof >/dev/null 2>&1; then
        PIDS=$(lsof -ti :"$port" 2>/dev/null || true)
        if [[ -n "$PIDS" ]]; then
            echo -e "${YELLOW}Liberando porta $port (PID: $PIDS)...${NC}"
            kill -9 $PIDS >/dev/null 2>&1 || true
        fi
    fi
done

echo -e "${CYAN}Iniciando ambiente NoSQL completo...${NC}"

# Testar se o docker roda direto ou precisa do grupo/sudo
if docker info >/dev/null 2>&1; then
    docker compose up -d --build --remove-orphans
elif sg docker -c "docker info" >/dev/null 2>&1; then
    sg docker -c "docker compose up -d --build --remove-orphans"
else
    echo -e "${YELLOW}[AVISO] Permissão do Docker pendente no terminal. Executando com sudo...${NC}"
    sudo docker compose up -d --build --remove-orphans
fi

# ── Executar comandos declarativos do Redis em init/redis-init.commands ───────
if [[ -f "$SCRIPT_DIR/init/redis-init.commands" ]]; then
    echo -e "${CYAN}Carregando estruturas declarativas no Redis (init/redis-init.commands)...${NC}"
    for i in {1..10}; do
        if docker exec nosql_redis redis-cli ping >/dev/null 2>&1; then
            docker exec -i nosql_redis redis-cli < "$SCRIPT_DIR/init/redis-init.commands" >/dev/null 2>&1 || true
            break
        fi
        sleep 1
    done
fi

# ── Criar e popular o índice de busca (Elasticsearch) a partir do MongoDB ────
echo -e "${CYAN}Aguardando MongoDB/Elasticsearch e criando o índice 'produtos'...${NC}"
INDICE_OK=0
for i in {1..60}; do
    if docker exec nosql_app npx tsx src/scripts/seed-elastic.ts >/tmp/seed-elastic.log 2>&1; then
        INDICE_OK=1
        break
    fi
    sleep 3
done
if [[ "$INDICE_OK" == "1" ]]; then
    echo -e "${GREEN}$(grep "Índice" /tmp/seed-elastic.log || tail -n 1 /tmp/seed-elastic.log)${NC}"
else
    echo -e "${YELLOW}[AVISO] Não foi possível criar o índice. Último erro:${NC}"
    tail -n 5 /tmp/seed-elastic.log
fi

# ── Aguardar a API responder ──────────────────────────────────────────────────
for i in {1..30}; do
    curl -s -o /dev/null http://localhost:3400/api/health && break
    sleep 1
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             🚀 AMBIENTE NOSQL ATIVO E PRONTO!                    ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "║  ${BOLD}APLICAÇÃO NODE/TYPESCRIPT (DOCKER):${NC}                             ║"
echo -e "║  • API Express (Hot-Reload):       ${CYAN}http://localhost:3400${NC}          ║"
echo -e "║  • Health Check dos 3 bancos:      ${CYAN}http://localhost:3400/api/health${NC} ║"
echo -e "║  • Busca (Elasticsearch):          ${CYAN}http://localhost:3400/api/busca?q=frango${NC}║"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "║  ${BOLD}INTERFACES VISUAIS (WEB):${NC}                                      ║"
echo -e "║  • ElasticVue (Elasticsearch):     ${CYAN}http://localhost:8400${NC} (Use http://localhost:9234) ║"
echo -e "║  • Mongo Express (MongoDB):        ${CYAN}http://localhost:8401${NC}          ║"
echo -e "║  • Redis Commander (Redis):        ${CYAN}http://localhost:8402${NC}          ║"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "║  ${BOLD}📁 ARQUIVOS DECLARATIVOS (Database as Code):${NC}                   ║"
echo -e "║  • MongoDB:       ${CYAN}init/mongo-init.js${NC}                              ║"
echo -e "║  • Elasticsearch: ${CYAN}init/elastic-init.json${NC}                          ║"
echo -e "║  • Redis:         ${CYAN}init/redis-init.commands${NC}                        ║"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
