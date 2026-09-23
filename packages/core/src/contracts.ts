import { z } from 'zod';

export const PHOTO_LIMIT = 30;
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const VISION_MODEL = 'gemini-3.5-flash-lite';
export const JEV_MODEL = 'jev-1.13.0';
export const CONSENT_VERSION = 'free-cloud-v1';

const id = z.string().min(1).max(150);
export const EmbeddingSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS)
  .refine(v => v.some(n => n !== 0), 'Embedding must not be zero');
export const DateRangeSchema = z.object({
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
}).refine(v => !v.from || !v.to || v.from <= v.to, 'Start date must precede end date');
export type DateRange = z.infer<typeof DateRangeSchema>;
export const UsageSchema = z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative() });
export type Usage = z.infer<typeof UsageSchema>;
export const DescriptionSchema = z.object({
  description: z.string().max(2500),
  visibleText: z.string().max(4000),
});
export const AnalysisRequestSchema = z.object({
  consentVersion: z.literal(CONSENT_VERSION),
  imageBase64: z.string().min(16).max(8_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export const AnalysisSchema = DescriptionSchema.extend({
  embedding: EmbeddingSchema,
  embeddingModel: z.literal(EMBEDDING_MODEL),
  visionModel: z.literal(VISION_MODEL),
  usage: UsageSchema,
});
export type Analysis = z.infer<typeof AnalysisSchema>;
export const QueryRequestSchema = z.object({
  consentVersion: z.literal(CONSENT_VERSION),
  prompt: z.string().trim().min(1).max(1000),
  history: z.array(z.string().min(1).max(1000)).max(8),
  today: z.iso.date(),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;
export const ResolvedQuerySchema = z.object({
  text: z.string().min(1).max(2500),
  dates: DateRangeSchema,
});
export const PreparedQuerySchema = ResolvedQuerySchema.extend({
  embedding: EmbeddingSchema,
  embeddingModel: z.literal(EMBEDDING_MODEL),
  usage: UsageSchema,
});
export type PreparedQuery = z.infer<typeof PreparedQuerySchema>;
export const RankCandidateSchema = z.object({
  id, description: z.string().max(2500), visibleText: z.string().max(4000),
  capturedAt: z.string().nullable(),
});
export const RankRequestSchema = z.object({
  consentVersion: z.literal(CONSENT_VERSION),
  query: z.string().min(1).max(2500),
  candidates: z.array(RankCandidateSchema).max(PHOTO_LIMIT),
}).refine(v => new Set(v.candidates.map(c => c.id)).size === v.candidates.length, 'Duplicate candidates');
export type RankRequest = z.infer<typeof RankRequestSchema>;
export const RankResponseSchema = z.object({
  mode: z.enum(['jev', 'baseline']),
  results: z.array(z.object({ id, score: z.number().min(0).max(1) })).max(PHOTO_LIMIT),
  reason: z.string().max(300).optional(),
});
export type RankResponse = z.infer<typeof RankResponseSchema>;
export const ErrorCodeSchema = z.enum(['SETUP_REQUIRED', 'CONSENT_REQUIRED', 'QUOTA', 'PROVIDER_UNAVAILABLE', 'INVALID_REQUEST', 'UNAUTHORIZED']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  retryAfterSeconds: z.number().nonnegative().optional(),
});
export const HealthSchema = z.object({
  mode: z.literal('free-only'),
  geminiReady: z.boolean(), jevReady: z.boolean(),
  issues: z.array(z.string()),
  lastProviderError: ApiErrorSchema.nullable(),
  usage: UsageSchema,
});
export type Health = z.infer<typeof HealthSchema>;

export class ServiceError extends Error {
  constructor(public code: ErrorCode, message: string, public retryAfterSeconds?: number) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface Photo {
  id: string;
  assetId: string | null;
  uri: string;
  width: number;
  height: number;
  capturedAt: string | null;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  analysis: Analysis | null;
  error: string | null;
  addedAt: string;
}

export function assertCapacity(currentCount: number, addedCount: number): void {
  if (currentCount + addedCount > PHOTO_LIMIT) throw new Error(`Choose no more than ${PHOTO_LIMIT} photos in total.`);
}

export function queryCacheKey(request: QueryRequest): string {
  return JSON.stringify([EMBEDDING_MODEL, request.today, request.history, request.prompt.trim()]);
}

export function exifDate(exif: Record<string, unknown> | null | undefined): string | null {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTimeDigitized ?? exif?.DateTime;
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return z.iso.date().safeParse(date).success ? date : null;
}
