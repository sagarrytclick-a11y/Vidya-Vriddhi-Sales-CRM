import { NextResponse } from "next/server";
import { LEAD_STATUSES, PAYMENT_STATUSES } from "@/lib/constants";
import { requireApiUser } from "@/lib/api";
import { listLeads } from "@/lib/data/leads";
import type { LeadStatus, PaymentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 120) || undefined;
  const status = LEAD_STATUSES.includes(url.searchParams.get("status") as LeadStatus)
    ? (url.searchParams.get("status") as LeadStatus)
    : undefined;
  const assigned = auth.user.role === "SALES_EXEC" ? undefined : url.searchParams.get("assigned")?.trim() || undefined;
  const category = url.searchParams.get("category")?.trim().slice(0, 100) || undefined;
  const source = url.searchParams.get("source")?.trim().slice(0, 60) || undefined;
  const payment = PAYMENT_STATUSES.includes(url.searchParams.get("payment") as PaymentStatus)
    ? (url.searchParams.get("payment") as PaymentStatus)
    : undefined;
  const attention = [
    "stale",
    "inactive",
    "cold",
    "callback",
    "hot",
    "missed",
  ].includes(url.searchParams.get("attention") ?? "")
    ? (url.searchParams.get("attention") as
        | "stale"
        | "inactive"
        | "cold"
        | "callback"
        | "hot"
        | "missed")
    : undefined;

  const headers = [
    "id",
    "businessName",
    "phoneNumber",
    "email",
    "cityState",
    "category",
    "source",
    "status",
    "assignedTo",
    "followUpDate",
    "dealValue",
    "amountPaid",
    "amountDue",
    "paymentStatus",
    "lastCallResult",
    "lastCalledAt",
    "remarks",
    "googleSheet",
    "externalId",
    "createdAt",
    "updatedAt",
  ];

  const rows: string[] = [headers.join(",")];
  let page = 1;
  let total = 0;

  do {
    const result = await listLeads(auth.user, {
      q,
      status,
      assigned,
      category,
      source,
      payment,
      attention,
      page,
      pageSize: 100,
    });

    total = result.total;

    for (const lead of result.leads) {
      rows.push(
        [
          lead.id,
          lead.businessName,
          lead.phoneNumber,
          lead.email,
          lead.cityState,
          lead.category,
          lead.source,
          lead.status,
          lead.assignedTo?.name ?? "",
          lead.followUpDate,
          lead.dealValue,
          lead.amountPaid,
          lead.amountDue,
          lead.paymentStatus,
          lead.lastCallResult,
          lead.lastCalledAt,
          lead.remarks,
          lead.googleSheetSource?.spreadsheetName ?? "",
          lead.googleSheetSource?.externalId ?? "",
          lead.createdAt,
          lead.updatedAt,
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    page += 1;
  } while ((page - 1) * 100 < total && page <= 50);

  const csv = rows.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="leads-export.csv"',
    },
  });
}
