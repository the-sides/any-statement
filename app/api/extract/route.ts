import {
  publicUploadArtifact,
  saveExtractionArtifact,
  saveExtractionErrorArtifact,
  saveFallbackArtifact,
  saveFinalExtractionArtifact,
  saveUploadedPdf
} from "@/lib/artifacts";
import { extractFallbackExpensesFromPdf } from "@/lib/fallbackExtractor";
import {
  extractStatementFromPdf,
  IntegrationError
} from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_FILE_SIZE = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("statementPdf");

    if (!(file instanceof File)) {
      return Response.json(
        { error: "Upload a statement PDF before extracting." },
        { status: 400 }
      );
    }

    if (!isPdf(file)) {
      return Response.json(
        { error: "Only PDF statements are supported." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: "PDF is too large. The current limit is 12 MB." },
        { status: 413 }
      );
    }

    const artifact = await saveUploadedPdf(file);

    try {
      const extraction = await extractStatementFromPdf(file, {
        bytes: artifact.bytes,
        onDebug: (payload) => saveExtractionArtifact(artifact, payload)
      });
      const finalExtraction = await applyFallbackIfNeeded(
        artifact.pdfPath,
        extraction
      );

      if (finalExtraction !== extraction) {
        await saveFallbackArtifact(artifact, {
          reason: "openrouter-empty-expenses",
          extraction: finalExtraction
        });
      }

      await saveFinalExtractionArtifact(artifact, {
        extraction: finalExtraction
      });

      return Response.json({
        extraction: finalExtraction,
        artifact: publicUploadArtifact(artifact)
      });
    } catch (error) {
      await saveExtractionErrorArtifact(artifact, error);
      throw error;
    }
  } catch (error) {
    if (error instanceof IntegrationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json(
      { error: "Statement extraction failed." },
      { status: 500 }
    );
  }
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function applyFallbackIfNeeded(
  pdfPath: string,
  extraction: Awaited<ReturnType<typeof extractStatementFromPdf>>
) {
  if (extraction.expenses.length > 0) {
    return extraction;
  }

  const fallback = await extractFallbackExpensesFromPdf(
    pdfPath,
    extraction.statement
  );

  if (fallback.expenses.length === 0) {
    return extraction;
  }

  return {
    ...extraction,
    expenses: fallback.expenses
  };
}
