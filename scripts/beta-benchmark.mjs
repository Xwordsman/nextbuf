import { writeFile } from "node:fs/promises";

function parseArguments(values) {
  const result = {
    baseUrl: process.env.NEXTBUF_BENCHMARK_BASE_URL ?? "http://127.0.0.1:3000",
    paths: [],
    requests: 30,
    concurrency: 5,
    p95Ms: 2_000,
    maxErrorRate: 0,
    output: undefined,
  };
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const value = values[index + 1];
    if (key === "--base-url" && value) result.baseUrl = value;
    else if (key === "--path" && value) result.paths.push(value);
    else if (key === "--requests" && value) result.requests = Number(value);
    else if (key === "--concurrency" && value) result.concurrency = Number(value);
    else if (key === "--p95-ms" && value) result.p95Ms = Number(value);
    else if (key === "--max-error-rate" && value) result.maxErrorRate = Number(value);
    else if (key === "--output" && value) result.output = value;
    else throw new Error(`Unknown or incomplete benchmark argument: ${key ?? "<empty>"}`);
    index += 1;
  }
  if (result.paths.length === 0) result.paths.push("/", "/search?q=NextBuf", "/health/ready");
  for (const [name, number, minimum, maximum] of [
    ["requests", result.requests, 1, 10_000],
    ["concurrency", result.concurrency, 1, 100],
    ["p95-ms", result.p95Ms, 1, 120_000],
    ["max-error-rate", result.maxErrorRate, 0, 1],
  ]) {
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    }
  }
  return result;
}

function percentile(sorted, value) {
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0;
}

async function benchmarkPath(configuration, pathname) {
  const url = new URL(pathname, configuration.baseUrl);
  const durations = [];
  const failures = [];
  let cursor = 0;
  const startedAt = performance.now();
  const worker = async () => {
    while (cursor < configuration.requests) {
      const requestNumber = cursor;
      cursor += 1;
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(url, {
          headers: process.env.NEXTBUF_BENCHMARK_COOKIE
            ? { cookie: process.env.NEXTBUF_BENCHMARK_COOKIE }
            : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        durations.push(performance.now() - requestStartedAt);
        if (!response.ok) failures.push(`#${requestNumber + 1}: HTTP ${response.status}`);
        await response.body?.cancel();
      } catch (error) {
        durations.push(performance.now() - requestStartedAt);
        failures.push(
          `#${requestNumber + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(configuration.concurrency, configuration.requests) }, worker),
  );
  const wallMs = performance.now() - startedAt;
  const sorted = durations.toSorted((left, right) => left - right);
  return {
    path: `${url.pathname}${url.search}`,
    requests: configuration.requests,
    concurrency: configuration.concurrency,
    errors: failures.length,
    errorRate: failures.length / configuration.requests,
    requestsPerSecond: Number((configuration.requests / (wallMs / 1_000)).toFixed(2)),
    latencyMs: {
      min: Math.round(sorted[0] ?? 0),
      p50: Math.round(percentile(sorted, 0.5)),
      p95: Math.round(percentile(sorted, 0.95)),
      p99: Math.round(percentile(sorted, 0.99)),
      max: Math.round(sorted.at(-1) ?? 0),
    },
    failureSamples: failures.slice(0, 5),
  };
}

const configuration = parseArguments(process.argv.slice(2));
const results = [];
for (const pathname of configuration.paths) {
  results.push(await benchmarkPath(configuration, pathname));
}
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: configuration.baseUrl,
  thresholds: { p95Ms: configuration.p95Ms, maxErrorRate: configuration.maxErrorRate },
  results,
};
const output = `${JSON.stringify(report, null, 2)}\n`;
console.log(output.trim());
if (configuration.output) await writeFile(configuration.output, output);

if (
  results.some(
    (result) =>
      result.latencyMs.p95 > configuration.p95Ms || result.errorRate > configuration.maxErrorRate,
  )
) {
  process.exitCode = 1;
}
