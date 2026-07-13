import "server-only";

import type { Element, Root as HastRoot } from "hast";
import type { Link, Parent, PhrasingContent, Root as MdastRoot, Text } from "mdast";
import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { isAttachmentMediaPath, safeMarkdownLink } from "@/modules/community/content-policy";

const mentionPattern = /(^|[^a-z0-9_])@([a-z][a-z0-9_]{2,23})(?![a-z0-9_])/giu;

function mentionNodes(node: Text): PhrasingContent[] {
  const nodes: PhrasingContent[] = [];
  let cursor = 0;
  for (const match of node.value.matchAll(mentionPattern)) {
    const prefix = match[1] ?? "";
    const username = match[2];
    if (match.index === undefined || !username) continue;
    const mentionStart = match.index + prefix.length;
    if (mentionStart > cursor) {
      nodes.push({ type: "text", value: node.value.slice(cursor, mentionStart) });
    }
    nodes.push({
      type: "link",
      url: `/u/${username.toLowerCase()}`,
      children: [{ type: "text", value: `@${username}` }],
    });
    cursor = mentionStart + username.length + 1;
  }
  if (cursor < node.value.length) nodes.push({ type: "text", value: node.value.slice(cursor) });
  return nodes.length > 0 ? nodes : [node];
}

function transformMentions(parent: Parent): void {
  if (["link", "linkReference", "inlineCode", "code"].includes(parent.type)) return;
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (!child) continue;
    if (child.type === "text") {
      const replacement = mentionNodes(child as Text);
      parent.children.splice(index, 1, ...replacement);
      index += replacement.length - 1;
    } else if ("children" in child && Array.isArray(child.children)) {
      transformMentions(child as Parent);
    }
  }
}

function remarkSafeCommunityContent() {
  return (tree: MdastRoot) => {
    transformMentions(tree);
    visit(tree, "link", (node: Link) => {
      node.url = safeMarkdownLink(node.url) ?? "";
    });
    visit(tree, "image", (node, index, parent) => {
      if (isAttachmentMediaPath(node.url)) return;
      if (index === undefined || !parent) return;
      const safeUrl = safeMarkdownLink(node.url);
      const label = node.alt?.trim() || "外部图片";
      parent.children[index] = safeUrl
        ? ({
            type: "link",
            url: safeUrl,
            children: [{ type: "text", value: label }],
          } satisfies Link)
        : ({ type: "text", value: label } satisfies Text);
    });
  };
}

function rehypeExternalLinkPolicy() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties.href;
      if (typeof href === "string" && /^https?:\/\//iu.test(href)) {
        node.properties.rel = ["nofollow", "noopener", "noreferrer"];
        node.properties.target = "_blank";
      }
    });
  };
}

const schema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-[\w-]+$/u]],
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      ["type", "checkbox"],
      "checked",
      "disabled",
    ],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkSafeCommunityContent)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeExternalLinkPolicy)
  .use(rehypeStringify);

export function renderCommunityMarkdown(source: string): string {
  return String(processor.processSync(source));
}
