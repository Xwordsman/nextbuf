import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageVersion = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const version = process.argv[2] ?? packageVersion;
const output = path.resolve(root, process.argv[3] ?? "release");
const work = path.join(root, ".release-work");
const releaseRoot = path.join(work, `nextbuf-${version}`);
const runtimeRoot = path.join(releaseRoot, "runtime");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const usePnpmCli = command === "pnpm" && process.env.npm_execpath;
    const useWindowsCommand = command === "pnpm" && process.platform === "win32" && !usePnpmCli;
    const executable = usePnpmCli ? process.execPath : useWindowsCommand ? "cmd.exe" : command;
    const commandArgs = usePnpmCli
      ? [process.env.npm_execpath, ...args]
      : useWindowsCommand
        ? ["/d", "/s", "/c", "pnpm", ...args]
        : args;
    const child = spawn(executable, commandArgs, {
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} exited with ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolve();
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} exited with ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolve(output.trim());
    });
  });
}

function isRfc3339Timestamp(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!match) return false;

  const [
    ,
    yearValue,
    monthValue,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
    offsetHourValue,
    offsetMinuteValue,
  ] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    Number(hourValue) <= 23 &&
    Number(minuteValue) <= 59 &&
    Number(secondValue) <= 59 &&
    (offsetHourValue === undefined || Number(offsetHourValue) <= 23) &&
    (offsetMinuteValue === undefined || Number(offsetMinuteValue) <= 59) &&
    Number.isFinite(Date.parse(value))
  );
}

async function assertBuilt() {
  for (const target of [
    ".next/standalone/server.js",
    "dist/cli/index.mjs",
    "dist/worker/index.mjs",
  ]) {
    await access(path.join(root, target));
  }
}

async function filesRecursively(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory() && entry.name === "node_modules") continue;
    if (entry.isDirectory())
      result.push(...(await filesRecursively(path.join(directory, entry.name), relative)));
    else result.push(relative);
  }
  return result.sort();
}

await assertBuilt();
if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/u.test(
    version,
  )
) {
  throw new Error("Release version must be an OCI-compatible exact SemVer");
}
if (version !== packageVersion) {
  throw new Error(`Release version ${version} does not match package version ${packageVersion}`);
}
const builtVersion = await capture(process.execPath, ["dist/cli/index.mjs", "version"]);
if (builtVersion !== version) {
  throw new Error(
    `Built application version ${builtVersion} does not match release version ${version}`,
  );
}
const commit = process.env.NEXTBUF_COMMIT?.trim() || (await capture("git", ["rev-parse", "HEAD"]));
const buildTime =
  process.env.NEXTBUF_BUILD_TIME?.trim() ||
  (await capture("git", ["show", "-s", "--format=%cI", commit]));
if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("Release commit must be a full Git SHA");
if (!isRfc3339Timestamp(buildTime)) {
  throw new Error("Release build time must be an RFC 3339 timestamp");
}
await rm(work, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await cp(
  path.join(root, "deploy", "runtime-package", "package.json"),
  path.join(runtimeRoot, "package.json"),
);
await cp(
  path.join(root, "deploy", "runtime-package", "pnpm-lock.yaml"),
  path.join(runtimeRoot, "pnpm-lock.yaml"),
);
await cp(
  path.join(root, "deploy", "runtime-package", "pnpm-workspace.yaml"),
  path.join(runtimeRoot, "pnpm-workspace.yaml"),
);
await run("pnpm", ["--dir", runtimeRoot, "install", "--prod", "--frozen-lockfile"], { cwd: root });

await cp(path.join(root, "package.json"), path.join(runtimeRoot, "package.json"));
await writeFile(
  path.join(runtimeRoot, ".nextbuf-build.env"),
  [
    `NEXTBUF_VERSION=${JSON.stringify(version)}`,
    `NEXTBUF_COMMIT=${JSON.stringify(commit)}`,
    `NEXTBUF_BUILD_TIME=${JSON.stringify(buildTime)}`,
    "",
  ].join("\n"),
  { mode: 0o644 },
);

await mkdir(path.join(runtimeRoot, ".next"), { recursive: true });
await mkdir(path.join(runtimeRoot, "scripts"), { recursive: true });
await mkdir(path.join(runtimeRoot, "deploy"), { recursive: true });
await cp(path.join(root, ".next", "standalone"), path.join(runtimeRoot, ".next", "standalone"), {
  recursive: true,
  dereference: true,
});
await cp(path.join(root, "dist"), path.join(runtimeRoot, "dist"), { recursive: true });
await cp(path.join(root, "prisma"), path.join(runtimeRoot, "prisma"), { recursive: true });
await cp(path.join(root, "prisma.config.ts"), path.join(runtimeRoot, "prisma.config.ts"));
await cp(
  path.join(root, "scripts", "start-standalone.mjs"),
  path.join(runtimeRoot, "scripts", "start-standalone.mjs"),
);
await cp(path.join(root, "deploy", "bin"), path.join(runtimeRoot, "deploy", "bin"), {
  recursive: true,
});
if (process.platform !== "win32") {
  await chmod(path.join(runtimeRoot, "deploy", "bin", "nextbuf"), 0o755);
  await chmod(path.join(runtimeRoot, "deploy", "bin", "nextbuf-service"), 0o755);
}

for (const item of [
  "compose.yml",
  "compose.baota.yml",
  ".env.example",
  "nextbufctl",
  "LICENSE",
  "NOTICE",
  "README.md",
]) {
  await cp(path.join(root, item), path.join(releaseRoot, item));
}
for (const directory of ["nginx", "systemd", "pm2"]) {
  await cp(path.join(root, "deploy", directory), path.join(releaseRoot, "deploy", directory), {
    recursive: true,
  });
}
if (process.platform !== "win32") await chmod(path.join(releaseRoot, "nextbufctl"), 0o755);
await writeFile(path.join(releaseRoot, "VERSION"), `${version}\n`);

const checksumFiles = (await filesRecursively(releaseRoot)).filter(
  (file) => file !== "checksums.txt",
);
const checksumLines = [];
for (const file of checksumFiles) {
  const digest = createHash("sha256")
    .update(await readFile(path.join(releaseRoot, file)))
    .digest("hex");
  checksumLines.push(`${digest}  ${file}`);
}
await writeFile(path.join(releaseRoot, "checksums.txt"), `${checksumLines.join("\n")}\n`);

await mkdir(output, { recursive: true });
const archive = path.join(output, `nextbuf-${version}-${process.platform}-${process.arch}.tar.gz`);
await rm(archive, { force: true });
await run("tar", ["-C", work, "-czf", archive, path.basename(releaseRoot)]);
const archiveDigest = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(`${archive}.sha256`, `${archiveDigest}  ${path.basename(archive)}\n`);
await rm(work, { recursive: true, force: true });
console.log(archive);
