import { handleApiError, jsonError, jsonData, readJson, requireApiUser } from "@/lib/api";
import { bulkUpdateLeadStatus } from "@/lib/services/leads";
import { leadStatusSchema } from "@/lib/validators";
import { z } from "zod";

const bulkStatusSchema = z.object({
  leadIds: z.array(z.string().trim().regex(/^[a-f\d]{24}$/i)).min(1).max(500),
  status: leadStatusSchema,
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;

  const body = await readJson(request);
  const parsed = bulkStatusSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid bulk status update.", 400);
  }

  try {
    const count = await bulkUpdateLeadStatus(auth.user, parsed.data.leadIds, parsed.data.status);
    return jsonData({ updated: count });
  } catch (error) {
    return handleApiError(error);
  }
}
