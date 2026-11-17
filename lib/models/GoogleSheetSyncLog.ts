import { Schema, model, models, type HydratedDocument, type Model, type Types } from "mongoose";

export interface IGoogleSheetSyncLogError {
  rowNumber: number | null;
  externalId: string | null;
  message: string;
}

export interface IGoogleSheetSyncLog {
  integrationId: Types.ObjectId;
  requestId?: string;
  eventType: "webhook" | "manual" | "reconcile" | "test";
  status: "success" | "partial" | "failed";
  recordsReceived: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  errorDetails: IGoogleSheetSyncLogError[];
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type GoogleSheetSyncLogDocument = HydratedDocument<IGoogleSheetSyncLog>;
export type GoogleSheetSyncLogModel = Model<IGoogleSheetSyncLog>;

const googleSheetSyncLogSchema = new Schema<IGoogleSheetSyncLog>(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: "GoogleSheetIntegration", required: true, index: true },
    requestId: { type: String, trim: true, maxlength: 120, default: undefined, index: { unique: true, partialFilterExpression: { requestId: { $type: "string" } } } },
    eventType: { type: String, enum: ["webhook", "manual", "reconcile", "test"], required: true, default: "webhook" },
    status: { type: String, enum: ["success", "partial", "failed"], required: true },
    recordsReceived: { type: Number, default: 0, min: 0 },
    recordsCreated: { type: Number, default: 0, min: 0 },
    recordsUpdated: { type: Number, default: 0, min: 0 },
    recordsSkipped: { type: Number, default: 0, min: 0 },
    recordsFailed: { type: Number, default: 0, min: 0 },
    errorDetails: {
      type: [
        new Schema(
          {
            rowNumber: { type: Number, default: null },
            externalId: { type: String, trim: true, maxlength: 200, default: null },
            message: { type: String, required: true, trim: true, maxlength: 2_000 },
          },
          { _id: false, versionKey: false },
        ),
      ],
      default: [],
    },
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

googleSheetSyncLogSchema.index({ integrationId: 1, createdAt: -1 });

export const GoogleSheetSyncLog =
  (models.GoogleSheetSyncLog as GoogleSheetSyncLogModel | undefined) ??
  model<IGoogleSheetSyncLog, GoogleSheetSyncLogModel>(
    "GoogleSheetSyncLog",
    googleSheetSyncLogSchema,
  );
