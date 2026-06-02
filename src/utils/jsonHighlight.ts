function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function highlightJsonPrimitive(value: unknown): string {
  if (value === null) {
    return '<span class="json-hl__null">null</span>';
  }
  if (typeof value === "boolean") {
    return `<span class="json-hl__boolean">${value}</span>`;
  }
  if (typeof value === "number") {
    return `<span class="json-hl__number">${value}</span>`;
  }
  if (typeof value === "string") {
    return `<span class="json-hl__string">"${escapeHtml(value)}"</span>`;
  }
  return `<span>${escapeHtml(String(value))}</span>`;
}

export function highlightJsonKey(key: string): string {
  return `<span class="json-hl__key">"${escapeHtml(key)}"</span>`;
}

export function highlightJson(json: string): string {
  const escaped = escapeHtml(json);
  return escaped.replace(
    /("(\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match) => {
      if (match.endsWith(":")) {
        return `<span class="json-hl__key">${match}</span>`;
      }
      if (match.startsWith('"')) {
        return `<span class="json-hl__string">${match}</span>`;
      }
      if (match === "true" || match === "false") {
        return `<span class="json-hl__boolean">${match}</span>`;
      }
      if (match === "null") {
        return `<span class="json-hl__null">${match}</span>`;
      }
      return `<span class="json-hl__number">${match}</span>`;
    }
  );
}

export interface JsonFoldLine {
  path: string;
  depth: number;
  html: string;
  foldable: boolean;
}

function isCollection(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

function collectionEntries(value: Record<string, unknown> | unknown[]): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  return Object.entries(value);
}

function buildPropertyLines(
  key: string,
  value: unknown,
  path: string,
  depth: number,
  collapsedPaths: Set<string>,
  trailingComma: boolean,
  isArrayItem: boolean
): JsonFoldLine[] {
  const comma = trailingComma ? "," : "";
  const keyPrefix = isArrayItem ? "" : `${highlightJsonKey(key)}: `;

  if (!isCollection(value)) {
    return [
      {
        path,
        depth,
        foldable: false,
        html: `${keyPrefix}${highlightJsonPrimitive(value)}${comma}`
      }
    ];
  }

  const isArray = Array.isArray(value);
  const isCollapsed = collapsedPaths.has(path);
  const entries = collectionEntries(value);
  const openToken = isArray ? "[" : "{";
  const closeToken = isArray ? "]" : "}";
  const previewToken = isCollapsed ? (isArray ? "[ … ]" : "{ … }") : openToken;
  const lines: JsonFoldLine[] = [
    {
      path,
      depth,
      foldable: entries.length > 0,
      html: `${keyPrefix}${previewToken}${isCollapsed ? comma : ""}`
    }
  ];

  if (isCollapsed || entries.length === 0) {
    return lines;
  }

  entries.forEach(([childKey, childValue], index) => {
    const childPath = isArray ? `${path}[${childKey}]` : `${path}.${childKey}`;
    lines.push(
      ...buildPropertyLines(
        childKey,
        childValue,
        childPath,
        depth + 1,
        collapsedPaths,
        index < entries.length - 1,
        isArray
      )
    );
  });
  lines.push({
    path: `${path}__close`,
    depth,
    foldable: false,
    html: `${closeToken}${comma}`
  });
  return lines;
}

export function buildJsonFoldLines(
  value: unknown,
  collapsedPaths: Set<string>,
  path = "$"
): JsonFoldLine[] {
  if (!isCollection(value)) {
    return [
      {
        path,
        depth: 0,
        foldable: false,
        html: highlightJsonPrimitive(value)
      }
    ];
  }

  const isArray = Array.isArray(value);
  const isCollapsed = collapsedPaths.has(path);
  const entries = collectionEntries(value);
  const openToken = isArray ? "[" : "{";
  const closeToken = isArray ? "]" : "}";
  const previewToken = isCollapsed ? (isArray ? "[ … ]" : "{ … }") : openToken;
  const lines: JsonFoldLine[] = [
    {
      path,
      depth: 0,
      foldable: entries.length > 0,
      html: previewToken
    }
  ];

  if (isCollapsed || entries.length === 0) {
    return lines;
  }

  entries.forEach(([key, childValue], index) => {
    const childPath = isArray ? `${path}[${key}]` : `${path}.${key}`;
    lines.push(
      ...buildPropertyLines(
        key,
        childValue,
        childPath,
        1,
        collapsedPaths,
        index < entries.length - 1,
        isArray
      )
    );
  });
  lines.push({
    path: `${path}__close`,
    depth: 0,
    foldable: false,
    html: closeToken
  });
  return lines;
}

export function collectFoldablePaths(
  value: unknown,
  paths: Set<string>,
  path = "$"
): void {
  if (!isCollection(value)) {
    return;
  }
  const entries = collectionEntries(value);
  if (entries.length > 0) {
    paths.add(path);
  }
  const isArray = Array.isArray(value);
  for (const [key, child] of entries) {
    const childPath = isArray ? `${path}[${key}]` : `${path}.${key}`;
    collectFoldablePaths(child, paths, childPath);
  }
}
