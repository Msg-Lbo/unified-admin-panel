export interface TokenCostEstimateInput {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface ModelTokenPricing {
  inputPerTokenUsd: number;
  outputPerTokenUsd: number;
  cacheReadPerTokenUsd: number;
  cacheCreationPerTokenUsd?: number;
}

const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";

// Rates are aligned with current OpenAI/Codex pricing used by common relay implementations.
const MODEL_TOKEN_PRICING: Record<string, ModelTokenPricing> = {
  "gpt-5-codex": {
    inputPerTokenUsd: 1.25e-6,
    outputPerTokenUsd: 1e-5,
    cacheReadPerTokenUsd: 1.25e-7
  },
  "gpt-5.1-codex": {
    inputPerTokenUsd: 1.25e-6,
    outputPerTokenUsd: 1e-5,
    cacheReadPerTokenUsd: 1.25e-7
  },
  "gpt-5.1-codex-max": {
    inputPerTokenUsd: 1.25e-6,
    outputPerTokenUsd: 1e-5,
    cacheReadPerTokenUsd: 1.25e-7
  },
  "gpt-5.1-codex-mini": {
    inputPerTokenUsd: 2.5e-7,
    outputPerTokenUsd: 2e-6,
    cacheReadPerTokenUsd: 2.5e-8
  },
  "gpt-5.2-codex": {
    inputPerTokenUsd: 1.75e-6,
    outputPerTokenUsd: 1.4e-5,
    cacheReadPerTokenUsd: 1.75e-7
  },
  "gpt-5.3-codex": {
    inputPerTokenUsd: 1.75e-6,
    outputPerTokenUsd: 1.4e-5,
    cacheReadPerTokenUsd: 1.75e-7
  },
  "gpt-5.4": {
    inputPerTokenUsd: 2.5e-6,
    outputPerTokenUsd: 1.5e-5,
    cacheReadPerTokenUsd: 2.5e-7
  },
  "gpt-5.4-mini": {
    inputPerTokenUsd: 4e-7,
    outputPerTokenUsd: 2e-6,
    cacheReadPerTokenUsd: 4e-8
  },
  "gpt-5.4-nano": {
    inputPerTokenUsd: 1e-7,
    outputPerTokenUsd: 4e-7,
    cacheReadPerTokenUsd: 1e-8
  }
};

function toNonNegativeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return 0;
}

function normalizeModelName(model?: string): string {
  if (typeof model !== "string") {
    return "";
  }
  return model.trim().toLowerCase();
}

function resolvePricingByModel(model?: string): ModelTokenPricing | undefined {
  const normalized = normalizeModelName(model);
  if (!normalized) {
    return undefined;
  }

  const exact = MODEL_TOKEN_PRICING[normalized];
  if (exact) {
    return exact;
  }

  const dateSuffixTrimmed = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const withoutDate = MODEL_TOKEN_PRICING[dateSuffixTrimmed];
  if (withoutDate) {
    return withoutDate;
  }

  for (const [modelPrefix, pricing] of Object.entries(MODEL_TOKEN_PRICING)) {
    if (normalized.startsWith(modelPrefix)) {
      return pricing;
    }
  }

  if (normalized.includes("codex")) {
    return MODEL_TOKEN_PRICING[DEFAULT_CODEX_MODEL];
  }

  return undefined;
}

export function estimateTokenUsageCostUsd(
  input: TokenCostEstimateInput
): number | undefined {
  const pricing = resolvePricingByModel(input.model);
  if (!pricing) {
    return undefined;
  }

  const inputTokens = toNonNegativeNumber(input.inputTokens);
  const outputTokens = toNonNegativeNumber(input.outputTokens);
  const cacheReadTokens = toNonNegativeNumber(input.cacheReadTokens);
  const cacheCreationTokens = toNonNegativeNumber(input.cacheCreationTokens);

  const cost =
    inputTokens * pricing.inputPerTokenUsd +
    outputTokens * pricing.outputPerTokenUsd +
    cacheReadTokens * pricing.cacheReadPerTokenUsd +
    cacheCreationTokens *
      (pricing.cacheCreationPerTokenUsd ?? pricing.inputPerTokenUsd);

  if (!Number.isFinite(cost) || cost < 0) {
    return undefined;
  }
  return cost;
}

