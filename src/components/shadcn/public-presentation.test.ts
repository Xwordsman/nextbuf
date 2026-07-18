import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(target) : entry.name.endsWith(".tsx") ? [target] : [];
  });
}

function publicPresentationFiles() {
  const root = process.cwd();
  const appFiles = tsxFiles(path.join(root, "src", "app")).filter(
    (file) => !file.includes(`${path.sep}admin${path.sep}`),
  );
  const componentFiles = tsxFiles(path.join(root, "src", "components")).filter(
    (file) =>
      !file.includes(`${path.sep}admin${path.sep}`) &&
      !file.includes(`${path.sep}shadcn${path.sep}`),
  );
  return [...appFiles, ...componentFiles];
}

function relative(files: string[]) {
  return files.map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"));
}

describe("public shadcn presentation contract", () => {
  const files = publicPresentationFiles();

  it("keeps the official radix-nova registry configuration", () => {
    const config = readFileSync(path.join(process.cwd(), "components.json"), "utf8");
    expect(config).toContain('"style": "radix-nova"');
    expect(config).toContain('"ui": "@/components/shadcn/ui"');
  });

  it("does not reintroduce the retired public UI directories", () => {
    const legacyImport = /@\/components\/(?:admin\/)?ui(?:\/|["'])/;
    expect(relative(files.filter((file) => legacyImport.test(readFileSync(file, "utf8"))))).toEqual(
      [],
    );
  });

  it("uses shadcn primitives for public interactive controls", () => {
    const rawInteractiveControl = /<(?:button|input|select|textarea|dialog)\b/;
    expect(
      relative(files.filter((file) => rawInteractiveControl.test(readFileSync(file, "utf8")))),
    ).toEqual([]);
  });
});
