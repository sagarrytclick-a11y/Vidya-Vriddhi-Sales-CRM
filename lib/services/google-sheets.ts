import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { connectToDatabase } from "@/lib/db/connect";
import { GoogleSheetIntegration } from "@/lib/models/GoogleSheetIntegration";
import type { IGoogleSheetIntegration } from "@/lib/models/GoogleSheetIntegration";
import { GoogleSheetSyncLog } from "@/lib/models/GoogleSheetSyncLog";
import { GoogleSheetSyncRecord } from "@/lib/models/GoogleSheetSyncRecord";
import { Lead } from "@/lib/models/Lead";
import { RateLimitBucket } from "@/lib/models/RateLimitBucket";
import { User } from "@/lib/models/User";
import { getAnalytics } from "@/lib/data/analytics";
import { listLeads } from "@/lib/data/leads";
import { ServiceError } from "@/lib/services/errors";
import { normalizePhoneNumber } from "@/lib/utils";
import { normalizeLeadSource } from "@/lib/constants";
import type { SessionUser } from "@/lib/types";
import type { Types } from "mongoose";
import type { z } from "zod";
import type {
  googleSheetIntegrationCreateSchema,
  googleSheetIntegrationUpdateSchema,
  googleSheetSyncRequestSchema,
} from "@/lib/validators";

type CreateInput = z.infer<typeof googleSheetIntegrationCreateSchema>;
type UpdateInput = z.infer<typeof googleSheetIntegrationUpdateSchema>;
type SyncRequest = z.infer<typeof googleSheetSyncRequestSchema>;

export const SAFE_GOOGLE_SHEET_UPDATE_FIELDS = [
  "businessName",
  "phoneNumber",
  "email",
  "cityState",
  "category",
  "source",
  "remarks",
  "spreadsheetName",
  "sheetTabName",
  "syncedAt",
  "lastSourceUpdateAt",
] as const;

export const CRM_SYNC_FIELDS = [
  "businessName",
  "phoneNumber",
  "email",
  "cityState",
  "category",
  "source",
  "remarks",
] as const;

export interface GoogleSheetIntegrationView {
  id: string;
  name: string;
  spreadsheetId: string;
  spreadsheetName: string | null;
  sheetTabName: string | null;
  columnMapping: Record<string, string>;
  allowedUpdateFields: string[];
  autoAssign: boolean;
  enabled: boolean;
  createdBy: string;
  lastSyncedAt: string | null;
  lastSyncStatus: "success" | "partial" | "failed" | null;
  lastError: string | null;
  lastCounts: {
    received: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleSheetSyncSummary {
  integrationId: string;
  recordsReceived: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  errorDetails: Array<{ rowNumber: number | null; externalId: string | null; message: string }>;
  status: "success" | "partial" | "failed";
  cached?: boolean;
}

function mapIntegration(doc: IGoogleSheetIntegration & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }): GoogleSheetIntegrationView {
  return {
    id: doc._id.toString(),
    name: doc.name,
    spreadsheetId: doc.spreadsheetId,
    spreadsheetName: doc.spreadsheetName ?? null,
    sheetTabName: doc.sheetTabName ?? null,
    columnMapping: Object.fromEntries(Object.entries(doc.columnMapping ?? {})),
    allowedUpdateFields:
      Array.isArray(doc.allowedUpdateFields) && doc.allowedUpdateFields.length > 0
        ? doc.allowedUpdateFields
        : [...SAFE_GOOGLE_SHEET_UPDATE_FIELDS],
    autoAssign: Boolean(doc.autoAssign),
    enabled: Boolean(doc.enabled),
    createdBy: doc.createdBy?.toString() ?? "",
    lastSyncedAt: doc.lastSyncedAt ? new Date(doc.lastSyncedAt).toISOString() : null,
    lastSyncStatus: doc.lastSyncStatus ?? null,
    lastError: doc.lastError ?? null,
    lastCounts: doc.lastCounts ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

function isAllowedField(field: string): boolean {
  return (
    (CRM_SYNC_FIELDS as readonly string[]).includes(field) ||
    (SAFE_GOOGLE_SHEET_UPDATE_FIELDS as readonly string[]).includes(field)
  );
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeEmail(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.toLowerCase();
}

function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function normalizeRow(values: Record<string, unknown>, mapping: Record<string, string>) {
  const mapped: Record<string, string | null> = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (!isAllowedField(field)) continue;
    mapped[field] = normalizeText(values[header]);
  }

  const businessName = mapped.businessName ?? null;
  const rawPhone = mapped.phoneNumber ?? null;
  const phoneNumber = rawPhone ? normalizePhoneNumber(rawPhone) : null;
  const email = normalizeEmail(mapped.email);
  const cityState = mapped.cityState ?? null;
  const category = mapped.category ?? null;
  const sourceInput = mapped.source;
  const source = sourceInput ? normalizeLeadSource(sourceInput) : null;
  const remarks = mapped.remarks ?? null;

  return {
    businessName,
    phoneNumber,
    email,
    cityState,
    category,
    source: source ?? (sourceInput ? "Other" : null),
    remarks,
    rawPhone,
  };
}

function rowHash(normalized: ReturnType<typeof normalizeRow>): string {
  return stableHash({
    businessName: normalized.businessName,
    phoneNumber: normalized.phoneNumber,
    email: normalized.email,
    cityState: normalized.cityState,
    category: normalized.category,
    source: normalized.source,
    remarks: normalized.remarks,
  });
}

async function checkRateLimit(key: string, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const bucket = await RateLimitBucket.findOneAndUpdate(
    { key, windowStart },
    { $inc: { count: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (bucket.count > limit) {
    throw new ServiceError("Too many sync requests. Try again in a minute.", 429);
  }
}

async function leastLoadedRepId(): Promise<string | null> {
  const reps = await User.find({ role: "SALES_EXEC", isActive: true }).select("_id").lean();
  if (reps.length === 0) return null;

  const counts = await Lead.aggregate<{ _id: string | null; count: number }>([
    { $match: { assignedTo: { $in: reps.map((rep) => rep._id) } } },
    { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((row) => [String(row._id), row.count]));

  let selected = reps[0];
  let selectedCount = countMap.get(String(selected._id)) ?? 0;
  for (const rep of reps.slice(1)) {
    const count = countMap.get(String(rep._id)) ?? 0;
    if (count < selectedCount) {
      selected = rep;
      selectedCount = count;
    }
  }

  return selected._id.toString();
}

function assertAdmin(user: SessionUser): void {
  if (user.role === "SALES_EXEC") {
    throw new ServiceError("You do not have permission to do that.", 403);
  }
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function hashWebhookSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

export async function verifyWebhookSecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

export async function listGoogleSheetIntegrations(user: SessionUser): Promise<GoogleSheetIntegrationView[]> {
  assertAdmin(user);
  await connectToDatabase();
  const docs = await GoogleSheetIntegration.find({}).sort({ createdAt: -1 }).lean();
  return docs.map(mapIntegration);
}

export async function getGoogleSheetIntegration(user: SessionUser, integrationId: string) {
  assertAdmin(user);
  await connectToDatabase();
  const doc = await GoogleSheetIntegration.findById(integrationId).lean();
  if (!doc) throw new ServiceError("Integration not found.", 404);
  return mapIntegration(doc);
}

export async function createGoogleSheetIntegration(user: SessionUser, input: CreateInput) {
  assertAdmin(user);
  await connectToDatabase();

  const secret = generateWebhookSecret();
  const hash = await hashWebhookSecret(secret);

  const doc = await GoogleSheetIntegration.create({
    name: input.name,
    spreadsheetId: input.spreadsheetId,
    spreadsheetName: input.spreadsheetName ?? null,
    sheetTabName: input.sheetTabName ?? null,
    columnMapping: input.columnMapping ?? {},
    allowedUpdateFields:
      input.allowedUpdateFields && input.allowedUpdateFields.length > 0
        ? input.allowedUpdateFields.filter(isAllowedField)
        : [...SAFE_GOOGLE_SHEET_UPDATE_FIELDS],
    autoAssign: input.autoAssign,
    enabled: input.enabled,
    createdBy: user.id,
    webhookSecretHash: hash,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastError: null,
    lastCounts: null,
  });

  return { integration: mapIntegration(doc.toObject()), secret };
}

export async function updateGoogleSheetIntegration(user: SessionUser, integrationId: string, input: UpdateInput) {
  assertAdmin(user);
  await connectToDatabase();

  const doc = await GoogleSheetIntegration.findById(integrationId);
  if (!doc) throw new ServiceError("Integration not found.", 404);

  if (input.name !== undefined) doc.name = input.name;
  if (input.spreadsheetId !== undefined) doc.spreadsheetId = input.spreadsheetId;
  if (input.spreadsheetName !== undefined) doc.spreadsheetName = input.spreadsheetName;
  if (input.sheetTabName !== undefined) doc.sheetTabName = input.sheetTabName;
  if (input.columnMapping !== undefined) doc.columnMapping = input.columnMapping as Record<string, string>;
  if (input.autoAssign !== undefined) doc.autoAssign = input.autoAssign;
  if (input.enabled !== undefined) doc.enabled = input.enabled;
  if (input.allowedUpdateFields !== undefined) {
    doc.allowedUpdateFields = input.allowedUpdateFields.filter(isAllowedField);
  }

  await doc.save();
  return mapIntegration(doc.toObject());
}

export async function deleteGoogleSheetIntegration(user: SessionUser, integrationId: string) {
  assertAdmin(user);
  await connectToDatabase();

  const doc = await GoogleSheetIntegration.findById(integrationId);
  if (!doc) throw new ServiceError("Integration not found.", 404);

  await GoogleSheetSyncRecord.deleteMany({ integrationId: doc._id });
  await GoogleSheetSyncLog.deleteMany({ integrationId: doc._id });
  await doc.deleteOne();
}

export async function rotateGoogleSheetSecret(user: SessionUser, integrationId: string) {
  assertAdmin(user);
  await connectToDatabase();

  const doc = await GoogleSheetIntegration.findById(integrationId);
  if (!doc) throw new ServiceError("Integration not found.", 404);

  const secret = generateWebhookSecret();
  doc.webhookSecretHash = await hashWebhookSecret(secret);
  await doc.save();

  return { integration: mapIntegration(doc.toObject()), secret };
}

export async function getIntegrationForWebhook(integrationId: string, secret: string) {
  await connectToDatabase();
  const doc = await GoogleSheetIntegration.findById(integrationId).select("+webhookSecretHash");
  if (!doc) throw new ServiceError("Integration not found.", 404);
  if (!doc.enabled) throw new ServiceError("Integration is disabled.", 403);

  const valid = await verifyWebhookSecret(secret, doc.webhookSecretHash);
  if (!valid) throw new ServiceError("Invalid webhook secret.", 401);

  return doc;
}

export async function testGoogleSheetIntegration(user: SessionUser, integrationId: string) {
  assertAdmin(user);
  await connectToDatabase();
  const doc = await GoogleSheetIntegration.findById(integrationId);
  if (!doc) throw new ServiceError("Integration not found.", 404);

  const now = new Date();
  await GoogleSheetSyncLog.create({
    integrationId: doc._id,
    requestId: undefined,
    eventType: "test",
    status: "success",
    recordsReceived: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
    errorDetails: [],
    startedAt: now,
    finishedAt: now,
  });

  return {
    ok: true,
    integration: mapIntegration(doc.toObject()),
    webhookPath: "/api/integrations/google-sheets/webhook",
  };
}

export async function listGoogleSheetSyncLogs(user: SessionUser, integrationId: string, limit = 20) {
  assertAdmin(user);
  await connectToDatabase();

  const integration = await GoogleSheetIntegration.findById(integrationId).lean();
  if (!integration) throw new ServiceError("Integration not found.", 404);

  const logs = await GoogleSheetSyncLog.find({ integrationId }).sort({ createdAt: -1 }).limit(Math.min(limit, 100)).lean();
  return logs.map((log) => ({
    id: log._id.toString(),
    eventType: log.eventType,
    status: log.status,
    recordsReceived: log.recordsReceived,
    recordsCreated: log.recordsCreated,
    recordsUpdated: log.recordsUpdated,
    recordsSkipped: log.recordsSkipped,
    recordsFailed: log.recordsFailed,
    errorDetails: log.errorDetails ?? [],
    startedAt: new Date(log.startedAt).toISOString(),
    finishedAt: new Date(log.finishedAt).toISOString(),
    createdAt: new Date(log.createdAt).toISOString(),
  }));
}

export async function processGoogleSheetSync(input: {
  integrationId: string;
  secret: string;
  payload: SyncRequest;
  ipAddress: string | null;
}): Promise<GoogleSheetSyncSummary> {
  const integrationDoc = await getIntegrationForWebhook(input.integrationId, input.secret);

  await checkRateLimit(`google-sheets:${input.integrationId}:${input.ipAddress ?? "unknown"}`);

  const startedAt = new Date();
  const counts = { received: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  const errors: Array<{ rowNumber: number | null; externalId: string | null; message: string }> = [];

  // Idempotent request replay.
  if (input.payload.requestId) {
    const existing = await GoogleSheetSyncLog.findOne({
      integrationId: integrationDoc._id,
      requestId: input.payload.requestId,
    }).lean();

    if (existing) {
      return {
        integrationId: integrationDoc._id.toString(),
        recordsReceived: existing.recordsReceived,
        recordsCreated: existing.recordsCreated,
        recordsUpdated: existing.recordsUpdated,
        recordsSkipped: existing.recordsSkipped,
        recordsFailed: existing.recordsFailed,
        errorDetails: existing.errorDetails ?? [],
        status: existing.status,
        cached: true,
      };
    }
  }

  if (input.payload.records.length === 0) {
    const finishedAt = new Date();
    integrationDoc.lastSyncedAt = finishedAt;
    integrationDoc.lastSyncStatus = "success";
    integrationDoc.lastError = null;
    await integrationDoc.save();

    await GoogleSheetSyncLog.create({
      integrationId: integrationDoc._id,
      requestId: input.payload.requestId ?? undefined,
      eventType: input.payload.eventType,
      status: "success",
      recordsReceived: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorDetails: [],
      startedAt: finishedAt,
      finishedAt,
    });

    return {
      integrationId: integrationDoc._id.toString(),
      recordsReceived: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorDetails: [],
      status: "success",
    };
  }
  const mapping = (integrationDoc.columnMapping ?? {}) as Record<string, string>;
  const hasMapping = Object.keys(mapping).length > 0;
  const allowedUpdateFields = new Set(
    Array.isArray(integrationDoc.allowedUpdateFields) && integrationDoc.allowedUpdateFields.length > 0
      ? integrationDoc.allowedUpdateFields
      : [...SAFE_GOOGLE_SHEET_UPDATE_FIELDS],
  );

  if (input.payload.spreadsheetName) integrationDoc.spreadsheetName = input.payload.spreadsheetName;
  if (input.payload.sheetTabName) integrationDoc.sheetTabName = input.payload.sheetTabName;

  for (const record of input.payload.records) {
    counts.received += 1;
    const externalId = record.externalId.trim();
    const rowNumber = record.rowNumber ?? null;

    try {
      if (!hasMapping) throw new Error("Column mapping is not configured for this integration.");
      if (!externalId) throw new Error("CRM_SYNC_ID is required.");

      const normalized = normalizeRow(record.values, mapping);
      if (!normalized.businessName) throw new Error("Business name is required.");
      if (!normalized.phoneNumber) throw new Error("A valid phone number is required.");

      const incomingHash = record.rowHash?.trim() || rowHash(normalized);

      const existingRecord = await GoogleSheetSyncRecord.findOne({
        integrationId: integrationDoc._id,
        externalId,
      });

      if (existingRecord) {
        const lead = await Lead.findById(existingRecord.leadId);
        if (!lead) {
          // The linked lead was deleted; recreate it below by clearing the stale record.
          await existingRecord.deleteOne();
        } else {
          if (existingRecord.lastRowHash && existingRecord.lastRowHash === incomingHash) {
            counts.skipped += 1;
            existingRecord.lastSyncedAt = new Date();
            existingRecord.status = "skipped";
            await existingRecord.save();
            continue;
          }

          // Duplicate protection for changed phone numbers.
          if (normalized.phoneNumber !== lead.phoneNumber) {
            const phoneOwner = await Lead.findOne({
              _id: { $ne: lead._id },
              phoneNumber: normalized.phoneNumber,
            }).select("_id");
            if (phoneOwner) {
              counts.skipped += 1;
              errors.push({ rowNumber, externalId, message: "Skipped: phone number already belongs to another lead." });
              existingRecord.status = "skipped";
              existingRecord.errorMessage = "Phone number already belongs to another lead.";
              existingRecord.lastSyncedAt = new Date();
              await existingRecord.save();
              continue;
            }
          }

          const update: Record<string, unknown> = {};
          if (allowedUpdateFields.has("businessName")) update.businessName = normalized.businessName;
          if (allowedUpdateFields.has("phoneNumber")) update.phoneNumber = normalized.phoneNumber;
          if (allowedUpdateFields.has("email")) update.email = normalized.email;
          if (allowedUpdateFields.has("cityState")) update.cityState = normalized.cityState;
          if (allowedUpdateFields.has("category")) update.category = normalized.category;
          if (allowedUpdateFields.has("source") && normalized.source) update.source = normalized.source;
          if (allowedUpdateFields.has("remarks")) update.remarks = normalized.remarks;
          if (allowedUpdateFields.has("spreadsheetName")) update["googleSheetSource.spreadsheetName"] = integrationDoc.spreadsheetName;
          if (allowedUpdateFields.has("sheetTabName")) update["googleSheetSource.sheetTabName"] = integrationDoc.sheetTabName;
          if (allowedUpdateFields.has("syncedAt")) update["googleSheetSource.syncedAt"] = new Date();
          if (allowedUpdateFields.has("lastSourceUpdateAt")) update["googleSheetSource.lastSourceUpdateAt"] = new Date();

          update["googleSheetSource.integrationId"] = integrationDoc._id;
          update["googleSheetSource.spreadsheetId"] = integrationDoc.spreadsheetId;
          update["googleSheetSource.externalId"] = externalId;

          await Lead.updateOne({ _id: lead._id }, { $set: update });

          existingRecord.lastRowHash = incomingHash;
          existingRecord.lastSourceUpdateAt = new Date();
          existingRecord.lastSyncedAt = new Date();
          existingRecord.status = "updated";
          existingRecord.errorMessage = null;
          await existingRecord.save();

          counts.updated += 1;
          continue;
        }
      }

      // Duplicate protection before creating a new lead.
      const duplicatePhone = await Lead.findOne({ phoneNumber: normalized.phoneNumber }).select("_id").lean();
      if (duplicatePhone) {
        counts.skipped += 1;
        errors.push({ rowNumber, externalId, message: "Skipped: phone number already belongs to an existing lead." });
        continue;
      }

      if (normalized.email) {
        const duplicateEmail = await Lead.findOne({ email: normalized.email }).select("_id").lean();
        if (duplicateEmail) {
          counts.skipped += 1;
          errors.push({ rowNumber, externalId, message: "Skipped: email already belongs to an existing lead." });
          continue;
        }
      }

      const assignedTo = integrationDoc.autoAssign ? await leastLoadedRepId() : null;

      const lead = await Lead.create({
        businessName: normalized.businessName,
        phoneNumber: normalized.phoneNumber,
        email: normalized.email,
        cityState: normalized.cityState,
        category: normalized.category,
        source: normalized.source,
        status: "NEW",
        assignedTo,
        remarks: normalized.remarks,
        googleSheetSource: {
          integrationId: integrationDoc._id,
          spreadsheetId: integrationDoc.spreadsheetId,
          spreadsheetName: integrationDoc.spreadsheetName,
          sheetTabName: integrationDoc.sheetTabName,
          externalId,
          syncedAt: new Date(),
          lastSourceUpdateAt: new Date(),
        },
      });

      await GoogleSheetSyncRecord.create({
        integrationId: integrationDoc._id,
        externalId,
        leadId: lead._id,
        sheetTabName: integrationDoc.sheetTabName,
        lastRowHash: incomingHash,
        lastSourceUpdateAt: new Date(),
        lastSyncedAt: new Date(),
        status: "created",
        errorMessage: null,
      });

      counts.created += 1;
    } catch (error) {
      counts.failed += 1;
      const message = error instanceof Error ? error.message : "Unexpected sync error.";
      errors.push({ rowNumber, externalId, message });
      try {
        await GoogleSheetSyncLog.create({
          integrationId: integrationDoc._id,
          requestId: undefined,
          eventType: "webhook",
          status: "failed",
          recordsReceived: 1,
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          recordsFailed: 1,
          errorDetails: [{ rowNumber, externalId, message }],
          startedAt: new Date(),
          finishedAt: new Date(),
        });
      } catch {
        // Logging must never block the sync response.
      }
    }
  }

  const finishedAt = new Date();
  const status: "success" | "partial" | "failed" =
    counts.failed === 0 ? "success" : counts.created + counts.updated > 0 ? "partial" : "failed";

  integrationDoc.lastSyncedAt = finishedAt;
  integrationDoc.lastSyncStatus = status;
  integrationDoc.lastError = errors.length > 0 ? errors[0].message : null;
  integrationDoc.lastCounts = {
    received: counts.received,
    created: counts.created,
    updated: counts.updated,
    skipped: counts.skipped,
    failed: counts.failed,
  };
  await integrationDoc.save();

  await GoogleSheetSyncLog.create({
    integrationId: integrationDoc._id,
    requestId: input.payload.requestId ?? undefined,
    eventType: input.payload.eventType,
    status,
    recordsReceived: counts.received,
    recordsCreated: counts.created,
    recordsUpdated: counts.updated,
    recordsSkipped: counts.skipped,
    recordsFailed: counts.failed,
    errorDetails: errors,
    startedAt,
    finishedAt,
  });

  return {
    integrationId: integrationDoc._id.toString(),
    recordsReceived: counts.received,
    recordsCreated: counts.created,
    recordsUpdated: counts.updated,
    recordsSkipped: counts.skipped,
    recordsFailed: counts.failed,
    errorDetails: errors,
    status,
  };
}

export async function getGoogleSheetReport(options: {
  page?: number;
  limit?: number;
  section?: "summary" | "reps" | "leads" | "all";
}) {
  await connectToDatabase();

  const analytics = await getAnalytics();
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const section = options.section ?? "all";

  const adminUser: SessionUser = {
    id: "system",
    name: "Automation",
    username: "automation",
    email: null,
    role: "SUPER_ADMIN",
  };

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    timezone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
    summary: {
      totalLeads: analytics.totalLeads,
      unassignedLeads: analytics.unassignedLeads,
      convertedLeads: analytics.convertedLeads,
      conversionRate: analytics.conversionRate,
      callsToday: analytics.callsToday,
      callsThisWeek: analytics.callsThisWeek,
      connectedCallsThisWeek: analytics.connectedCallsThisWeek,
      followUpsToday: analytics.followUpsToday,
      followUpsThisWeek: analytics.followUpsThisWeek,
      manualStageChangesThisWeek: analytics.manualStageChangesThisWeek,
      contactedWithoutCall: analytics.contactedWithoutCall,
      staleLeads: analytics.staleLeads,
      totalDealValue: analytics.totalDealValue,
      paymentsCollected: analytics.paymentsCollected,
      paymentsPending: analytics.paymentsPending,
      incentivesEarned: analytics.incentivesEarned,
    },
    reps:
      section === "summary"
        ? []
        : analytics.reps.map((rep) => ({
            id: rep.id,
            name: rep.name,
            username: rep.username,
            email: rep.email,
            isActive: rep.isActive,
            leadsAssigned: rep.leadsAssigned,
            converted: rep.converted,
            meetings: rep.meetings,
            proposals: rep.proposals,
            callsToday: rep.callsToday,
            callsThisWeek: rep.callsThisWeek,
            connectedCallsThisWeek: rep.connectedCallsThisWeek,
            uniqueLeadsCalledThisWeek: rep.uniqueLeadsCalledThisWeek,
            followUpsToday: rep.followUpsToday,
            followUpsOverdue: rep.followUpsOverdue,
            manualStageChangesThisWeek: rep.manualStageChangesThisWeek,
            contactedWithoutCall: rep.contactedWithoutCall,
            staleLeads: rep.staleLeads,
            conversionRate: rep.conversionRate,
            paymentsCollected: rep.paymentsCollected,
            incentivesEarned: rep.incentivesEarned,
            incentiveRate: rep.incentiveRate,
            incentiveEnabled: rep.incentiveEnabled,
            lastActivityAt: rep.lastActivityAt,
          })),
  };

  if (section === "leads" || section === "all") {
    const result = await listLeads(adminUser, { page, pageSize: limit });
    report.leads = result.leads.map((lead) => ({
      id: lead.id,
      businessName: lead.businessName,
      phoneNumber: lead.phoneNumber,
      email: null,
      cityState: lead.cityState,
      category: lead.category,
      source: lead.source,
      status: lead.status,
      assignedTo: lead.assignedTo,
      followUpDate: lead.followUpDate,
      dealValue: lead.dealValue,
      amountPaid: lead.amountPaid,
      amountDue: lead.amountDue,
      paymentStatus: lead.paymentStatus,
      lastCallResult: null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      googleSheetSource: null,
    }));
    report.pagination = {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    };
  }

  return report;
}

