import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/** Error body from contracts.md: `{"error": "<code>", "message": "<text>"}`. */
export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ error: code, message }, status);
  }
}

export const badRequest = (message: string, code = 'bad_request') => new ApiError(400, code, message);
export const notFound = (message: string, code = 'not_found') => new ApiError(404, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

const CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  503: 'unavailable',
};

/** Normalises every error (Nest built-ins, Fastify parse errors, unexpected exceptions) to the contract shape. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('ApiErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let body: { error: string; message: string };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse() as string | { error?: unknown; message?: unknown };
      if (typeof res === 'object' && typeof res.error === 'string' && typeof res.message === 'string' && exception instanceof ApiError) {
        body = { error: res.error, message: res.message };
      } else {
        const message = typeof res === 'string' ? res : Array.isArray(res.message) ? res.message.join('; ') : String(res.message ?? exception.message);
        body = { error: CODES[status] ?? 'error', message };
      }
    } else if (isFastifyClientError(exception)) {
      status = exception.statusCode;
      body = { error: CODES[status] ?? 'bad_request', message: exception.message };
    } else {
      this.log.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
      body = { error: 'internal', message: 'Internal server error' };
    }
    void reply.status(status).send(body);
  }
}

function isFastifyClientError(e: unknown): e is { statusCode: number; message: string } {
  const code = (e as { statusCode?: unknown })?.statusCode;
  return typeof code === 'number' && code >= 400 && code < 500;
}
