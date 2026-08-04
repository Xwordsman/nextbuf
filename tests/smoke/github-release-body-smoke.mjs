import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts", "prepare-github-release-body.mjs");
const directory = await mkdtemp(path.join(tmpdir(), "nextbuf-release-body-"));
const docsDirectory = path.join(directory, "docs");
const releaseDirectory = path.join(directory, "release");
const outputPath = path.join(releaseDirectory, "release-body.md");
const version = "1.0.0";
const archiveName = `nextbuf-${version}-linux-x64.tar.gz`;
const checksumName = `${archiveName}.sha256`;
const sbomName = `nextbuf-v${version}-sbom.spdx.json`;
const archive = Buffer.from("verified standalone archive\n");
const archiveSha256 = createHash("sha256").update(archive).digest("hex");
const commit = "a".repeat(40);
const indexDigest = `sha256:${"b".repeat(64)}`;
const amd64Digest = `sha256:${"c".repeat(64)}`;
const arm64Digest = `sha256:${"d".repeat(64)}`;
const notesPath = path.join(docsDirectory, "20-v1.0.0-release-notes.md");
const baseEnvironment = {
  ...process.env,
  GITHUB_REF_NAME: "v1.0.0",
  GITHUB_SHA: commit,
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "Xwordsman/nextbuf",
  GITHUB_RUN_ID: "123456",
  OCI_INDEX_DIGEST: indexDigest,
  OCI_AMD64_DIGEST: amd64Digest,
  OCI_ARM64_DIGEST: arm64Digest,
};

function run(expectedStatus = 0, sourceDocsDirectory = docsDirectory) {
  const result = spawnSync(
    process.execPath,
    [script, sourceDocsDirectory, releaseDirectory, outputPath],
    { encoding: "utf8", env: baseEnvironment },
  );
  if (result.status !== expectedStatus) {
    throw new Error(`Unexpected release body status: ${result.stderr || result.stdout}`);
  }
  return result;
}

const validNotes = `# NextBuf \`v1.0.0\` 发布说明（草案）

> \`v1.0.0\` 尚未发布。

## 1. 变更

- [x] 已验证变更，见 [支持边界](./22-v1.0.0-provider-support-matrix.md)。

发布时删除复选框和规划措辞。

## 7. 发布产物与证据

| 产物 | 身份 |
| --- | --- |
| Git tag | 待填写 |

## 8. 支持

参阅 [SUPPORT.md](../SUPPORT.md)。
`;

try {
  await mkdir(docsDirectory);
  await mkdir(releaseDirectory);
  await writeFile(notesPath, validNotes);
  await writeFile(path.join(releaseDirectory, archiveName), archive);
  await writeFile(path.join(releaseDirectory, checksumName), `${archiveSha256}  ${archiveName}\n`);
  await writeFile(path.join(releaseDirectory, sbomName), '{"spdxVersion":"SPDX-2.3"}\n');

  run();
  const body = await readFile(outputPath, "utf8");
  for (const expected of [
    commit,
    indexDigest,
    amd64Digest,
    arm64Digest,
    archiveSha256,
    `https://github.com/Xwordsman/nextbuf/blob/${commit}/docs/22-v1.0.0-provider-support-matrix.md`,
    `https://github.com/Xwordsman/nextbuf/blob/${commit}/SUPPORT.md`,
    `https://github.com/Xwordsman/nextbuf/releases/download/v1.0.0/${archiveName}`,
  ]) {
    if (!body.includes(expected)) {
      throw new Error(`Generated Release body is missing ${expected}`);
    }
  }
  for (const forbidden of ["草案", "尚未发布", "待填写", "- [x]"]) {
    if (body.includes(forbidden)) {
      throw new Error(`Generated Release body retained ${forbidden}`);
    }
  }
  if (!body.includes("layer predicate annotation、attestation 描述符及其 OCI 运行时引用关系")) {
    throw new Error("Generated Release body overstates OCI attestation verification");
  }

  await writeFile(notesPath, validNotes.replace("## 1. 变更", "## 1. 变更\n\n- [ ] 未完成"));
  const blocked = run(1);
  if (!blocked.stderr.includes("未完成复选框")) {
    throw new Error("Incomplete Release notes did not report the expected blocker");
  }

  await writeFile(notesPath, validNotes);
  await writeFile(notesPath, validNotes.replace("## 1. 变更", "## 1. 变更\n\n预计交付稍后补充。"));
  const planningRejected = run(1);
  if (!planningRejected.stderr.includes("预发布规划措辞")) {
    throw new Error("Planning language did not report the expected blocker");
  }

  await writeFile(notesPath, validNotes);
  await writeFile(path.join(releaseDirectory, archiveName), "changed archive\n");
  const checksumRejected = run(1);
  if (!checksumRejected.stderr.includes("Archive checksum does not match")) {
    throw new Error("Changed Release archive did not report a checksum mismatch");
  }

  await writeFile(path.join(releaseDirectory, archiveName), archive);
  run(0, path.join(root, "docs"));
  const projectBody = await readFile(outputPath, "utf8");
  if (!projectBody.includes("NextBuf 首个稳定社区版本") || projectBody.includes("待填写")) {
    throw new Error("Project Release notes did not produce a publishable Release body");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
