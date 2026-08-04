#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUB_MODE = "NEXTBUF_ARCHIVE_BAOTA_DOCKER_STUB";
const STUB_ROOT = "NEXTBUF_ARCHIVE_BAOTA_STUB_ROOT";
const RELEASE_ROOT = "NEXTBUF_ARCHIVE_BAOTA_RELEASE_ROOT";
const MARKER_PATH = "NEXTBUF_ARCHIVE_BAOTA_MARKER";
const HELPER_CONTAINER = "nextbuf-archive-helper";

function fail(message) {
  throw new Error(message);
}

function json(value) {
  return `${JSON.stringify(value)}\n`;
}

function environmentEntries(environment) {
  return Object.entries(environment).map(([key, value]) => `${key}=${value}`);
}

function service(image, containerName, environment, source, target) {
  return {
    image,
    container_name: containerName,
    environment,
    volumes: [{ type: "volume", source, target }],
  };
}

function container(name, serviceName, image, environment, volumeName, target) {
  return {
    Id: `${serviceName}-${"1".repeat(32)}`,
    Name: `/${name}`,
    Image: image,
    Config: {
      Image:
        serviceName === "nextbuf" || serviceName === "worker"
          ? "ghcr.io/xwordsman/nextbuf:latest"
          : serviceName === "postgres"
            ? "postgres:18-alpine"
            : "redis:8-alpine",
      Env: environmentEntries(environment),
      Labels: {
        "com.docker.compose.project": "nextbuf",
        "com.docker.compose.service": serviceName,
      },
    },
    Mounts: [{ Type: "volume", Name: volumeName, Destination: target }],
  };
}

function createFixture() {
  const imageReference = "ghcr.io/xwordsman/nextbuf:latest";
  const imageId = `sha256:${"a".repeat(64)}`;
  const appEnvironment = {
    NODE_ENV: "production",
    APP_URL: "https://archive.example.test",
    AUTH_SECRET: "archive-helper-auth-secret-at-least-32-characters",
    TOPIC_VIEW_PREVIOUS_AUTH_SECRETS: "[]",
    MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    DATABASE_URL: "postgresql://nextbuf:archive-password@postgres:5432/nextbuf",
    DATABASE_DIRECT_URL: "postgresql://nextbuf:archive-password@postgres:5432/nextbuf",
    REDIS_URL: "redis://:archive-redis-password@redis:6379/0",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_PATH: "/app/data/uploads",
  };
  const identity = {
    NEXTBUF_VERSION: "1.0.0",
    NEXTBUF_COMMIT: "b".repeat(40),
    NEXTBUF_BUILD_TIME: "2026-08-01T00:00:00Z",
  };
  const runningAppEnvironment = { ...appEnvironment, ...identity };
  const postgresEnvironment = {
    POSTGRES_DB: "nextbuf",
    POSTGRES_USER: "nextbuf",
    POSTGRES_PASSWORD: "archive-password",
  };
  const redisEnvironment = { REDIS_PASSWORD: "archive-redis-password" };
  const compose = {
    name: "nextbuf",
    services: {
      nextbuf: service(imageReference, "nextbuf", appEnvironment, "uploads", "/app/data/uploads"),
      worker: service(
        imageReference,
        "nextbuf-worker",
        appEnvironment,
        "uploads",
        "/app/data/uploads",
      ),
      postgres: service(
        "postgres:18-alpine",
        "nextbuf-postgres",
        postgresEnvironment,
        "postgres",
        "/var/lib/postgresql",
      ),
      redis: service("redis:8-alpine", "nextbuf-redis", redisEnvironment, "redis", "/data"),
    },
    volumes: { uploads: {}, postgres: {}, redis: {} },
  };
  compose.services.nextbuf.ports = [{ published: "3000", target: 3000 }];

  const containers = [
    container(
      "nextbuf",
      "nextbuf",
      imageId,
      runningAppEnvironment,
      "nextbuf_uploads",
      "/app/data/uploads",
    ),
    container(
      "nextbuf-worker",
      "worker",
      imageId,
      runningAppEnvironment,
      "nextbuf_uploads",
      "/app/data/uploads",
    ),
    container(
      "nextbuf-postgres",
      "postgres",
      `sha256:${"c".repeat(64)}`,
      postgresEnvironment,
      "nextbuf_postgres",
      "/var/lib/postgresql",
    ),
    container(
      "nextbuf-redis",
      "redis",
      `sha256:${"d".repeat(64)}`,
      redisEnvironment,
      "nextbuf_redis",
      "/data",
    ),
  ];
  const volumes = [
    {
      Name: "nextbuf_uploads",
      Labels: { "com.docker.compose.project": "nextbuf", "com.docker.compose.volume": "uploads" },
    },
    {
      Name: "nextbuf_postgres",
      Labels: { "com.docker.compose.project": "nextbuf", "com.docker.compose.volume": "postgres" },
    },
    {
      Name: "nextbuf_redis",
      Labels: { "com.docker.compose.project": "nextbuf", "com.docker.compose.volume": "redis" },
    },
  ];
  const images = [
    {
      Id: imageId,
      RepoTags: [imageReference],
      RepoDigests: [`ghcr.io/xwordsman/nextbuf@sha256:${"f".repeat(64)}`],
      Config: { Env: environmentEntries(identity) },
    },
  ];
  return { compose, containers, volumes, images, imageId, identity };
}

async function writeFixture(root, fixture) {
  await Promise.all([
    writeFile(path.join(root, "compose.json"), json(fixture.compose)),
    writeFile(path.join(root, "containers.json"), json(fixture.containers)),
    writeFile(path.join(root, "volumes.json"), json(fixture.volumes)),
    writeFile(path.join(root, "image.json"), json(fixture.images)),
  ]);
}

async function runArchiveSmoke(releaseRoot) {
  const work = await mkdtemp(path.join(os.tmpdir(), "nextbuf-release-baota-helper-"));
  try {
    const fixture = createFixture();
    const bin = path.join(work, "bin");
    const containerRoot = path.join(work, "container");
    await mkdir(bin, { recursive: true });
    await mkdir(containerRoot, { recursive: true });
    await writeFixture(work, fixture);
    const source = fileURLToPath(import.meta.url);
    const fakeDocker = path.join(bin, "docker");
    await copyFile(source, fakeDocker);
    await chmod(fakeDocker, 0o755);
    const composePath = path.join(work, "compose.baota.yml");
    await writeFile(composePath, "services: {}\n");
    const markerPath = path.join(work, "helper-marker.json");
    const backupDir = path.join(work, "backups");
    const pathSeparator = path.delimiter;
    const nextbufctl = path.join(releaseRoot, "nextbufctl");
    const result = spawnSync(nextbufctl, ["backup", "--baota", composePath], {
      cwd: releaseRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${pathSeparator}${process.env.PATH ?? ""}`,
        [STUB_MODE]: "1",
        [STUB_ROOT]: work,
        [RELEASE_ROOT]: releaseRoot,
        [MARKER_PATH]: markerPath,
        NEXTBUF_BACKUP_DIR: backupDir,
      },
    });
    if (result.error) throw result.error;
    assert.notEqual(
      result.status,
      0,
      "BaoTa helper preflight must reach the controlled stop point",
    );
    const transcript = `${result.stdout}\n${result.stderr}`;
    assert.match(
      transcript,
      /PostgreSQL returned an invalid database size/,
      `preflight did not reach the expected post-helper boundary:\n${transcript}`,
    );
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    assert.equal(
      marker.helperSource,
      path.join(releaseRoot, "runtime", "scripts", "prepare-baota-backup.mjs"),
      "nextbufctl did not resolve the helper from the archived runtime",
    );
    assert.equal(marker.helperOutputValidated, true);
    process.stdout.write("Release archive BaoTa helper preflight passed.\n");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function fixturePath(name) {
  return path.join(path.resolve(process.env[STUB_ROOT] ?? fail(`${STUB_ROOT} is missing`)), name);
}

function containerFile(name) {
  const root = path.resolve(process.env[STUB_ROOT] ?? fail(`${STUB_ROOT} is missing`), "container");
  assert(name.startsWith("/tmp/"), `unexpected helper container path: ${name}`);
  return path.join(root, name.slice(1));
}

function assertHelperContainerReference(reference) {
  const separator = reference.indexOf(":");
  assert(separator > 0, `invalid helper container reference: ${reference}`);
  assert.equal(reference.slice(0, separator), HELPER_CONTAINER);
  return containerFile(reference.slice(separator + 1));
}

async function dockerStub(args) {
  const fixture = {
    compose: JSON.parse(await readFile(fixturePath("compose.json"), "utf8")),
    containers: JSON.parse(await readFile(fixturePath("containers.json"), "utf8")),
    volumes: JSON.parse(await readFile(fixturePath("volumes.json"), "utf8")),
    images: JSON.parse(await readFile(fixturePath("image.json"), "utf8")),
  };
  const stateRoot = path.resolve(process.env[STUB_ROOT] ?? fail(`${STUB_ROOT} is missing`));
  const stateFile = (name) => path.join(stateRoot, name);
  const writeOutput = (value) => process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
  const command = args[0];

  if (command === "compose") {
    if (args.includes("version")) return;
    if (args.includes("ps")) {
      const serviceName = args[args.length - 1];
      const ids = {
        nextbuf: fixture.containers[0].Id,
        worker: fixture.containers[1].Id,
        postgres: fixture.containers[2].Id,
        redis: fixture.containers[3].Id,
      };
      writeOutput(ids[serviceName] ?? fail(`unexpected Compose service: ${serviceName}`));
      return;
    }
    if (args.includes("config")) {
      if (args.includes("--format") && args[args.indexOf("--format") + 1] === "json") {
        writeOutput(json(fixture.compose));
      }
      return;
    }
    fail(`unexpected docker compose invocation: ${args.join(" ")}`);
  }

  if (command === "inspect") {
    if (args[1] === "--format") {
      const format = args[2];
      const targets = args.slice(3);
      if (format === "{{.Id}}") {
        writeOutput(
          fixture.containers.find((candidate) => candidate.Name === `/${targets[0]}`)?.Id ?? "",
        );
        return;
      }
      if (format === "{{.Image}}") {
        writeOutput(fixture.images[0].Id);
        return;
      }
      if (format.includes(".State.Health")) {
        writeOutput("healthy");
        return;
      }
      if (format.includes(".Mounts")) {
        for (const target of targets) {
          const candidate = fixture.containers.find((entry) => entry.Name === `/${target}`);
          for (const mount of candidate?.Mounts ?? []) writeOutput(mount.Name);
        }
        return;
      }
      fail(`unexpected docker inspect format: ${format}`);
    }
    writeOutput(json(fixture.containers));
    return;
  }

  if (command === "volume" && args[1] === "inspect") {
    writeOutput(json(fixture.volumes));
    return;
  }

  if (command === "image" && args[1] === "inspect") {
    writeOutput(json(fixture.images));
    return;
  }

  if (command === "create") {
    await writeFile(stateFile("create-args.json"), json(args));
    await mkdir(path.dirname(containerFile("/tmp/placeholder")), { recursive: true });
    writeOutput(HELPER_CONTAINER);
    return;
  }

  if (command === "cp") {
    const source = args[1];
    const destination = args[2];
    if (destination.startsWith(`${HELPER_CONTAINER}:`)) {
      const destinationPath = assertHelperContainerReference(destination);
      if (destination.endsWith(":/tmp/prepare-baota-backup.mjs")) {
        const releaseRoot = path.resolve(
          process.env[RELEASE_ROOT] ?? fail(`${RELEASE_ROOT} is missing`),
        );
        assert.equal(
          path.resolve(source),
          path.join(releaseRoot, "runtime", "scripts", "prepare-baota-backup.mjs"),
          "archive nextbufctl passed a non-archived BaoTa helper",
        );
        await writeFile(stateFile("helper-source.txt"), path.resolve(source));
      }
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(source, destinationPath);
      return;
    }
    if (source.startsWith(`${HELPER_CONTAINER}:`)) {
      const sourcePath = assertHelperContainerReference(source);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(sourcePath, destination);
      return;
    }
    fail(`unexpected docker cp invocation: ${args.join(" ")}`);
  }

  if (command === "start") {
    assert.equal(args[1], "--attach");
    assert.equal(args[2], HELPER_CONTAINER);
    const createArgs = JSON.parse(await readFile(stateFile("create-args.json"), "utf8"));
    const image = fixture.images[0].Id;
    const imageIndex = createArgs.lastIndexOf(image);
    assert(imageIndex >= 0, "helper container was not created from the inspected image");
    const commandPaths = createArgs.slice(imageIndex + 1);
    assert.deepEqual(commandPaths, [
      "/tmp/prepare-baota-backup.mjs",
      "/tmp/source-compose.rendered.json",
      "/tmp/source-containers.json",
      "/tmp/source-volumes.json",
      "/tmp/source-image.json",
      "/tmp/.env.example",
      "/tmp/config.env",
      "/tmp/source-deployment.json",
    ]);
    const helperResult = spawnSync(
      process.execPath,
      commandPaths.map((value) => containerFile(value)),
      { encoding: "utf8", env: process.env },
    );
    if (helperResult.stdout) process.stdout.write(helperResult.stdout);
    if (helperResult.stderr) process.stderr.write(helperResult.stderr);
    if (helperResult.error) throw helperResult.error;
    assert.equal(
      helperResult.status,
      0,
      "archived BaoTa helper failed inside the temporary container",
    );
    const environment = await readFile(containerFile("/tmp/config.env"), "utf8");
    const identity = JSON.parse(
      await readFile(containerFile("/tmp/source-deployment.json"), "utf8"),
    );
    assert.match(environment, /^NEXTBUF_VERSION=1\.0\.0$/m);
    assert.match(environment, /^NEXTBUF_IMAGE=ghcr\.io\/xwordsman\/nextbuf$/m);
    assert.equal(identity.format, "nextbuf-baota-source-v1");
    assert.equal(identity.suppliedComposeMatchesRunningContainers, true);
    await writeFile(
      process.env[MARKER_PATH] ?? fail(`${MARKER_PATH} is missing`),
      json({
        helperSource: await readFile(stateFile("helper-source.txt"), "utf8"),
        helperOutputValidated: true,
      }),
    );
    return;
  }

  if (command === "rm") return;

  if (command === "exec") {
    writeOutput("not-a-number");
    return;
  }

  fail(`unexpected Docker invocation: ${args.join(" ")}`);
}

const stub = process.env[STUB_MODE] === "1";
try {
  if (stub) {
    await dockerStub(process.argv.slice(2));
  } else {
    const releaseRoot = process.argv[2];
    if (!releaseRoot)
      fail("Usage: release-archive-baota-helper-smoke.mjs <extracted-release-root>");
    await runArchiveSmoke(path.resolve(releaseRoot));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
