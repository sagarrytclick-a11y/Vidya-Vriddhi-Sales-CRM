import { NextResponse } from "next/server";
import { handleApiError, jsonError, jsonData, readJson } from "@/lib/api";
import { processGoogleSheetSync } from "@/lib/services/google-sheets";
import { googleSheetSyncRequestSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = googleSheetSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid sync payload.", 400);
  }

  const secret =
    request.headers.get("x-webhook-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    parsed.data.secret;

  if (!secret) {
    return jsonError("Webhook secret is required.", 401);
  }

  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    null;

  try {
    const summary = await processGoogleSheetSync({
      integrationId: parsed.data.integrationId,
      secret,
      payload: parsed.data,
      ipAddress,
    });
    return jsonData(summary, summary.status === "failed" ? 400 : 200);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-webhook-secret, authorization",
    },
  });
}
