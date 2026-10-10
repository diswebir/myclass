export interface PageParams {
  page: number;
  pageSize: number;
}

export function parsePage(query: Record<string, unknown>, defaultSize = 20): PageParams {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(query.page ?? '1'), 10) || 1));
  const size = Number.parseInt(String(query.size ?? defaultSize), 10) || defaultSize;
  return { page, pageSize: Math.max(5, Math.min(100, size)) };
}

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function pageInfo(params: PageParams, total: number): PageInfo {
  return { ...params, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}
