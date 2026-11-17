import type { ILead } from "@/lib/models/Lead";
import type { QueryFilter } from "mongoose";

export type AttentionFilter =
  | "stale"
  | "inactive"
  | "cold"
  | "callback"
  | "hot"
  | "missed";

const OPEN_STATUSES = ["NEW", "CONTACTED", "FOLLOW_UP", "MEETING", "PROPOSAL"] as const;

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function lastActivityBefore(days: number) {
  return { $lt: daysAgo(days) };
}

export function attentionFilter(kind: AttentionFilter): QueryFilter<ILead> {
  switch (kind) {
    case "stale":
      return {
        status: { $in: [...OPEN_STATUSES] },
        $or: [{ lastCalledAt: lastActivityBefore(7) }, { lastCalledAt: null, createdAt: { $lt: daysAgo(7) } }],
      };
    case "inactive":
      return {
        status: { $in: [...OPEN_STATUSES] },
        $or: [{ lastCalledAt: lastActivityBefore(14) }, { lastCalledAt: null, createdAt: { $lt: daysAgo(14) } }],
      };
    case "cold":
      return {
        status: { $in: [...OPEN_STATUSES] },
        $or: [{ lastCalledAt: lastActivityBefore(30) }, { lastCalledAt: null, createdAt: { $lt: daysAgo(30) } }],
      };
    case "callback":
      return { lastCallResult: "Callback requested" };
    case "hot":
      return { status: { $in: ["MEETING", "PROPOSAL"] } };
    case "missed": {
      const oneDayAgo = daysAgo(1);
      const sevenDaysAgo = daysAgo(7);
      return {
        $or: [
          {
            status: { $in: ["MEETING", "PROPOSAL"] },
            $or: [{ lastCalledAt: { $lt: oneDayAgo } }, { lastCalledAt: null }],
          },
          { status: "MEETING", followUpDate: null },
          {
            status: "PROPOSAL",
            $or: [{ lastCalledAt: { $lt: sevenDaysAgo } }, { lastCalledAt: null }],
          },
          {
            $expr: {
              $and: [
                { $ne: [{ $ifNull: ["$dealValue", null] }, null] },
                {
                  $gt: [
                    { $ifNull: ["$dealValue", 0] },
                    { $sum: { $ifNull: ["$payments.amount", []] } },
                  ],
                },
              ],
            },
          },
          { assignedTo: { $ne: null }, lastCalledAt: null },
        ],
      };
    }
  }
}
