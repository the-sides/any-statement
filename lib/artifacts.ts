import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const DEFAULT_ARTIFACT_ROOT = "/tmp/statement-ledger";

export type UploadArtifact = {
  id: string;
  dir: string;
  filePath: string;
  pdfPath?: string;
  fileName: string;
  mediaType: "pdf" | "csv";
};

export type PublicUploadArtifact = {
  id: string;
  dir: string;
  filePath: string;
  pdfPath?: string;
  fileName: string;
  mediaType: "pdf" | "csv";
};

export async function saveUploadedStatement(
  file: File,
  mediaType: UploadArtifact["mediaType"]
): Promise<UploadArtifact> {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const fileName = safeFileName(file.name || `statement.${mediaType}`, mediaType);
  const dir = path.join(artifactRoot(), "uploads", id);
  const filePath = path.join(dir, fileName);

  await mkdir(dir, { recursive: true });
  await pipeline(
    Readable.fromWeb(file.stream() as unknown as NodeReadableStream<Uint8Array>),
    createWriteStream(filePath)
  );
  await writeArtifactJson(dir, "upload.json", {
    id,
    fileName,
    filePath,
    pdfPath: mediaType === "pdf" ? filePath : undefined,
    mediaType,
    size: file.size,
    type: file.type,
    savedAt: new Date().toISOString()
  });

  return {
    id,
    dir,
    filePath,
    pdfPath: mediaType === "pdf" ? filePath : undefined,
    fileName,
    mediaType
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
    filePath: artifact.filePath,
    pdfPath: artifact.pdfPath,
    fileName: artifact.fileName,
    mediaType: artifact.mediaType
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

function safeFileName(
  fileName: string,
  fallbackExtension: UploadArtifact["mediaType"]
) {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return /\.[a-z0-9]+$/i.test(sanitized)
    ? sanitized
    : `${sanitized}.${fallbackExtension}`;
}
