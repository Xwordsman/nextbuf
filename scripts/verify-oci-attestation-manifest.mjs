const digestPattern = /^sha256:[0-9a-f]{64}$/;
const spdxPredicate = "https://spdx.dev/Document";
const provenancePredicatePattern = /^https:\/\/slsa\.dev\/provenance\/v(?:0\.2|1)$/;
const supportedMediaTypes = new Set([
  "application/vnd.in-toto+json",
  "application/vnd.in-toto.spdx+dsse",
  "application/vnd.in-toto.provenance+dsse",
]);

let input = "";
for await (const chunk of process.stdin) input += chunk;

const document = JSON.parse(input);
if (document?.schemaVersion !== 2 || !Array.isArray(document.layers)) {
  throw new Error("Expected an OCI image manifest with attestation layers");
}

const attestations = document.layers.map((layer) => ({
  digest: layer?.digest,
  mediaType: layer?.mediaType,
  predicateType: layer?.annotations?.["in-toto.io/predicate-type"],
}));

for (const attestation of attestations) {
  if (!digestPattern.test(attestation.digest ?? "")) {
    throw new Error("Attestation layer is missing a full sha256 digest");
  }
  if (!supportedMediaTypes.has(attestation.mediaType)) {
    throw new Error(`Unsupported attestation media type: ${attestation.mediaType ?? "missing"}`);
  }
  if (typeof attestation.predicateType !== "string") {
    throw new Error("Attestation layer is missing its predicate type");
  }
}

const sbom = attestations.filter(({ predicateType }) => predicateType === spdxPredicate);
const provenance = attestations.filter(({ predicateType }) =>
  provenancePredicatePattern.test(predicateType),
);

if (sbom.length !== 1) {
  throw new Error(`Expected exactly one SPDX SBOM attestation, found ${sbom.length}`);
}
if (provenance.length !== 1) {
  throw new Error(`Expected exactly one SLSA provenance attestation, found ${provenance.length}`);
}
if (attestations.length !== 2) {
  throw new Error(`Expected exactly two release attestation layers, found ${attestations.length}`);
}

console.log(`sbom=${sbom[0].digest}`);
console.log(`provenance=${provenance[0].digest}`);
