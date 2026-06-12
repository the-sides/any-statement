import {
  publicUploadArtifact,
  saveExtractionArtifact,
  saveExtractionErrorArtifact,
  saveFallbackArtifact,
  saveFinalExtractionArtifact,
  saveUploadedPdf
} from "@/lib/artifacts";
import { loadCategoryCatalog } from "@/lib/categoryStore";
import {
  getEnabledCategoryDefinitions,
  type ExpenseCategoryDefinition
} from "@/lib/categories";
import { extractFallbackExpensesFromPdf } from "@/lib/fallbackExtractor";
import {
  extractStatementFromPdf,
  IntegrationError
} from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_CATEGORIZATION_NOTES_LENGTH = 4000;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("statementPdf");
    const categorizationNotes = readOptionalFormString(
      formData.get("categorizationNotes"),
      MAX_CATEGORIZATION_NOTES_LENGTH
    );
    const includeAppCategories = readOptionalBoolean(
      formData.get("includeAppCategories")
    );

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
      const categoryCatalog = await loadCategoryCatalog();
      const extractionCategories = categoriesForExtraction(
        categoryCatalog.categories,
        includeAppCategories
      );
      const extraction = await extractStatementFromPdf(file, {
        bytes: artifact.bytes,
        categories: extractionCategories,
        categorizationNotes,
        onDebug: (payload) => saveExtractionArtifact(artifact, payload)
      });
      const finalExtraction = await applyFallbackIfNeeded(
        artifact.pdfPath,
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

    return Response.json(
      { error: "Statement extraction failed." },
      { status: 500 }
    );
  }
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function readOptionalFormString(value: FormDataEntryValue | null, maxLength: number) {
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
  const hasNotionCategories = categories.some(
    (category) => category.source === "notion"
  );
  const shouldIncludeAppCategories =
    includeAppCategories ?? !hasNotionCategories;
  const sourceCategories = shouldIncludeAppCategories
    ? categories
    : categories.filter((category) => category.source !== "app");

  return getEnabledCategoryDefinitions(
    sourceCategories.length > 0 ? sourceCategories : categories
  );
}

async function applyFallbackIfNeeded(
  pdfPath: string,
  extraction: Awaited<ReturnType<typeof extractStatementFromPdf>>,
  categoryNames: readonly string[],
  categorizationNotes: string
) {
  if (extraction.expenses.length > 0) {
    return extraction;
  }

  const fallback = await extractFallbackExpensesFromPdf(
    pdfPath,
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
