import { handleApiError, jsonError, jsonData, readJson, requireApiAdmin, requireApiUser } from "@/lib/api";
import {
  deleteGoogleSheetIntegration,
  getGoogleSheetIntegration,
  listGoogleSheetSyncLogs,
  rotateGoogleSheetSecret,
  testGoogleSheetIntegration,
  updateGoogleSheetIntegration,
} from "@/lib/services/google-sheets";
import { googleSheetIntegrationUpdateSchema, objectIdSchema } from "@/lib/validators";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const forbidden = requireApiAdmin(auth.user);
  if (forbidden) return forbidden;

  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return jsonError("Invalid integration id.", 400);

  const url = new URL(request.url);
  if (url.searchParams.get("logs") === "1") {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    try {
      const logs = await listGoogleSheetSyncLogs(auth.user, id, Number.isFinite(limit) ? limit : 20);
      return jsonData(logs);
    } catch (error) {
      return handleApiError(error);
    }
  }

  try {
    const integration = await getGoogleSheetIntegration(auth.user, id);
    return jsonData(integration);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const forbidden = requireApiAdmin(auth.user);
  if (forbidden) return forbidden;

  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return jsonError("Invalid integration id.", 400);

  const body = await readJson(request);
  const parsed = googleSheetIntegrationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid integration details.", 400);
  }

  try {
    const integration = await updateGoogleSheetIntegration(auth.user, id, parsed.data);
    return jsonData(integration);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const forbidden = requireApiAdmin(auth.user);
  if (forbidden) return forbidden;

  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return jsonError("Invalid integration id.", 400);

  try {
    await deleteGoogleSheetIntegration(auth.user, id);
    return jsonData({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const forbidden = requireApiAdmin(auth.user);
  if (forbidden) return forbidden;

  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return jsonError("Invalid integration id.", 400);

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "rotate-secret") {
      const result = await rotateGoogleSheetSecret(auth.user, id);
      return jsonData(result);
    }

    if (action === "test") {
      const result = await testGoogleSheetIntegration(auth.user, id);
      return jsonData(result);
    }

    return jsonError("Unknown integration action.", 400);
  } catch (error) {
    return handleApiError(error);
  }
}
