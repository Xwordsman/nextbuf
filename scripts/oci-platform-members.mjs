let input = "";
for await (const chunk of process.stdin) input += chunk;

const document = JSON.parse(input);
const mode = process.argv[2] ?? "--platforms";
if (!["--platforms", "--descriptors", "--attestations"].includes(mode)) {
  throw new Error("Usage: oci-platform-members.mjs [--platforms|--descriptors|--attestations]");
}

const members = [];
for (const manifest of Array.isArray(document.manifests) ? document.manifests : []) {
  const os = manifest?.platform?.os;
  const architecture = manifest?.platform?.architecture;
  const digest = manifest?.digest;
  if (typeof digest !== "string") continue;

  if (mode === "--descriptors") {
    members.push(digest);
  } else if (
    mode === "--platforms" &&
    typeof os === "string" &&
    typeof architecture === "string" &&
    os !== "unknown" &&
    architecture !== "unknown"
  ) {
    members.push(`${os}/${architecture}=${digest}`);
  } else if (
    mode === "--attestations" &&
    manifest?.annotations?.["vnd.docker.reference.type"] === "attestation-manifest" &&
    typeof manifest.annotations["vnd.docker.reference.digest"] === "string"
  ) {
    members.push(`${manifest.annotations["vnd.docker.reference.digest"]}=${digest}`);
  }
}

for (const member of [...new Set(members)].sort()) console.log(member);
