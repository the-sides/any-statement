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

    const extraction = await extractStatementFromPdf(file);
    return Response.json({ extraction });
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
