import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parser = unified().use(remarkParse).use(remarkGfm);

async function collectMarkdownFiles(directory, recursive = true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...(await collectMarkdownFiles(absolutePath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function nodeText(node) {
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.children)) return "";
  return node.children.map(nodeText).join("");
}

function githubHeadingSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function collectHeadingSlugs(tree) {
  const slugs = new Set();
  const counts = new Map();

  visit(tree, "heading", (node) => {
    const base = githubHeadingSlug(nodeText(node));
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  });

  return slugs;
}

function splitTarget(url) {
  const fragmentIndex = url.indexOf("#");
  const withoutFragment = fragmentIndex === -1 ? url : url.slice(0, fragmentIndex);
  const queryIndex = withoutFragment.indexOf("?");
  return {
    pathname: queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex),
    fragment: fragmentIndex === -1 ? "" : url.slice(fragmentIndex + 1),
  };
}

function isExternalTarget(url) {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//");
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const rootMarkdown = (await collectMarkdownFiles(repositoryRoot, false)).filter(
  (file) => !file.includes(`${path.sep}node_modules${path.sep}`),
);
const documentationMarkdown = await collectMarkdownFiles(path.join(repositoryRoot, "docs"));
const markdownFiles = [...rootMarkdown, ...documentationMarkdown].sort();
const documents = new Map();

for (const file of markdownFiles) {
  const source = await readFile(file, "utf8");
  const tree = parser.parse(source);
  documents.set(file, { source, tree, headings: collectHeadingSlugs(tree) });
}

const failures = [];

for (const [sourceFile, document] of documents) {
  const checkTarget = async (url, position) => {
    if (!url || isExternalTarget(url) || url.startsWith("/")) return;

    const { pathname, fragment } = splitTarget(url);
    let decodedPath;
    let decodedFragment;

    try {
      decodedPath = decodeURIComponent(pathname);
      decodedFragment = decodeURIComponent(fragment);
    } catch {
      failures.push({ sourceFile, position, url, reason: "invalid percent encoding" });
      return;
    }

    const targetFile = decodedPath
      ? path.resolve(path.dirname(sourceFile), decodedPath)
      : sourceFile;

    if (!(await pathExists(targetFile))) {
      failures.push({ sourceFile, position, url, reason: "target does not exist" });
      return;
    }

    if (!decodedFragment || path.extname(targetFile).toLowerCase() !== ".md") return;

    const targetDocument = documents.get(targetFile);
    if (!targetDocument) {
      failures.push({
        sourceFile,
        position,
        url,
        reason: "target Markdown is outside the checked set",
      });
      return;
    }

    if (!targetDocument.headings.has(decodedFragment.toLowerCase())) {
      failures.push({ sourceFile, position, url, reason: "heading does not exist" });
    }
  };

  const pending = [];
  visit(document.tree, ["link", "definition", "image"], (node) => {
    pending.push(checkTarget(node.url, node.position?.start?.line ?? 1));
  });
  await Promise.all(pending);
}

if (failures.length > 0) {
  for (const failure of failures) {
    const relative = path.relative(repositoryRoot, failure.sourceFile);
    console.error(`${relative}:${failure.position}: ${failure.reason}: ${failure.url}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Verified ${markdownFiles.length} Markdown files and their local links.`);
}
