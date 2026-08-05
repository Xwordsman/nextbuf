import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const work = await mkdtemp(path.join(os.tmpdir(), "nextbuf-compose-dollar-"));
const composeCommand = process.env.NEXTBUF_COMPOSE_BIN || "docker";
const composePrefix = process.env.NEXTBUF_COMPOSE_BIN ? [] : ["compose"];
const composeEnvironment = { ...process.env };
for (const key of ["AUTH_SECRET", "TOPIC_VIEW_PREVIOUS_AUTH_SECRETS", "NAME", "OLD"]) {
  delete composeEnvironment[key];
}

const authSecret = ` "auth $NAME \${NAME} $$ # \\'"\tsecret ${"z".repeat(32)}" `;
const previousAuthSecrets = JSON.stringify([
  ` "old $OLD \${OLD} $$ # \\'"\tsecret ${"y".repeat(32)}" `,
  `second-old-secret-${"x".repeat(32)}`,
]);

function yamlValue(value) {
  return JSON.stringify(value.split("$").join("$$"));
}

function envValue(value) {
  return JSON.stringify(value.split("$").join("$$"));
}

function renderCompose(args) {
  const result = spawnSync(composeCommand, [...composePrefix, ...args], {
    encoding: "utf8",
    env: composeEnvironment,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.doesNotMatch(result.stderr, /variable is not set/i);
  // Compose escapes every dollar after serialization so its output is reusable.
  return JSON.parse(result.stdout.split("$$").join("$"));
}

try {
  const panelCompose = path.join(work, "compose.baota.yml");
  await writeFile(
    panelCompose,
    [
      "name: nextbuf-dollar-panel",
      "x-app: &app",
      "  image: alpine",
      "  environment:",
      `    AUTH_SECRET: ${yamlValue(authSecret)}`,
      `    TOPIC_VIEW_PREVIOUS_AUTH_SECRETS: ${yamlValue(previousAuthSecrets)}`,
      "services:",
      "  nextbuf:",
      "    <<: *app",
      "  worker:",
      "    <<: *app",
      "",
    ].join("\n"),
  );
  const panel = renderCompose(["-f", panelCompose, "config", "--format", "json"]);
  for (const serviceName of ["nextbuf", "worker"]) {
    assert.equal(panel.services[serviceName].environment.AUTH_SECRET, authSecret);
    assert.equal(
      panel.services[serviceName].environment.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS,
      previousAuthSecrets,
    );
  }

  const controlledCompose = path.join(work, "compose.yml");
  const controlledEnvironment = path.join(work, "config.env");
  await Promise.all([
    writeFile(
      controlledCompose,
      [
        "name: nextbuf-dollar-controlled",
        "services:",
        "  web:",
        "    image: alpine",
        "    environment:",
        "      AUTH_SECRET: ${AUTH_SECRET}",
        "      TOPIC_VIEW_PREVIOUS_AUTH_SECRETS: ${TOPIC_VIEW_PREVIOUS_AUTH_SECRETS:-[]}",
        "  worker:",
        "    image: alpine",
        "    environment:",
        "      AUTH_SECRET: ${AUTH_SECRET}",
        "      TOPIC_VIEW_PREVIOUS_AUTH_SECRETS: ${TOPIC_VIEW_PREVIOUS_AUTH_SECRETS:-[]}",
        "",
      ].join("\n"),
    ),
    writeFile(
      controlledEnvironment,
      [
        `AUTH_SECRET=${envValue(authSecret)}`,
        `TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=${envValue(previousAuthSecrets)}`,
        "",
      ].join("\n"),
    ),
  ]);
  const controlled = renderCompose([
    "--env-file",
    controlledEnvironment,
    "-f",
    controlledCompose,
    "config",
    "--format",
    "json",
  ]);
  for (const serviceName of ["web", "worker"]) {
    assert.equal(controlled.services[serviceName].environment.AUTH_SECRET, authSecret);
    assert.equal(
      controlled.services[serviceName].environment.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS,
      previousAuthSecrets,
    );
  }

  process.stdout.write("Compose dollar round-trip checks passed.\n");
} finally {
  await rm(work, { recursive: true, force: true });
}
