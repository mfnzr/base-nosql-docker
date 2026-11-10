/**
 * Módulo 11 — mede uma rota da API: dispara várias requisições, algumas ao
 * mesmo tempo, e mostra a vazão (requisições por segundo) e a latência
 * (média, p50, p95 e p99).
 *
 * Uso (dentro do container):
 *   docker exec nosql_app npm run benchmark -- "http://localhost:3400/api/..." 500 10
 *   (URL, total de requisições, requisições simultâneas)
 */

const [url, totalTexto = "500", simultaneasTexto = "10"] = process.argv.slice(2);
const total = Number(totalTexto);
const simultaneas = Number(simultaneasTexto);

if (!url) {
  console.error('Uso: npm run benchmark -- "<url>" [requisições] [simultâneas]');
  process.exit(1);
}

// Valor abaixo do qual ficam "p" por cento das medidas (p95: 95% das requisições foram mais rápidas)
function percentil(ordenados: number[], p: number): number {
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)];
}

async function medir() {
  const tempos: number[] = [];
  let erros = 0;
  let proxima = 0;

  // Cada "cliente" pega a próxima requisição da fila até acabar
  async function cliente() {
    while (proxima < total) {
      proxima++;
      const inicio = performance.now();
      try {
        const resposta = await fetch(url);
        await resposta.arrayBuffer();
        if (!resposta.ok) erros++;
      } catch {
        erros++;
      }
      tempos.push(performance.now() - inicio);
    }
  }

  const inicio = performance.now();
  await Promise.all(Array.from({ length: simultaneas }, cliente));
  const segundos = (performance.now() - inicio) / 1000;

  const ordenados = [...tempos].sort((a, b) => a - b);
  const ms = (v: number) => `${v.toFixed(1)} ms`;
  console.log(`requisições  ${total} (${simultaneas} ao mesmo tempo), ${erros} com erro`);
  console.log(`vazão        ${(total / segundos).toFixed(0)} requisições por segundo`);
  console.log(`latência     média ${ms(tempos.reduce((a, b) => a + b, 0) / tempos.length)}`);
  console.log(`             p50 ${ms(percentil(ordenados, 50))} · p95 ${ms(percentil(ordenados, 95))} · p99 ${ms(percentil(ordenados, 99))}`);
}

medir();
