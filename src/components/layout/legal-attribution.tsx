import { PROJECT } from "@/shared/project";

export function LegalAttribution() {
  return (
    <span className="legal-attribution">
      Powered by{" "}
      <a href={PROJECT.repositoryUrl} rel="external">
        {PROJECT.name}
      </a>
    </span>
  );
}
