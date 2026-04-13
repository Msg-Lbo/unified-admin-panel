import type { PlatformKind } from "./platform";

export type SortField =
  | "name"
  | "priority"
  | "totalQuota"
  | "usedQuota"
  | "remainingPercent"
  | "updatedAt";

export type SortDirection = "asc" | "desc";

export interface PlatformSortRule {
  field: SortField;
  direction: SortDirection;
}

export type PlatformSortSettings = Record<PlatformKind, PlatformSortRule>;
