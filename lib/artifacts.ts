import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ARTIFACT_ROOT = "/tmp/statement-ledger";

export type UploadArtifact = {
  id: string;
  dir: string;
  pdfPath: string;
  fileName: string;
  bytes: Buffer;
};

export type PublicUploadArtifact = {
  id: string;
  dir: string;
  pdfPath: string;
  fileName: string;
};

export async function saveUploadedPdf(file: File): Promise<UploadArtifact> {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const fileName = safeFileName(file.name || "statement.pdf");
  const dir = path.join(artifactRoot(), "uploads", id);
  const pdfPath = path.join(dir, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());

  await mkdir(dir, { recursive: true });
  await writeFile(pdfPath, bytes);
  await writeArtifactJson(dir, "upload.json", {
    id,
    fileName,
    pdfPath,
    size: file.size,
    type: file.type,
    savedAt: new Date().toISOString()
  });

  return {
    id,
    dir,
    pdfPath,
    fileName,
    bytes
  };
}

export async function saveExtractionArtifact(
  artifact: UploadArtifact,
  payload: unknown
) {
  await writeArtifactJson(artifact.dir, "extraction.json", {
    artifact: publicUploadArtifact(artifact),
    savedAt: new Date().toISOString(),
    payload
  });
}

export async function saveExtractionErrorArtifact(
  artifact: UploadArtifact,
  error: unknown
) {
  await writeArtifactJson(artifact.dir, "error.json", {
    artifact: publicUploadArtifact(artifact),
    savedAt: new Date().toISOString(),
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message
          }
        : String(error)
  });
}

export async function saveFallbackArtifact(
  artifact: UploadArtifact,
  payload: unknown
) {
  await writeArtifactJson(artifact.dir, "fallback.json", {
    artifact: publicUploadArtifact(artifact),
    savedAt: new Date().toISOString(),
    payload
  });
}

export async function saveFinalExtractionArtifact(
  artifact: UploadArtifact,
  payload: unknown
) {
  await writeArtifactJson(artifact.dir, "final-extraction.json", {
    artifact: publicUploadArtifact(artifact),
    savedAt: new Date().toISOString(),
    payload
  });
}

export function publicUploadArtifact(
  artifact: UploadArtifact
): PublicUploadArtifact {
  return {
    id: artifact.id,
    dir: artifact.dir,
    pdfPath: artifact.pdfPath,
    fileName: artifact.fileName
  };
}

function artifactRoot() {
  return process.env.STATEMENT_LEDGER_ARTIFACT_DIR || DEFAULT_ARTIFACT_ROOT;
}

async function writeArtifactJson(
  dir: string,
  fileName: string,
  payload: unknown
) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, fileName),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

function safeFileName(fileName: string) {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.toLowerCase().endsWith(".pdf")
    ? sanitized
    : `${sanitized}.pdf`;
}
