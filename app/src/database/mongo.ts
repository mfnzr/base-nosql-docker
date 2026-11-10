import { MongoClient, Db, Collection, Document } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGO_URI || "mongodb://root:root@localhost:27017";
const dbName = process.env.MONGO_DB_NAME || "domingueira";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (!database) {
    const novo = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 2000,
    });
    try {
      await novo.connect();
    } catch (err) {
      await novo.close().catch(() => {}); // não deixa um client quebrado "preso" para as próximas tentativas
      throw err;
    }
    client = novo;
    database = client.db(dbName);
    console.log(`[MongoDB] Conectado com sucesso ao banco '${dbName}'!`);
  }
  return database;
}

export function getDb(): Db {
  if (!database) {
    throw new Error("MongoDB não inicializado. Chame connectMongo() antes de acessar o banco.");
  }
  return database;
}

export function getCollection<T extends Document = Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    database = null;
    console.log("[MongoDB] Conexão encerrada.");
  }
}
