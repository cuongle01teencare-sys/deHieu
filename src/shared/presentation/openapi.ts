import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/** zod → JSON Schema cho OpenAPI. Schema zod vẫn là nguồn duy nhất cho validate lẫn tài liệu. */
export const toOpenApiSchema = (schema: z.ZodType): SchemaObject => {
  const json: Record<string, unknown> = {
    ...z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
  };
  delete json.$schema;
  return json;
};

/** Body của request lấy từ schema zod, kèm ví dụ (tùy chọn). */
export const ApiZodBody = (
  schema: z.ZodType,
  examples?: Record<string, { summary?: string; value: unknown }>,
) =>
  ApiBody({
    schema: toOpenApiSchema(schema),
    ...(examples ? { examples } : {}),
  });

/** Query string lấy từ schema zod dạng object: mỗi field thành một tham số. */
export const ApiZodQuery = (schema: z.ZodObject) => {
  const json = toOpenApiSchema(schema) as {
    properties?: Record<string, SchemaObject>;
    required?: string[];
  };
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, prop]) =>
      ApiQuery({
        name,
        required: json.required?.includes(name) ?? false,
        schema: prop,
      }),
    ),
  );
};
