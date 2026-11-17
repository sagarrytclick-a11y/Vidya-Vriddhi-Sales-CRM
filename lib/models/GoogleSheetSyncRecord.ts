import { Schema, model, models, type HydratedDocument, type Model, type Types } from "mongoose";

export interface IGoogleSheetSyncRecord {
  integrationId: Types.ObjectId;
  externalId: string;
  leadId: Types.ObjectId;
  sheetTabName: string | null;
  lastRowHash: string | null;
  lastSourceUpdateAt: Date | null;
  lastSyncedAt: Date;
  status: "created" | "updated" | "skipped" | "failed";
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type GoogleSheetSyncRecordDocument = HydratedDocument<IGoogleSheetSyncRecord>;
export type GoogleSheetSyncRecordModel = Model<IGoogleSheetSyncRecord>;

const googleSheetSyncRecordSchema = new Schema<IGoogleSheetSyncRecord>(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: "GoogleSheetIntegration", required: true, index: true },
    externalId: { type: String, required: true, trim: true, maxlength: 200 },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    sheetTabName: { type: String, trim: true, maxlength: 200, default: null },
    lastRowHash: { type: String, trim: true, maxlength: 128, default: null },
    lastSourceUpdateAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: ["created", "updated", "skipped", "failed"], required: true, default: "created" },
    errorMessage: { type: String, trim: true, maxlength: 2_000, default: null },
  },
  { timestamps: true, versionKey: false },
);

googleSheetSyncRecordSchema.index({ integrationId: 1, externalId: 1 }, { unique: true });
googleSheetSyncRecordSchema.index({ leadId: 1, updatedAt: -1 });

export const GoogleSheetSyncRecord =
  (models.GoogleSheetSyncRecord as GoogleSheetSyncRecordModel | undefined) ??
  model<IGoogleSheetSyncRecord, GoogleSheetSyncRecordModel>(
    "GoogleSheetSyncRecord",
    googleSheetSyncRecordSchema,
  );
