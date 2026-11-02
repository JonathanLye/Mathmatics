import type { FastifyError, FastifyInstance } from 'fastify';

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly detail?: unknown;

  constructor(code: string, statusCode: number, message: string, detail?: unknown, cause?: unknown) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
}

export function errorBody(code: string, message: string, detail?: unknown): ErrorBody {
  return detail === undefined ? { error: { code, message } } : { error: { code, message, detail } };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, statusCode: error.statusCode }, error.message);
      void reply.status(error.statusCode).send(errorBody(error.code, error.message, error.detail));
      return;
    }

    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    request.log.error({ err: error }, 'unhandled request error');
    void reply
      .status(statusCode)
      .send(
        statusCode >= 500
          ? errorBody('INTERNAL', '出了点问题，你的内容已保存')
          : errorBody('BAD_REQUEST', error.message),
      );
  });
}
