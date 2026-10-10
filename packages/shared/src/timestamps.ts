import { z } from "zod";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Timestamp ISO-8601 UTC (sufijo Z) que además es una fecha real. */
export const TimestampSchema = z
  .string()
  .regex(ISO_RE, "Timestamp debe ser ISO-8601 UTC")
  .refine((v) => {
    const d = new Date(v);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 19) === v.slice(0, 19);
  }, "Timestamp no es una fecha válida");
export type Timestamp = z.infer<typeof TimestampSchema>;

export function nowTimestamp(date: Date = new Date()): Timestamp {
  return date.toISOString();
}
