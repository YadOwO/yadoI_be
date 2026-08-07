/**
 * 统一错误定义与错误响应。
 *
 * 响应结构遵循平台跨服务约定：{ code, message, details? }
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

/** 业务错误码 */
export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  Unauthorized: 'UNAUTHORIZED',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  Internal: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 可安全返回给客户端的错误状态码 */
export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 500;

/**
 * 业务异常。抛出后由全局 onError 统一转换为标准错误响应。
 */
export class AppError extends Error {
  readonly status: AppErrorStatus;
  readonly code: ErrorCodeValue;
  readonly details?: unknown;

  constructor(status: AppErrorStatus, code: ErrorCodeValue, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, ErrorCode.BadRequest, message, details);

export const unauthorized = (message = '未通过身份校验'): AppError =>
  new AppError(401, ErrorCode.Unauthorized, message);

export const notFound = (message = '资源不存在'): AppError =>
  new AppError(404, ErrorCode.NotFound, message);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(409, ErrorCode.Conflict, message, details);

interface IErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * 全局错误处理。
 *
 * 未预期的异常只向客户端返回通用信息，详细堆栈仅记录在服务端日志，
 * 避免泄露内部实现细节。
 */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    const body: IErrorBody = { code: err.code, message: err.message };
    if (err.details !== undefined) {
      body.details = err.details;
    }
    return c.json(body, err.status);
  }

  if (err instanceof HTTPException) {
    const body: IErrorBody = { code: ErrorCode.BadRequest, message: err.message };
    return c.json(body, err.status);
  }

  console.error('未处理的异常：', err);
  const body: IErrorBody = { code: ErrorCode.Internal, message: '服务内部错误' };
  return c.json(body, 500);
}
