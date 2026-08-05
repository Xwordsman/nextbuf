import { readFile, writeFile } from "node:fs/promises";

const [
  composePath,
  containersPath,
  volumesPath,
  imagePath,
  templatePath,
  environmentOutputPath,
  identityOutputPath,
] = process.argv.slice(2);

if (
  !composePath ||
  !containersPath ||
  !volumesPath ||
  !imagePath ||
  !templatePath ||
  !environmentOutputPath ||
  !identityOutputPath
) {
  throw new Error(
    "Usage: prepare-baota-backup <compose.json> <containers.json> <volumes.json> <image.json> <env-template> <env-output> <identity-output>",
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseRenderedComposeConfig(serialized) {
  // `docker compose config` doubles every dollar after JSON serialization so
  // its output can be used as Compose input again. Docker inspect reports the
  // actual single-layer value, so remove exactly that output-escaping layer.
  const decoded = [];
  for (let index = 0; index < serialized.length; index += 1) {
    if (serialized[index] !== "$") {
      decoded.push(serialized[index]);
      continue;
    }
    assert(
      serialized[index + 1] === "$",
      "rendered Compose configuration contains an invalid dollar escape",
    );
    decoded.push("$");
    index += 1;
  }
  return JSON.parse(decoded.join(""));
}

function object(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function environmentMap(entries, label) {
  assert(Array.isArray(entries), `${label} environment must be an array`);
  const result = new Map();
  for (const entry of entries) {
    assert(typeof entry === "string", `${label} environment contains a non-string value`);
    const separator = entry.indexOf("=");
    assert(separator > 0, `${label} environment contains an invalid entry`);
    const key = entry.slice(0, separator);
    assert(!result.has(key), `${label} environment contains duplicate ${key}`);
    result.set(key, entry.slice(separator + 1));
  }
  return result;
}

function requiredEnvironment(environment, key, label) {
  assert(environment.has(key), `${label} environment is missing ${key}`);
  return environment.get(key);
}

function containerName(container) {
  assert(typeof container.Name === "string", "container name is missing");
  return container.Name.replace(/^\//, "");
}

function labelsFor(container) {
  return object(container.Config?.Labels ?? {}, `${containerName(container)} labels`);
}

function compareServiceEnvironment(
  serviceName,
  service,
  container,
  actualEnvironment,
  managedEnvironmentKeys,
  imageEnvironment = new Map(),
) {
  const expected = object(service.environment ?? {}, `${serviceName} Compose environment`);
  for (const [key, value] of Object.entries(expected)) {
    assert(
      actualEnvironment.get(key) === String(value),
      `${serviceName} running environment differs from the supplied Compose at ${key}`,
    );
  }
  for (const key of managedEnvironmentKeys) {
    const expectedValue = Object.hasOwn(expected, key)
      ? String(expected[key])
      : imageEnvironment.get(key);
    assert(
      actualEnvironment.get(key) === expectedValue,
      `${serviceName} running environment differs from the supplied Compose at ${key}`,
    );
  }
  assert(
    container.Config?.Image === service.image,
    `${serviceName} running image reference differs from the supplied Compose`,
  );
}

function expectedVolumeNames(compose, projectName, source) {
  const names = new Set([source, `${projectName}_${source}`]);
  const declared = compose.volumes?.[source];
  if (declared && typeof declared === "object" && typeof declared.name === "string") {
    names.add(declared.name);
  }
  return names;
}

function volumeIdentity(
  compose,
  projectName,
  volumesByName,
  serviceName,
  service,
  container,
  target,
) {
  const expected = (service.volumes ?? []).find(
    (volume) => volume && typeof volume === "object" && volume.target === target,
  );
  assert(expected?.type === "volume", `${serviceName} must use a named volume at ${target}`);
  assert(typeof expected.source === "string", `${serviceName} volume at ${target} has no source`);

  const actual = (container.Mounts ?? []).find((mount) => mount.Destination === target);
  assert(actual?.Type === "volume", `${serviceName} running mount at ${target} is not a volume`);
  assert(typeof actual.Name === "string", `${serviceName} running volume at ${target} has no name`);
  assert(
    expectedVolumeNames(compose, projectName, expected.source).has(actual.Name),
    `${serviceName} running volume at ${target} differs from the supplied Compose`,
  );
  const volume = object(volumesByName.get(actual.Name), `Docker volume ${actual.Name}`);
  const labels = object(volume.Labels ?? {}, `Docker volume ${actual.Name} labels`);
  assert(
    labels["com.docker.compose.project"] === projectName,
    `Docker volume ${actual.Name} does not belong to Compose project ${projectName}`,
  );
  assert(
    labels["com.docker.compose.volume"] === expected.source,
    `Docker volume ${actual.Name} does not belong to Compose volume ${expected.source}`,
  );
  return { target, name: actual.Name, composeVolume: expected.source };
}

function imageRepository(reference) {
  const withoutDigest = reference.split("@", 1)[0];
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
}

function parseTemplate(template) {
  const values = new Map();
  for (const line of template.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function serializeEnvironmentValue(key, value) {
  assert(
    !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value),
    `${key} cannot contain a line break or unsupported control byte`,
  );
  const lineParsedKeys = new Set([
    "NEXTBUF_IMAGE",
    "NEXTBUF_VERSION",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    "MAIL_PAYLOAD_KEY",
    "STORAGE_DRIVER",
    "S3_BUCKET",
  ]);
  if (lineParsedKeys.has(key)) {
    assert(!/[\s#$\\']/.test(value), `${key} is not portable to the controlled .env format`);
    return value;
  }
  if (!/[#$\\"']/.test(value) && value === value.trim()) return value;
  // Compose consumes `$$` as a literal `$`; a callback avoids JavaScript's `$$` replacement token.
  return JSON.stringify(value.replaceAll("$", () => "$$"));
}

function renderEnvironment(template, values) {
  const seen = new Set();
  const rendered = template.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) return [line];
    if (!values.has(match[1])) return [];
    seen.add(match[1]);
    return [`${match[1]}=${serializeEnvironmentValue(match[1], values.get(match[1]))}`];
  });
  for (const key of values.keys()) {
    assert(seen.has(key), `environment template is missing ${key}`);
  }
  return `${rendered.join("\n").replace(/\n*$/, "")}\n`;
}

const [compose, containers, volumes, images, template] = await Promise.all([
  readFile(composePath, "utf8").then(parseRenderedComposeConfig),
  readFile(containersPath, "utf8").then(JSON.parse),
  readFile(volumesPath, "utf8").then(JSON.parse),
  readFile(imagePath, "utf8").then(JSON.parse),
  readFile(templatePath, "utf8"),
]);

object(compose, "Compose configuration");
assert(
  Array.isArray(containers) && containers.length === 4,
  "exactly four BaoTa containers are required",
);
assert(Array.isArray(volumes) && volumes.length === 3, "exactly three BaoTa volumes are required");
assert(Array.isArray(images) && images.length === 1, "exactly one application image is required");
const image = object(images[0], "application image");
const imageEnvironment = environmentMap(image.Config?.Env, "application image");
const templateEnvironment = parseTemplate(template);
const values = new Map();
// Reverse comparisons cover only NextBuf-owned configuration, not Docker/base-image metadata.
const applicationManagedEnvironmentKeys = new Set([...templateEnvironment.keys(), "NODE_ENV"]);
const managedEnvironmentByService = {
  nextbuf: applicationManagedEnvironmentKeys,
  worker: applicationManagedEnvironmentKeys,
  postgres: new Set(["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]),
  redis: new Set(["REDIS_PASSWORD"]),
};
const projectName = compose.name;
assert(
  typeof projectName === "string" && projectName.length > 0,
  "Compose project name is missing",
);

const requiredServices = {
  nextbuf: "nextbuf",
  worker: "nextbuf-worker",
  postgres: "nextbuf-postgres",
  redis: "nextbuf-redis",
};
const composeServices = object(compose.services, "Compose services");
assert(
  Object.keys(composeServices).sort().join("\n") ===
    Object.keys(requiredServices).sort().join("\n"),
  "BaoTa Compose must contain exactly nextbuf, worker, postgres and redis services",
);
const containersByName = new Map(
  containers.map((container) => [containerName(container), container]),
);
const volumesByName = new Map();
for (const candidate of volumes) {
  const volume = object(candidate, "Docker volume");
  assert(
    typeof volume.Name === "string" && volume.Name.length > 0,
    "Docker volume name is missing",
  );
  assert(!volumesByName.has(volume.Name), `duplicate Docker volume ${volume.Name}`);
  volumesByName.set(volume.Name, volume);
}
const serviceState = {};
for (const [serviceName, expectedContainerName] of Object.entries(requiredServices)) {
  const service = object(compose.services?.[serviceName], `${serviceName} service`);
  assert(
    service.container_name === expectedContainerName,
    `${serviceName} must use container_name ${expectedContainerName}`,
  );
  const container = object(containersByName.get(expectedContainerName), expectedContainerName);
  const labels = labelsFor(container);
  assert(
    labels["com.docker.compose.project"] === projectName,
    `${expectedContainerName} does not belong to Compose project ${projectName}`,
  );
  assert(
    labels["com.docker.compose.service"] === serviceName,
    `${expectedContainerName} does not belong to Compose service ${serviceName}`,
  );
  const actualEnvironment = environmentMap(container.Config?.Env, expectedContainerName);
  compareServiceEnvironment(
    serviceName,
    service,
    container,
    actualEnvironment,
    managedEnvironmentByService[serviceName],
    serviceName === "nextbuf" || serviceName === "worker" ? imageEnvironment : undefined,
  );
  serviceState[serviceName] = { service, container, environment: actualEnvironment };
}

assert(
  serviceState.nextbuf.environment.size === serviceState.worker.environment.size,
  "running Web and Worker environments differ",
);
for (const [key, value] of serviceState.nextbuf.environment) {
  assert(
    serviceState.worker.environment.get(key) === value,
    `running Web and Worker environments differ at ${key}`,
  );
}

assert(
  serviceState.nextbuf.container.Image === image.Id,
  "running NextBuf container image config ID differs from docker image inspect",
);
assert(
  serviceState.worker.container.Image === image.Id,
  "running Worker container image config ID differs from the running NextBuf image",
);
assert(/^sha256:[0-9a-f]{64}$/.test(image.Id), "application image config ID is invalid");
const version = requiredEnvironment(imageEnvironment, "NEXTBUF_VERSION", "application image");
assert(
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/.test(version),
  "application image version is not exact SemVer",
);
const commit = requiredEnvironment(imageEnvironment, "NEXTBUF_COMMIT", "application image");
const buildTime = requiredEnvironment(imageEnvironment, "NEXTBUF_BUILD_TIME", "application image");
assert(/^[0-9a-f]{40}$/.test(commit), "application image commit is not a full Git commit");
assert(!Number.isNaN(Date.parse(buildTime)), "application image build time is invalid");
for (const serviceName of ["nextbuf", "worker"]) {
  for (const [key, value] of Object.entries({
    NEXTBUF_VERSION: version,
    NEXTBUF_COMMIT: commit,
    NEXTBUF_BUILD_TIME: buildTime,
  })) {
    assert(
      serviceState[serviceName].environment.get(key) === value,
      `${serviceName} running image identity differs at ${key}`,
    );
  }
}

const uploadVolume = volumeIdentity(
  compose,
  projectName,
  volumesByName,
  "nextbuf",
  serviceState.nextbuf.service,
  serviceState.nextbuf.container,
  "/app/data/uploads",
);
const workerUploadVolume = volumeIdentity(
  compose,
  projectName,
  volumesByName,
  "worker",
  serviceState.worker.service,
  serviceState.worker.container,
  "/app/data/uploads",
);
assert(
  uploadVolume.name === workerUploadVolume.name,
  "Web and Worker do not share the upload volume",
);
const postgresVolume = volumeIdentity(
  compose,
  projectName,
  volumesByName,
  "postgres",
  serviceState.postgres.service,
  serviceState.postgres.container,
  "/var/lib/postgresql",
);
const redisVolume = volumeIdentity(
  compose,
  projectName,
  volumesByName,
  "redis",
  serviceState.redis.service,
  serviceState.redis.container,
  "/data",
);

for (const key of Object.keys(serviceState.nextbuf.service.environment ?? {})) {
  assert(
    key === "NODE_ENV" || templateEnvironment.has(key),
    `environment template cannot preserve ${key}`,
  );
}
for (const key of templateEnvironment.keys()) {
  if (serviceState.nextbuf.environment.has(key)) {
    values.set(key, serviceState.nextbuf.environment.get(key));
  }
}

const postgresUser = requiredEnvironment(
  serviceState.postgres.environment,
  "POSTGRES_USER",
  "nextbuf-postgres",
);
const postgresPassword = requiredEnvironment(
  serviceState.postgres.environment,
  "POSTGRES_PASSWORD",
  "nextbuf-postgres",
);
const postgresDatabase = requiredEnvironment(
  serviceState.postgres.environment,
  "POSTGRES_DB",
  "nextbuf-postgres",
);
const redisPassword = requiredEnvironment(
  serviceState.redis.environment,
  "REDIS_PASSWORD",
  "nextbuf-redis",
);
for (const [key, value] of Object.entries({
  POSTGRES_DB: postgresDatabase,
  POSTGRES_USER: postgresUser,
  POSTGRES_PASSWORD: postgresPassword,
  REDIS_PASSWORD: redisPassword,
})) {
  assert(
    /^[A-Za-z0-9._~-]+$/.test(value),
    `${key} must use URI-safe characters before it can be exported to controlled Compose`,
  );
}
const expectedDatabaseUrl = `postgresql://${postgresUser}:${postgresPassword}@postgres:5432/${postgresDatabase}`;
const expectedRedisUrl = `redis://:${redisPassword}@redis:6379/0`;
for (const key of ["DATABASE_URL", "DATABASE_DIRECT_URL"]) {
  assert(
    requiredEnvironment(serviceState.nextbuf.environment, key, "nextbuf") === expectedDatabaseUrl,
    `${key} must point to the bundled nextbuf-postgres service before export`,
  );
}
assert(
  requiredEnvironment(serviceState.nextbuf.environment, "REDIS_URL", "nextbuf") ===
    expectedRedisUrl,
  "REDIS_URL must point to the bundled nextbuf-redis service before export",
);
const storageDriver = requiredEnvironment(
  serviceState.nextbuf.environment,
  "STORAGE_DRIVER",
  "nextbuf",
);
assert(storageDriver === "local" || storageDriver === "s3", "STORAGE_DRIVER must be local or s3");
if (storageDriver === "local") {
  assert(
    requiredEnvironment(serviceState.nextbuf.environment, "STORAGE_LOCAL_PATH", "nextbuf") ===
      "/app/data/uploads",
    "local BaoTa storage must use /app/data/uploads before export",
  );
} else {
  for (const key of ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
    requiredEnvironment(serviceState.nextbuf.environment, key, "nextbuf");
  }
}
for (const [key, value] of Object.entries({
  NEXTBUF_IMAGE: imageRepository(serviceState.nextbuf.service.image),
  NEXTBUF_VERSION: version,
  POSTGRES_DB: postgresDatabase,
  POSTGRES_USER: postgresUser,
  POSTGRES_PASSWORD: postgresPassword,
  REDIS_PASSWORD: redisPassword,
  DATABASE_URL: expectedDatabaseUrl,
  DATABASE_DIRECT_URL: expectedDatabaseUrl,
  REDIS_URL: expectedRedisUrl,
})) {
  values.set(key, value);
}

const publishedPort = (serviceState.nextbuf.service.ports ?? []).find(
  (port) => port && typeof port === "object" && Number(port.target) === 3000,
)?.published;
assert(publishedPort !== undefined, "NextBuf port 3000 is not published by the BaoTa Compose");
values.set("WEB_PORT", String(publishedPort));

const environmentOutput = renderEnvironment(template, values);
const identity = {
  format: "nextbuf-baota-source-v1",
  composeProject: projectName,
  application: {
    version,
    commit,
    buildTime,
    imageReference: serviceState.nextbuf.service.image,
    imageConfigId: image.Id,
    repoTags: Array.isArray(image.RepoTags) ? image.RepoTags : [],
    repoDigests: Array.isArray(image.RepoDigests) ? image.RepoDigests : [],
    repoDigestScope: "recorded-verbatim-not-oci-index-proof",
  },
  services: Object.fromEntries(
    Object.entries(serviceState).map(([serviceName, state]) => [
      serviceName,
      {
        containerName: containerName(state.container),
        containerId: state.container.Id,
        imageConfigId: state.container.Image,
      },
    ]),
  ),
  volumes: {
    uploads: uploadVolume,
    postgres: postgresVolume,
    redis: redisVolume,
  },
  suppliedComposeMatchesRunningContainers: true,
};

await Promise.all([
  writeFile(environmentOutputPath, environmentOutput, { mode: 0o600 }),
  writeFile(identityOutputPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 }),
]);
