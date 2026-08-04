import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helper = path.join(root, "scripts", "prepare-baota-backup.mjs");
const template = path.join(root, ".env.example");
const work = await mkdtemp(path.join(os.tmpdir(), "nextbuf-baota-config-"));
const imageId = `sha256:${"a".repeat(64)}`;
const commit = "b".repeat(40);
const imageInjectedEnvironment = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  NODE_VERSION: "24.0.0",
  NEXT_TELEMETRY_DISABLED: "1",
  HOSTNAME: "0.0.0.0",
  PORT: "3000",
};

const appEnvironment = {
  NODE_ENV: "production",
  TZ: "Asia/Shanghai",
  APP_URL: "https://community.example.com",
  AUTH_SECRET: "a".repeat(64),
  TOPIC_VIEW_PREVIOUS_AUTH_SECRETS: "[]",
  SETUP_TOKEN: "c".repeat(64),
  AUTH_REGISTRATION_MODE: "invite",
  MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "smtp-user",
  SMTP_PASSWORD: "smtp-password",
  SMTP_FROM: "NextBuf <noreply@example.com>",
  DATABASE_URL: `postgresql://nextbuf:${"d".repeat(64)}@postgres:5432/nextbuf`,
  DATABASE_DIRECT_URL: `postgresql://nextbuf:${"d".repeat(64)}@postgres:5432/nextbuf`,
  REDIS_URL: `redis://:${"e".repeat(64)}@redis:6379/0`,
  REDIS_PREFIX: "nextbuf",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_PATH: "/app/data/uploads",
};

function environmentEntries(environment, extras = {}) {
  return Object.entries({ ...extras, ...environment }).map(([key, value]) => `${key}=${value}`);
}

function service(image, containerName, environment, volumeSource, volumeTarget) {
  return {
    image,
    container_name: containerName,
    environment,
    volumes: [{ type: "volume", source: volumeSource, target: volumeTarget }],
  };
}

function container(name, serviceName, image, environment, volumeName, volumeTarget) {
  return {
    Id: `${serviceName}-${"1".repeat(32)}`,
    Name: `/${name}`,
    Image: imageId,
    Config: {
      Image: image,
      Env: environmentEntries(environment),
      Labels: {
        "com.docker.compose.project": "nextbuf",
        "com.docker.compose.service": serviceName,
      },
    },
    Mounts: [{ Type: "volume", Name: volumeName, Destination: volumeTarget }],
  };
}

function volume(name, composeVolume) {
  return {
    Name: name,
    Labels: {
      "com.docker.compose.project": "nextbuf",
      "com.docker.compose.volume": composeVolume,
    },
  };
}

const imageReference = "ghcr.io/xwordsman/nextbuf:latest";
const postgresEnvironment = {
  POSTGRES_DB: "nextbuf",
  POSTGRES_USER: "nextbuf",
  POSTGRES_PASSWORD: "d".repeat(64),
  PGDATA: "/var/lib/postgresql/18/docker",
  TZ: "Asia/Shanghai",
};
const redisEnvironment = { REDIS_PASSWORD: "e".repeat(64), TZ: "Asia/Shanghai" };
const compose = {
  name: "nextbuf",
  services: {
    nextbuf: service(
      imageReference,
      "nextbuf",
      appEnvironment,
      "nextbuf_uploads",
      "/app/data/uploads",
    ),
    worker: service(
      imageReference,
      "nextbuf-worker",
      appEnvironment,
      "nextbuf_uploads",
      "/app/data/uploads",
    ),
    postgres: service(
      "postgres:18-alpine",
      "nextbuf-postgres",
      postgresEnvironment,
      "nextbuf_postgres",
      "/var/lib/postgresql",
    ),
    redis: service("redis:8-alpine", "nextbuf-redis", redisEnvironment, "nextbuf_redis", "/data"),
  },
  volumes: {
    nextbuf_uploads: {},
    nextbuf_postgres: {},
    nextbuf_redis: {},
  },
};
compose.services.nextbuf.ports = [{ host_ip: "127.0.0.1", published: "3000", target: 3000 }];
const containers = [
  container(
    "nextbuf",
    "nextbuf",
    imageReference,
    {
      ...imageInjectedEnvironment,
      ...appEnvironment,
      NEXTBUF_VERSION: "0.13.8",
      NEXTBUF_COMMIT: commit,
      NEXTBUF_BUILD_TIME: "2026-08-01T00:00:00Z",
    },
    "nextbuf_nextbuf_uploads",
    "/app/data/uploads",
  ),
  container(
    "nextbuf-worker",
    "worker",
    imageReference,
    {
      ...imageInjectedEnvironment,
      ...appEnvironment,
      NEXTBUF_VERSION: "0.13.8",
      NEXTBUF_COMMIT: commit,
      NEXTBUF_BUILD_TIME: "2026-08-01T00:00:00Z",
    },
    "nextbuf_nextbuf_uploads",
    "/app/data/uploads",
  ),
  container(
    "nextbuf-postgres",
    "postgres",
    "postgres:18-alpine",
    postgresEnvironment,
    "nextbuf_nextbuf_postgres",
    "/var/lib/postgresql",
  ),
  container(
    "nextbuf-redis",
    "redis",
    "redis:8-alpine",
    redisEnvironment,
    "nextbuf_nextbuf_redis",
    "/data",
  ),
];
const volumes = [
  volume("nextbuf_nextbuf_uploads", "nextbuf_uploads"),
  volume("nextbuf_nextbuf_postgres", "nextbuf_postgres"),
  volume("nextbuf_nextbuf_redis", "nextbuf_redis"),
];
const images = [
  {
    Id: imageId,
    RepoTags: [imageReference],
    RepoDigests: [`ghcr.io/xwordsman/nextbuf@sha256:${"f".repeat(64)}`],
    Config: {
      Env: [
        ...environmentEntries(imageInjectedEnvironment),
        "NODE_ENV=production",
        "NEXTBUF_VERSION=0.13.8",
        `NEXTBUF_COMMIT=${commit}`,
        "NEXTBUF_BUILD_TIME=2026-08-01T00:00:00Z",
      ],
    },
  },
];

async function runFixture(
  name,
  fixtureCompose = compose,
  fixtureContainers = containers,
  fixtureVolumes = volumes,
) {
  const directory = path.join(work, name);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(directory, { recursive: true }));
  const composePath = path.join(directory, "compose.json");
  const containersPath = path.join(directory, "containers.json");
  const volumesPath = path.join(directory, "volumes.json");
  const imagePath = path.join(directory, "image.json");
  const envOutput = path.join(directory, "config.env");
  const identityOutput = path.join(directory, "identity.json");
  await Promise.all([
    writeFile(composePath, JSON.stringify(fixtureCompose)),
    writeFile(containersPath, JSON.stringify(fixtureContainers)),
    writeFile(volumesPath, JSON.stringify(fixtureVolumes)),
    writeFile(imagePath, JSON.stringify(images)),
  ]);
  const result = spawnSync(
    process.execPath,
    [
      helper,
      composePath,
      containersPath,
      volumesPath,
      imagePath,
      template,
      envOutput,
      identityOutput,
    ],
    { encoding: "utf8" },
  );
  return { result, envOutput, identityOutput };
}

try {
  const success = await runFixture("success");
  assert.equal(success.result.status, 0, success.result.stderr);
  const environment = await readFile(success.envOutput, "utf8");
  assert.match(environment, /^NEXTBUF_IMAGE=ghcr\.io\/xwordsman\/nextbuf$/m);
  assert.match(environment, /^NEXTBUF_VERSION=0\.13\.8$/m);
  assert.match(environment, new RegExp(`^POSTGRES_PASSWORD=${"d".repeat(64)}$`, "m"));
  assert.match(environment, new RegExp(`^REDIS_PASSWORD=${"e".repeat(64)}$`, "m"));
  assert.match(environment, /^APP_URL=https:\/\/community\.example\.com$/m);
  const identity = JSON.parse(await readFile(success.identityOutput, "utf8"));
  assert.equal(identity.application.imageConfigId, imageId);
  assert.equal(identity.application.repoDigestScope, "recorded-verbatim-not-oci-index-proof");
  assert.equal(identity.volumes.uploads.name, "nextbuf_nextbuf_uploads");
  assert.equal(identity.suppliedComposeMatchesRunningContainers, true);

  const absentManagedCompose = structuredClone(compose);
  const absentManagedContainers = structuredClone(containers);
  for (const serviceName of ["nextbuf", "worker"]) {
    delete absentManagedCompose.services[serviceName].environment.SETUP_TOKEN;
    delete absentManagedCompose.services[serviceName].environment.AUTH_REGISTRATION_MODE;
  }
  for (const containerState of absentManagedContainers.slice(0, 2)) {
    containerState.Config.Env = containerState.Config.Env.filter(
      (entry) => !entry.startsWith("SETUP_TOKEN=") && !entry.startsWith("AUTH_REGISTRATION_MODE="),
    );
  }
  const absentManaged = await runFixture(
    "absent-managed-environment",
    absentManagedCompose,
    absentManagedContainers,
  );
  assert.equal(absentManaged.result.status, 0, absentManaged.result.stderr);
  const absentManagedEnvironment = await readFile(absentManaged.envOutput, "utf8");
  assert.doesNotMatch(absentManagedEnvironment, /^SETUP_TOKEN=/m);
  assert.doesNotMatch(absentManagedEnvironment, /^AUTH_REGISTRATION_MODE=/m);
  assert.match(absentManagedEnvironment, /^APP_URL=https:\/\/community\.example\.com$/m);

  const complexAuthSecret = ` \"auth $NAME \${NAME} $$ # \\'\"\tsecret ${"z".repeat(32)}\" `;
  const complexPreviousSecrets = JSON.stringify([
    ` \"old $OLD \${OLD} $$ # \\'\"\tsecret ${"y".repeat(32)}\" `,
    `second-old-secret-${"x".repeat(32)}`,
  ]);
  const complexSecretCompose = structuredClone(compose);
  const complexSecretContainers = structuredClone(containers);
  for (const serviceName of ["nextbuf", "worker"]) {
    complexSecretCompose.services[serviceName].environment.AUTH_SECRET = complexAuthSecret;
    complexSecretCompose.services[serviceName].environment.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS =
      complexPreviousSecrets;
  }
  for (const containerState of complexSecretContainers.slice(0, 2)) {
    containerState.Config.Env = containerState.Config.Env.map((entry) => {
      if (entry.startsWith("AUTH_SECRET=")) return `AUTH_SECRET=${complexAuthSecret}`;
      if (entry.startsWith("TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=")) {
        return `TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=${complexPreviousSecrets}`;
      }
      return entry;
    });
  }
  const complexSecrets = await runFixture(
    "complex-secrets",
    complexSecretCompose,
    complexSecretContainers,
  );
  assert.equal(complexSecrets.result.status, 0, complexSecrets.result.stderr);
  const complexEnvironment = await readFile(complexSecrets.envOutput, "utf8");
  assert.ok(
    complexEnvironment.includes(
      `AUTH_SECRET=${JSON.stringify(complexAuthSecret.replaceAll("$", "$$"))}\n`,
    ),
  );
  assert.ok(
    complexEnvironment.includes(
      `TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=${JSON.stringify(complexPreviousSecrets.replaceAll("$", "$$"))}\n`,
    ),
  );

  const controlByteCompose = structuredClone(compose);
  const controlByteContainers = structuredClone(containers);
  const controlByteSecret = `${"q".repeat(32)}\u0001`;
  for (const serviceName of ["nextbuf", "worker"]) {
    controlByteCompose.services[serviceName].environment.AUTH_SECRET = controlByteSecret;
  }
  for (const containerState of controlByteContainers.slice(0, 2)) {
    containerState.Config.Env = containerState.Config.Env.map((entry) =>
      entry.startsWith("AUTH_SECRET=") ? `AUTH_SECRET=${controlByteSecret}` : entry,
    );
  }
  const unsupportedControlByte = await runFixture(
    "unsupported-control-byte",
    controlByteCompose,
    controlByteContainers,
  );
  assert.notEqual(unsupportedControlByte.result.status, 0);
  assert.match(unsupportedControlByte.result.stderr, /unsupported control byte/);

  const lineBreakCompose = structuredClone(compose);
  const lineBreakContainers = structuredClone(containers);
  const lineBreakSecret = `${"r".repeat(32)}\nNEXTBUF_IMAGE=untrusted.example/nextbuf`;
  for (const serviceName of ["nextbuf", "worker"]) {
    lineBreakCompose.services[serviceName].environment.AUTH_SECRET = lineBreakSecret;
  }
  for (const containerState of lineBreakContainers.slice(0, 2)) {
    containerState.Config.Env = containerState.Config.Env.map((entry) =>
      entry.startsWith("AUTH_SECRET=") ? `AUTH_SECRET=${lineBreakSecret}` : entry,
    );
  }
  const injectedLineBreak = await runFixture(
    "injected-line-break",
    lineBreakCompose,
    lineBreakContainers,
  );
  assert.notEqual(injectedLineBreak.result.status, 0);
  assert.match(injectedLineBreak.result.stderr, /line break or unsupported control byte/);

  const driftedContainers = structuredClone(containers);
  driftedContainers[0].Config.Env = driftedContainers[0].Config.Env.map((entry) =>
    entry.startsWith("APP_URL=") ? "APP_URL=https://drifted.example.com" : entry,
  );
  const drift = await runFixture("drift", compose, driftedContainers);
  assert.notEqual(drift.result.status, 0);
  assert.match(drift.result.stderr, /running environment differs.*APP_URL/);

  const missingManagedEnvironmentCompose = structuredClone(compose);
  delete missingManagedEnvironmentCompose.services.nextbuf.environment.SMTP_PASSWORD;
  delete missingManagedEnvironmentCompose.services.worker.environment.SMTP_PASSWORD;
  const missingManagedEnvironment = await runFixture(
    "missing-managed-environment",
    missingManagedEnvironmentCompose,
  );
  assert.notEqual(missingManagedEnvironment.result.status, 0);
  assert.match(
    missingManagedEnvironment.result.stderr,
    /running environment differs.*SMTP_PASSWORD/,
  );

  const missingPostgresPasswordCompose = structuredClone(compose);
  delete missingPostgresPasswordCompose.services.postgres.environment.POSTGRES_PASSWORD;
  const missingPostgresPassword = await runFixture(
    "missing-postgres-password",
    missingPostgresPasswordCompose,
  );
  assert.notEqual(missingPostgresPassword.result.status, 0);
  assert.match(
    missingPostgresPassword.result.stderr,
    /postgres running environment differs.*POSTGRES_PASSWORD/,
  );

  const wrongVolumeContainers = structuredClone(containers);
  wrongVolumeContainers[1].Mounts[0].Name = "unrelated_uploads";
  const wrongVolume = await runFixture("wrong-volume", compose, wrongVolumeContainers);
  assert.notEqual(wrongVolume.result.status, 0);
  assert.match(wrongVolume.result.stderr, /running volume.*differs/);

  const wrongVolumeLabels = structuredClone(volumes);
  wrongVolumeLabels[0].Labels["com.docker.compose.project"] = "unrelated";
  const wrongVolumeOwner = await runFixture(
    "wrong-volume-owner",
    compose,
    containers,
    wrongVolumeLabels,
  );
  assert.notEqual(wrongVolumeOwner.result.status, 0);
  assert.match(wrongVolumeOwner.result.stderr, /does not belong to Compose project/);

  const externalDatabaseCompose = structuredClone(compose);
  const externalDatabaseContainers = structuredClone(containers);
  for (const service of ["nextbuf", "worker"]) {
    externalDatabaseCompose.services[service].environment.DATABASE_URL =
      "postgresql://external:external@database.example.com:5432/external";
    externalDatabaseCompose.services[service].environment.DATABASE_DIRECT_URL =
      "postgresql://external:external@database.example.com:5432/external";
  }
  for (const containerState of externalDatabaseContainers.slice(0, 2)) {
    containerState.Config.Env = containerState.Config.Env.map((entry) =>
      entry.startsWith("DATABASE_")
        ? entry.replace(
            /postgresql:\/\/nextbuf:[^@]+@postgres:5432\/nextbuf/,
            "postgresql://external:external@database.example.com:5432/external",
          )
        : entry,
    );
  }
  const externalDatabase = await runFixture(
    "external-database",
    externalDatabaseCompose,
    externalDatabaseContainers,
  );
  assert.notEqual(externalDatabase.result.status, 0);
  assert.match(externalDatabase.result.stderr, /must point to the bundled nextbuf-postgres/);

  const wrongStorageCompose = structuredClone(compose);
  const wrongStorageContainers = structuredClone(containers);
  for (const service of ["nextbuf", "worker"]) {
    wrongStorageCompose.services[service].environment.STORAGE_LOCAL_PATH = "/tmp/uploads";
  }
  for (const containerState of wrongStorageContainers.slice(0, 2)) {
    containerState.Config.Env = containerState.Config.Env.map((entry) =>
      entry === "STORAGE_LOCAL_PATH=/app/data/uploads" ? "STORAGE_LOCAL_PATH=/tmp/uploads" : entry,
    );
  }
  const wrongStorage = await runFixture(
    "wrong-storage-path",
    wrongStorageCompose,
    wrongStorageContainers,
  );
  assert.notEqual(wrongStorage.result.status, 0);
  assert.match(wrongStorage.result.stderr, /local BaoTa storage must use \/app\/data\/uploads/);

  const extraServiceCompose = structuredClone(compose);
  extraServiceCompose.services.extra = { image: imageReference };
  const extraService = await runFixture("extra-service", extraServiceCompose);
  assert.notEqual(extraService.result.status, 0);
  assert.match(extraService.result.stderr, /must contain exactly/);

  const s3Compose = structuredClone(compose);
  const s3Containers = structuredClone(containers);
  const s3Environment = {
    STORAGE_DRIVER: "s3",
    S3_REGION: "us-east-1",
    S3_BUCKET: "nextbuf-backup-smoke",
    S3_ACCESS_KEY_ID: "smoke-access-key",
    S3_SECRET_ACCESS_KEY: "smoke-secret-key",
  };
  for (const service of ["nextbuf", "worker"]) {
    Object.assign(s3Compose.services[service].environment, s3Environment);
  }
  for (const containerState of s3Containers.slice(0, 2)) {
    containerState.Config.Env = containerState.Config.Env.map((entry) =>
      entry === "STORAGE_DRIVER=local" ? "STORAGE_DRIVER=s3" : entry,
    );
    containerState.Config.Env.push(
      "S3_REGION=us-east-1",
      "S3_BUCKET=nextbuf-backup-smoke",
      "S3_ACCESS_KEY_ID=smoke-access-key",
      "S3_SECRET_ACCESS_KEY=smoke-secret-key",
    );
  }
  const s3WithoutOptionalValues = await runFixture(
    "s3-without-optional-values",
    s3Compose,
    s3Containers,
  );
  assert.equal(s3WithoutOptionalValues.result.status, 0, s3WithoutOptionalValues.result.stderr);
  const s3EnvironmentOutput = await readFile(s3WithoutOptionalValues.envOutput, "utf8");
  assert.doesNotMatch(s3EnvironmentOutput, /^S3_ENDPOINT=/m);
  assert.doesNotMatch(s3EnvironmentOutput, /^S3_FORCE_PATH_STYLE=/m);

  const unsafePasswordContainers = structuredClone(containers);
  unsafePasswordContainers[2].Config.Env = unsafePasswordContainers[2].Config.Env.map((entry) =>
    entry.startsWith("POSTGRES_PASSWORD=") ? "POSTGRES_PASSWORD=not:url-safe" : entry,
  );
  const unsafePasswordCompose = structuredClone(compose);
  unsafePasswordCompose.services.postgres.environment.POSTGRES_PASSWORD = "not:url-safe";
  const unsafePassword = await runFixture(
    "unsafe-password",
    unsafePasswordCompose,
    unsafePasswordContainers,
  );
  assert.notEqual(unsafePassword.result.status, 0);
  assert.match(unsafePassword.result.stderr, /POSTGRES_PASSWORD must use URI-safe characters/);

  process.stdout.write("BaoTa backup configuration checks passed.\n");
} finally {
  await rm(work, { recursive: true, force: true });
}
