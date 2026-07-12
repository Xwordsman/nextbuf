import { PROJECT } from "@/shared/project";

export function LegalAttribution() {
  return (
    <footer className="legal-footer">
      <span>
        Powered by{" "}
        <a href={PROJECT.repositoryUrl} rel="external">
          {PROJECT.name}
        </a>
      </span>
    </footer>
  );
}
