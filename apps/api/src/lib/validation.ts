import type { Context } from "hono";
import type { z } from "zod";

export async function parseJson<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => ({}));
  return schema.parse(body);
}

export function parseQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(new URL(c.req.url).searchParams.entries()));
}
