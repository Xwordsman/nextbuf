import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const [docsDirectory = "docs", releaseDirectory = "release", outputPath] = process.argv.slice(2);
const refName = process.env.GITHUB_REF_NAME ?? "";
const version = refName.replace(/^v/u, "");
const commit = process.env.GITHUB_SHA ?? "";
const serverUrl = process.env.GITHUB_SERVER_URL ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "";
const runId = process.env.GITHUB_RUN_ID ?? "";

if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(refName)) {
  throw new Error("GITHUB_REF_NAME must be a SemVer release tag");
}
if (!/^[0-9a-f]{40}$/u.test(commit)) {
  throw new Error("Invalid GITHUB_SHA release evidence");
}
if (
  !/^https:\/\/[^/]+$/u.test(serverUrl) ||
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
) {
  throw new Error("Invalid GitHub repository URL evidence");
}
if (!/^\d+$/u.test(runId)) {
  throw new Error("Invalid GITHUB_RUN_ID release evidence");
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
for (const digestName of ["OCI_INDEX_DIGEST", "OCI_AMD64_DIGEST", "OCI_ARM64_DIGEST"]) {
  if (!digestPattern.test(process.env[digestName] ?? "")) {
    throw new Error(`Invalid ${digestName} release evidence`);
  }
}

const notesSuffix = `-v${version}-release-notes.md`;
const notesFiles = (await readdir(docsDirectory)).filter((name) => name.endsWith(notesSuffix));
if (notesFiles.length !== 1) {
  throw new Error(
    `Expected exactly one ${docsDirectory}/*${notesSuffix}, found ${notesFiles.length}`,
  );
}

const sourceLines = (await readFile(join(docsDirectory, notesFiles[0]), "utf8")).split(/\r?\n/u);
const bodyLines = [];
let evidenceInsertionIndex = null;
let skipEvidenceSection = false;
for (const sourceLine of sourceLines) {
  if (/^##\s+7\.\s+发布产物与证据\s*$/u.test(sourceLine)) {
    evidenceInsertionIndex = bodyLines.length;
    skipEvidenceSection = true;
    continue;
  }
  if (skipEvidenceSection && /^##\s+/u.test(sourceLine)) {
    skipEvidenceSection = false;
  }
  if (skipEvidenceSection || /^>.*尚未发布/u.test(sourceLine)) {
    continue;
  }
  if (sourceLine.includes("发布时删除复选框")) {
    continue;
  }
  bodyLines.push(sourceLine.replace(/（草案）/gu, "").replace(/^([ \t]*)- \[[xX]\]\s+/u, "$1- "));
}
if (evidenceInsertionIndex === null) {
  throw new Error("Release notes are missing section 7: 发布产物与证据");
}

const archiveName = `nextbuf-${version}-linux-x64.tar.gz`;
const checksumName = `${archiveName}.sha256`;
const sbomName = `nextbuf-v${version}-sbom.spdx.json`;
for (const assetName of [archiveName, checksumName, sbomName]) {
  try {
    await access(join(releaseDirectory, assetName));
  } catch {
    throw new Error(`Missing verified release asset: ${assetName}`);
  }
}

const checksumLine = (await readFile(join(releaseDirectory, checksumName), "utf8")).trim();
const checksumMatch = checksumLine.match(/^([0-9a-f]{64})\s+\*?(.+)$/iu);
if (!checksumMatch || basename(checksumMatch[2]) !== archiveName) {
  throw new Error(`Invalid archive checksum sidecar: ${checksumName}`);
}
const archiveSha256 = createHash("sha256")
  .update(await readFile(join(releaseDirectory, archiveName)))
  .digest("hex");
if (archiveSha256 !== checksumMatch[1].toLowerCase()) {
  throw new Error(`Archive checksum does not match ${checksumName}`);
}

const repositoryUrl = `${serverUrl}/${repository}`;
const releaseUrl = `${repositoryUrl}/releases/tag/${refName}`;
const runUrl = `${repositoryUrl}/actions/runs/${runId}`;
const docsUrl = `${repositoryUrl}/blob/${commit}/docs/`;
const assetUrl = (assetName) => `${repositoryUrl}/releases/download/${refName}/${assetName}`;
bodyLines.splice(
  evidenceInsertionIndex,
  0,
  "",
  "## 7. 发布产物与证据",
  "",
  `- Git tag：[${refName}](${repositoryUrl}/tree/${refName})，commit [${commit}](${repositoryUrl}/commit/${commit})。`,
  `- GitHub Release：[${refName}](${releaseUrl})。`,
  `- GHCR OCI index：\`${process.env.OCI_INDEX_DIGEST}\`。`,
  `- linux/amd64：\`${process.env.OCI_AMD64_DIGEST}\`。`,
  `- linux/arm64：\`${process.env.OCI_ARM64_DIGEST}\`。`,
  `- Linux x64 归档：[\`${archiveName}\`](${assetUrl(archiveName)})，SHA-256 \`${archiveSha256}\`；旁路校验：[\`${checksumName}\`](${assetUrl(checksumName)})。`,
  `- Source SBOM：[\`${sbomName}\`](${assetUrl(sbomName)})。`,
  "- OCI SBOM/provenance：随 amd64 与 arm64 架构源索引发布，并已在合并前后核对 layer predicate annotation、attestation 描述符及其 OCI 运行时引用关系。",
  `- 标签 CI：[Actions Run ${runId}](${runUrl})。`,
  "",
);

const body = `${bodyLines.join("\n").trim()}\n`.replace(
  /\]\((\.\.?\/[^)\s]+)\)/gu,
  (_match, relativeTarget) => `](${new URL(relativeTarget, docsUrl).href})`,
);
const blockers = [
  [/^[ \t]*- \[ \]/mu, "未完成复选框"],
  [/草案/u, "草案标记"],
  [/尚未发布/u, "尚未发布提示"],
  [/待填写/u, "待填写占位"],
  [/待补齐/u, "待补齐占位"],
  [/待真实[^\n]*填写/u, "待真实证据占位"],
  [/NO-GO/iu, "NO-GO 结论"],
  [/(?:预计交付|计划支持|候选范围|受控入口在正式发布后)/u, "预发布规划措辞"],
  [/(?:正式发布前|正式标签流水线会|人工验收[^\n]*前)/u, "未完成发布措辞"],
];
for (const [pattern, label] of blockers) {
  if (pattern.test(body)) {
    throw new Error(`Release body still contains ${label}`);
  }
}

await writeFile(outputPath ?? join(releaseDirectory, "release-body.md"), body, "utf8");
