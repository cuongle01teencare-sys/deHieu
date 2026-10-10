/**
 * Entry của worker thread. Không DI, không store — chỉ TaskRuntime + catalog.
 */
import { parentPort } from 'node:worker_threads';
import { ParentPortTaskEndpoint } from './parent-port.task-endpoint.js';
import { TaskRuntime } from '../runtime/task-runtime.js';
import { TASK_FACTORIES } from '../runtime/task-catalog.js';

if (!parentPort)
  throw new Error('[task.worker] phải chạy trong worker_threads');

new TaskRuntime(new ParentPortTaskEndpoint(parentPort), TASK_FACTORIES);
