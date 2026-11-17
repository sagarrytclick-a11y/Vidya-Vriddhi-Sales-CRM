import { Schema, model, models, type HydratedDocument, type Model } from "mongoose";

export interface IRateLimitBucket {
  key: string;
  windowStart: Date;
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

export type RateLimitBucketDocument = HydratedDocument<IRateLimitBucket>;
export type RateLimitBucketModel = Model<IRateLimitBucket>;

const rateLimitBucketSchema = new Schema<IRateLimitBucket>(
  {
    key: { type: String, required: true, trim: true, maxlength: 200 },
    windowStart: { type: Date, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

rateLimitBucketSchema.index({ key: 1, windowStart: 1 }, { unique: true });
rateLimitBucketSchema.index({ windowStart: 1 }, { expireAfterSeconds: 120 });

export const RateLimitBucket =
  (models.RateLimitBucket as RateLimitBucketModel | undefined) ??
  model<IRateLimitBucket, RateLimitBucketModel>("RateLimitBucket", rateLimitBucketSchema);
