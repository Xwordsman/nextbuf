import { PROJECT } from "@/shared/project";

export function LegalAttribution() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      Powered by{" "}
      <a
        className="rounded-sm font-medium text-foreground/75 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        href={PROJECT.repositoryUrl}
        rel="external"
      >
        {PROJECT.name}
      </a>
    </span>
  );
}
