import "server-only";

import type { SearchCategory, SearchProvider } from "@/infrastructure/search/contracts";
import { PostgresSearchProvider } from "@/infrastructure/search/postgres-search.server";

let provider: SearchProvider | undefined;

export function getSearchProvider(): SearchProvider {
  provider ??= new PostgresSearchProvider();
  return provider;
}

export async function searchContent(input: {
  query: string;
  category?: SearchCategory;
  limit?: number;
}) {
  const query = input.query.trim().slice(0, 80);
  const category = input.category ?? "all";
  if (query.length < 2) return { query, topics: [], members: [], nodes: [] };
  const results = await getSearchProvider().search({
    query,
    category,
    limit: input.limit ?? 20,
  });
  return { query, ...results };
}
