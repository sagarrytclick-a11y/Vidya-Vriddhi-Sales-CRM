import { NextResponse } from "next/server";
import { handleApiError, jsonError, jsonData, readJson } from "@/lib/api";
import { processGoogleSheetSync } from "@/lib/services/google-sheets";
import { googleSheetSyncRequestSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-webhook-secret, authorization",
};

function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function GET() {
  return withCors(
    jsonData({
      ok: true,
      message:
        "Google Sheets webhook is active. Send a POST request with integrationId, secret, eventType, and records.",
      methods: ["POST"],
    }),
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return withCors(jsonError("Invalid or empty JSON body.", 400));
  }

  const parsed = googleSheetSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(jsonError(parsed.error.issues[0]?.message ?? "Invalid sync payload.", 400));
  }

  const secret =
    request.headers.get("x-webhook-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    parsed.data.secret;

  if (!secret) {
    return withCors(jsonError("Webhook secret is required.", 401));
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
    return withCors(jsonData(summary, summary.status === "failed" ? 422 : 200));
  } catch (error) {
    return withCors(handleApiError(error));
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
