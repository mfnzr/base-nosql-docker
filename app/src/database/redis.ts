import { Redis } from "ioredis";
import dotenv from "dotenv";
import { RedisIndisponivelError } from "../utils/erros.js";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    });

    redisClient.on("connect", () => {
      console.log("[Redis] Conectado com sucesso!");
    });

    redisClient.on("error", (err) => {
      console.error("[Redis] Erro de conexão:", err.message);
    });
  }
  return redisClient;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedisClient();
  await client.ping();
  return client;
}

const LIMITE_REDIS_MS = 300;

/** O ioredis enfileira comandos enquanto tenta reconectar; se não está "ready", nem tentamos. */
export function redisPronto(): boolean {
  return redisClient?.status === "ready";
}

/** Cliente garantidamente pronto, ou RedisIndisponivelError (para rotas que dependem do Redis). */
export function getRedisPronto(): Redis {
  if (!redisPronto()) throw new RedisIndisponivelError();
  return redisClient as Redis;
}

/** Desiste de uma operação que passa do limite: a rota nunca fica esperando o Redis voltar. */
export function comLimite<T>(operacao: Promise<T>, ms = LIMITE_REDIS_MS): Promise<T> {
  const limite = new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error(`sem resposta em ${ms} ms`)), ms));
  return Promise.race([operacao, limite]);
}

/** Cache é opcional: se o Redis estiver fora do ar, devolve null (como um MISS) em vez de lançar erro. */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (!redisPronto()) return null;
  try {
    const data = await comLimite(getRedisClient().get(key));
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  } catch {
    return null;
  }
}

/** Devolve true se gravou no cache, false se o Redis não estava disponível. */
export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<boolean> {
  if (!redisPronto()) return false;
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    await comLimite(getRedisClient().set(key, serialized, "EX", ttlSeconds));
    return true;
  } catch {
    return false;
  }
}

/** Devolve true se invalidou, false se o Redis não estava disponível (o TTL limpa depois). */
export async function cacheDel(key: string): Promise<boolean> {
  if (!redisPronto()) return false;
  try {
    await comLimite(getRedisClient().del(key));
    return true;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log("[Redis] Conexão encerrada.");
  }
}
