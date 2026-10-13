import type { TaskKindInfo, TaskKindParam } from './types';

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  description?: string;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

/** Kiểu của một thuộc tính JSON Schema → kiểu ô nhập. */
function typeOf(s: JsonSchema): TaskKindParam['type'] {
  const alt = s.anyOf ?? s.oneOf;
  if (!s.type && alt?.length) return typeOf(alt.find((x) => x.type !== 'null') ?? alt[0]!);
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (t === 'string') return 'string';
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'array') {
    const it = s.items ? (Array.isArray(s.items.type) ? s.items.type[0] : s.items.type) : undefined;
    return it === 'number' || it === 'integer' ? 'number[]' : 'json';
  }
  return 'json';
}

/** Chuẩn hóa một kind từ backend (JSON Schema) hoặc dữ liệu mẫu (đã có `params`) để sinh form. */
export function normalizeKind(k: TaskKindInfo): TaskKindInfo & { params: TaskKindParam[] } {
  const concept = k.concept ?? (k.kind.split('.').pop() as TaskKindInfo['concept']);
  if (Array.isArray(k.params)) return { ...k, concept, params: k.params };
  const schema = (k.paramsSchema ?? {}) as JsonSchema;
  const required = new Set(schema.required ?? []);
  const params = Object.entries(schema.properties ?? {}).map(([name, p]) => ({
    name,
    type: typeOf(p),
    // có mặc định thì không bắt buộc nhập
    required: required.has(name) && p.default === undefined,
    default: p.default,
    hint: p.description,
  }));
  return { ...k, concept, params };
}

/** Phản hồi có thể là mảng hoặc object kind → info; luôn trả mảng đã chuẩn hóa. */
export function normalizeKinds(data: unknown): (TaskKindInfo & { params: TaskKindParam[] })[] {
  const list = Array.isArray(data)
    ? (data as TaskKindInfo[])
    : data && typeof data === 'object'
      ? Object.entries(data as Record<string, Partial<TaskKindInfo>>).map(([kind, v]) => ({ kind, tenant: v.tenant ?? kind.split('.')[0]!, ...v }) as TaskKindInfo)
      : [];
  return list.filter((k) => k && typeof k.kind === 'string').map(normalizeKind);
}
