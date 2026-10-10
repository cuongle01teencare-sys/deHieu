import z from 'zod';
import { toSlug } from '../to-slug.js';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .overwrite(toSlug) // chuẩn hoá, kiểu vẫn là ZodString
  .regex(SLUG_PATTERN);
