export type PlatformKind = "cliproxyapi" | "sub2api";

export interface PlatformConfig {
  id: PlatformKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

export interface UnifiedAccount {
  uid: string;
  platform: PlatformKind;
  platformName: string;
  accountId: string;
  manageKey: string;
  name: string;
  type: string;
  status: string;
  statusDetail?: string;
  email?: string;
  note?: string;
  priority?: number;
  updatedAt?: string;
  raw: unknown;
}

export interface PlatformUsageTrend {
  labels: string[];
  sub2apiValues: number[];
  cpaValues: number[];
}

export interface PlatformQuotaSummary {
  platform: PlatformKind;
  label: string;
  accountCount: number;
  measurableCount: number;
  averageRemainingPercent?: number;
  totalRemainingUsd?: number;
  totalEstimatedRemainingUsd?: number;
  totalEstimatedUsedUsd?: number;
  totalTransferredTokens?: number;
}

export interface PlatformFetchResult {
  platform: PlatformConfig;
  accounts: UnifiedAccount[];
  error?: string;
}

export interface AccountDetailResult {
  account: UnifiedAccount;
  profile?: unknown;
  stats?: unknown;
  models?: unknown;
  refreshedAt: string;
}
