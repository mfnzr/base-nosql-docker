import { Response } from "express";

/** Erros do driver que significam "o MongoDB não está acessível". */
export function mongoIndisponivel(err: any): boolean {
  return (
    ["MongoServerSelectionError", "MongoNetworkError", "MongoNetworkTimeoutError", "MongoNotConnectedError", "MongoTopologyClosedError"].includes(err?.name) ||
    /MongoDB não inicializado/.test(err?.message ?? "")
  );
}

export class RedisIndisponivelError extends Error {
  constructor() {
    super("Redis indisponível");
    this.name = "RedisIndisponivelError";
  }
}

/**
 * Resposta padrão de erro:
 *  - MongoDB fora do ar (fonte da verdade)  → 503 com mensagem clara
 *  - Redis fora do ar em rota que depende dele → 503 com mensagem clara
 *  - qualquer outro erro                      → 500
 */
export function responderErro(res: Response, err: any, mensagem: string): void {
  if (mongoIndisponivel(err)) {
    res.status(503).json({ erro: "MongoDB (fonte da verdade) indisponível no momento. Tente novamente em instantes.", banco: "mongodb" });
    return;
  }
  if (err instanceof RedisIndisponivelError) {
    res.status(503).json({ erro: "Redis indisponível no momento. Esta funcionalidade depende dele; tente novamente em instantes.", banco: "redis" });
    return;
  }
  res.status(500).json({ erro: mensagem, detalhe: err?.message });
}
