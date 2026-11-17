import { handleApiError, jsonError, jsonData, readJson, requireApiUser } from "@/lib/api";
import { bulkSetFollowUpDate } from "@/lib/services/leads";
import { z } from "zod";

const bulkFollowUpSchema = z.object({
  leadIds: z.array(z.string().trim().regex(/^[a-f\d]{24}$/i)).min(1).max(500),
  followUpDate: z.string().trim().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;

  const body = await readJson(request);
  const parsed = bulkFollowUpSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid bulk follow-up update.", 400);
  }

  try {
    const count = await bulkSetFollowUpDate(auth.user, parsed.data.leadIds, parsed.data.followUpDate);
    return jsonData({ updated: count });
  } catch (error) {
    return handleApiError(error);
  }
}
