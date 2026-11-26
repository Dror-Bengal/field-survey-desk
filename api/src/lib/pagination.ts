import { z } from 'zod';

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type PageQueryInput = z.infer<typeof PageQuery>;

export function pageSkip({ page, limit }: PageQueryInput): number {
  return (page - 1) * limit;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export function pageMeta(q: PageQueryInput, total: number): PageMeta {
  return {
    page: q.page,
    limit: q.limit,
    total,
    pages: Math.max(1, Math.ceil(total / q.limit)),
  };
}
