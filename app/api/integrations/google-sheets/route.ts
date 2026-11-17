import { requireApiAdmin, handleApiError, jsonError, jsonData, readJson, requireApiUser } from "@/lib/api";
import {
  createGoogleSheetIntegration,
  listGoogleSheetIntegrations,
} from "@/lib/services/google-sheets";
import { googleSheetIntegrationCreateSchema } from "@/lib/validators";
export async function GET() {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const forbidden = requireApiAdmin(auth.user);
  if (forbidden) return forbidden;

  try {
    const integrations = await listGoogleSheetIntegrations(auth.user);
    return jsonData(integrations);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;

  const forbidden = requireApiAdmin(auth.user);
  if (forbidden) return forbidden;

  const body = await readJson(request);
  const parsed = googleSheetIntegrationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid integration details.", 400);
  }

  try {
    const result = await createGoogleSheetIntegration(auth.user, parsed.data);
    return jsonData(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
