import { Schema, model, models, type HydratedDocument, type Model, type Types } from "mongoose";

export type GoogleSheetIntegrationStatus = "success" | "partial" | "failed" | null;

export interface IGoogleSheetIntegration {
  name: string;
  spreadsheetId: string;
  spreadsheetName: string | null;
  sheetTabName: string | null;
  columnMapping: Record<string, string>;
  allowedUpdateFields: string[];
  autoAssign: boolean;
  enabled: boolean;
  webhookSecretHash: string;
  createdBy: Types.ObjectId;
  lastSyncedAt: Date | null;
  lastSyncStatus: GoogleSheetIntegrationStatus;
  lastError: string | null;
  lastCounts: {
    received: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export type GoogleSheetIntegrationDocument = HydratedDocument<IGoogleSheetIntegration>;
export type GoogleSheetIntegrationModel = Model<IGoogleSheetIntegration>;

const googleSheetIntegrationSchema = new Schema<IGoogleSheetIntegration>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    spreadsheetId: { type: String, required: true, trim: true, maxlength: 200, index: true },
    spreadsheetName: { type: String, trim: true, maxlength: 200, default: null },
    sheetTabName: { type: String, trim: true, maxlength: 200, default: null },
    columnMapping: { type: Schema.Types.Mixed, default: {} },
    allowedUpdateFields: { type: [String], default: [] },
    autoAssign: { type: Boolean, default: true },
    enabled: { type: Boolean, default: true, index: true },
    webhookSecretHash: { type: String, required: true, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    lastSyncedAt: { type: Date, default: null },
    lastSyncStatus: { type: String, enum: ["success", "partial", "failed", null], default: null },
    lastError: { type: String, trim: true, maxlength: 2_000, default: null },
    lastCounts: {
      type: new Schema(
        {
          received: { type: Number, default: 0 },
          created: { type: Number, default: 0 },
          updated: { type: Number, default: 0 },
          skipped: { type: Number, default: 0 },
          failed: { type: Number, default: 0 },
        },
        { _id: false, versionKey: false },
      ),
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

googleSheetIntegrationSchema.index({ createdBy: 1, createdAt: -1 });
googleSheetIntegrationSchema.index({ spreadsheetId: 1, sheetTabName: 1 });

export const GoogleSheetIntegration =
  (models.GoogleSheetIntegration as GoogleSheetIntegrationModel | undefined) ??
  model<IGoogleSheetIntegration, GoogleSheetIntegrationModel>(
    "GoogleSheetIntegration",
    googleSheetIntegrationSchema,
  );
