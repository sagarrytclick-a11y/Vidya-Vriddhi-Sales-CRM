import { handleApiError, jsonError, jsonData, requireApiUser } from "@/lib/api";
import { getGoogleSheetReport } from "@/lib/services/google-sheets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  const reportKey = request.headers.get("x-report-key")?.trim();
  const envKey = process.env.SHEETS_REPORT_KEY?.trim();

  if (!auth.user && !(envKey && reportKey && reportKey === envKey)) {
    return jsonError("Unauthorized.", 401);
  }

  if (auth.user) {
    const forbidden = auth.user.role === "SALES_EXEC" ? jsonError("You do not have permission to do that.", 403) : null;
    if (forbidden) return forbidden;
  }

  const url = new URL(request.url);
  const section = url.searchParams.get("section") ?? "all";
  const page = Number(url.searchParams.get("page") ?? 1);
  const limit = Number(url.searchParams.get("limit") ?? 100);

  try {
    const report = await getGoogleSheetReport({
      section: section === "summary" || section === "reps" || section === "leads" || section === "all" ? section : "all",
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return jsonData(report);
  } catch (error) {
    return handleApiError(error);
  }
}
