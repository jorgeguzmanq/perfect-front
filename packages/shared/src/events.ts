import { z } from "zod";
import { ProcessStateSchema, ProjectSummarySchema } from "./api";
import { VisualCommentSchema } from "./comment";
import { CollectionNameSchema, CommentIdSchema, ProjectIdSchema } from "./ids";
import { TimestampSchema } from "./timestamps";

const base = { at: TimestampSchema, projectId: ProjectIdSchema };

export const ProjectEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("project.registered"), project: ProjectSummarySchema }).strict(),
  z.object({ ...base, type: z.literal("project.updated"), project: ProjectSummarySchema }).strict(),
  z.object({ ...base, type: z.literal("project.removed") }).strict(),
]);

export const CommentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("comment.created"), comment: VisualCommentSchema }).strict(),
  z.object({ ...base, type: z.literal("comment.updated"), comment: VisualCommentSchema }).strict(),
  z
    .object({
      ...base,
      type: z.literal("comment.moved"),
      commentId: CommentIdSchema,
      from: CollectionNameSchema,
      to: CollectionNameSchema,
      comment: VisualCommentSchema,
    })
    .strict(),
  z.object({ ...base, type: z.literal("comment.resolved"), comment: VisualCommentSchema }).strict(),
  z
    .object({ ...base, type: z.literal("comment.deleted"), commentId: CommentIdSchema, collection: CollectionNameSchema })
    .strict(),
]);

export const CollectionEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("collection.created"), collection: CollectionNameSchema }).strict(),
  z
    .object({ ...base, type: z.literal("collection.renamed"), from: CollectionNameSchema, to: CollectionNameSchema })
    .strict(),
  z.object({ ...base, type: z.literal("collection.deleted"), collection: CollectionNameSchema }).strict(),
]);

export const ProcessEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("process.state"),
      state: ProcessStateSchema,
      pid: z.number().int().positive().nullable(),
      url: z.string().max(2048).nullable(),
    })
    .strict(),
  z.object({ ...base, type: z.literal("process.log"), line: z.string().max(2000) }).strict(),
]);

export const PerfectFrontEventSchema = z.union([
  ProjectEventSchema,
  CommentEventSchema,
  CollectionEventSchema,
  ProcessEventSchema,
]);

export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
export type CommentEvent = z.infer<typeof CommentEventSchema>;
export type CollectionEvent = z.infer<typeof CollectionEventSchema>;
export type ProcessEvent = z.infer<typeof ProcessEventSchema>;
export type PerfectFrontEvent = z.infer<typeof PerfectFrontEventSchema>;
