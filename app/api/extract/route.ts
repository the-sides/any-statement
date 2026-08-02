import {
  publicUploadArtifact,
  saveExtractionArtifact,
  saveExtractionErrorArtifact,
  saveFallbackArtifact,
  saveFinalExtractionArtifact,
  saveUploadedStatement,
  type UploadArtifact
} from "@/lib/artifacts";
import { commonErrorResponse } from "@/lib/apiErrors";
import { ensureCategoryCatalog } from "@/lib/categoryStore";
import {
  getEnabledCategoryDefinitions,
  selectActiveCategories,
  type ExpenseCategoryDefinition
} from "@/lib/categories";
import { requireUserId } from "@/lib/currentUser";
import { extractFallbackExpensesFromPdf } from "@/lib/fallbackExtractor";
import {
  extractStatementFromCsv,
  extractStatementFromPdf,
  IntegrationError
} from "@/lib/openrouter";
import { extractPdfText } from "@/lib/pdfText";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 1024 * 1024;
const MAX_REQUEST_BODY_SIZE = MAX_FILE_SIZE + MAX_MULTIPART_OVERHEAD;
const MAX_CATEGORIZATION_NOTES_LENGTH = 4000;
type StatementUploadType = UploadArtifact["mediaType"];

export async function POST(request: Request) {
  try {
    if (isUploadRequestTooLarge(request)) {
      return Response.json(
        { error: "Statement file is too large. The current limit is 12 MB." },
        { status: 413 }
      );
    }

    // The prompt is built from this user's category catalog, so extraction is
    // per-user even though it writes nothing to the ledger itself.
    const userId = await requireUserId();
    const formData = await request.formData();
    const file = formData.get("statementFile") ?? formData.get("statementPdf");
    const categorizationNotes = readOptionalFormString(
      formData.get("categorizationNotes"),
      MAX_CATEGORIZATION_NOTES_LENGTH
    );
    const includeAppCategories = readOptionalBoolean(
      formData.get("includeAppCategories")
    );

    if (!(file instanceof File)) {
      return Response.json(
        { error: "Upload a statement PDF or CSV before extracting." },
        { status: 400 }
      );
    }

    const uploadType = getStatementUploadType(file);

    if (!uploadType) {
      return Response.json(
        { error: "Only PDF and CSV statements are supported." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: "Statement file is too large. The current limit is 12 MB." },
        { status: 413 }
      );
    }

    const artifact = await saveUploadedStatement(file, uploadType);

    try {
      const { catalog: categoryCatalog } = await ensureCategoryCatalog(userId);
      const extractionCategories = categoriesForExtraction(
        categoryCatalog.categories,
        includeAppCategories
      );

      const extraction =
        uploadType === "pdf"
          ? await extractPdfUpload(
              file,
              artifact,
              extractionCategories,
              categorizationNotes
            )
          : await extractCsvUpload(
              file,
              artifact,
              extractionCategories,
              categorizationNotes
            );
      const finalExtraction = await applyPdfFallbackIfNeeded(
        artifact,
        extraction,
        extractionCategories.map((category) => category.name),
        categorizationNotes
      );

      if (finalExtraction !== extraction) {
        await saveFallbackArtifact(artifact, {
          reason: "openrouter-empty-expenses",
          categorizationNotes,
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

    return (
      commonErrorResponse(error) ??
      Response.json({ error: "Statement extraction failed." }, { status: 500 })
    );
  }
}

function getStatementUploadType(file: File): StatementUploadType | null {
  if (isPdf(file)) {
    return "pdf";
  }

  if (isCsv(file)) {
    return "csv";
  }

  return null;
}

function isUploadRequestTooLarge(request: Request) {
  const contentLength = request.headers.get("content-length");

  if (!contentLength) {
    return false;
  }

  const parsed = Number(contentLength);

  return Number.isFinite(parsed) && parsed > MAX_REQUEST_BODY_SIZE;
}

function isPdf(file: File) {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function isCsv(file: File) {
  const type = file.type.toLowerCase();

  return (
    type === "text/csv" ||
    type === "application/csv" ||
    type === "application/vnd.ms-excel" ||
    file.name.toLowerCase().endsWith(".csv")
  );
}

function readOptionalFormString(
  value: FormDataEntryValue | null,
  maxLength: number
) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function readOptionalBoolean(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function categoriesForExtraction(
  categories: readonly ExpenseCategoryDefinition[],
  includeAppCategories: boolean | null
) {
  const sourceCategories = selectActiveCategories(
    categories,
    includeAppCategories
  );

  return getEnabledCategoryDefinitions(
    sourceCategories.length > 0 ? sourceCategories : categories
  );
}

async function extractPdfUpload(
  file: File,
  artifact: UploadArtifact,
  extractionCategories: readonly ExpenseCategoryDefinition[],
  categorizationNotes: string
) {
  const pdfText = await extractPdfText(artifact.filePath);

  return extractStatementFromPdf(file, {
    filePath: artifact.filePath,
    pdfText,
    categories: extractionCategories,
    categorizationNotes,
    onDebug: (payload) => saveExtractionArtifact(artifact, payload)
  });
}

async function extractCsvUpload(
  file: File,
  artifact: UploadArtifact,
  extractionCategories: readonly ExpenseCategoryDefinition[],
  categorizationNotes: string
) {
  return extractStatementFromCsv(file, {
    filePath: artifact.filePath,
    categories: extractionCategories,
    categorizationNotes,
    onDebug: (payload) => saveExtractionArtifact(artifact, payload)
  });
}

async function applyPdfFallbackIfNeeded(
  artifact: UploadArtifact,
  extraction: Awaited<ReturnType<typeof extractStatementFromPdf>>,
  categoryNames: readonly string[],
  categorizationNotes: string
) {
  if (artifact.mediaType !== "pdf") {
    return extraction;
  }

  if (extraction.expenses.length > 0) {
    return extraction;
  }

  const fallback = await extractFallbackExpensesFromPdf(
    artifact.filePath,
    extraction.statement,
    categoryNames,
    { categorizationNotes }
  );

  if (fallback.expenses.length === 0) {
    return extraction;
  }

  return {
    ...extraction,
    expenses: fallback.expenses
  };
}
