import { Client } from "@elastic/elasticsearch";
import dotenv from "dotenv";

dotenv.config();

const node = process.env.ELASTICSEARCH_NODE || "http://localhost:9200";

let elasticClient: Client | null = null;

export function getElasticClient(): Client {
  if (!elasticClient) {
    elasticClient = new Client({
      node,
      maxRetries: 1,
      requestTimeout: 2000,
    });
  }
  return elasticClient;
}

export async function connectElastic(): Promise<Client> {
  const client = getElasticClient();
  try {
    const health = await client.cluster.health({});
    console.log(`[Elasticsearch] Conectado com sucesso! Status do cluster: ${health.status}`);
  } catch (err: any) {
    console.warn(`[Elasticsearch] Aviso: Cluster não respondeu no startup (${err.message}). Verifique se o container está rodando.`);
  }
  return client;
}

export async function closeElastic(): Promise<void> {
  if (elasticClient) {
    await elasticClient.close();
    elasticClient = null;
    console.log("[Elasticsearch] Conexão encerrada.");
  }
}
