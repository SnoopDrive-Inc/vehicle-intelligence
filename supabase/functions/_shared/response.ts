import { corsHeaders } from './cors.ts';

export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
    retry_after?: number;
  };
  meta?: {
    request_id: string;
    tokens_used?: number;
    tokens_remaining?: number;
  };
}

export function successResponse<T>(
  data: T,
  meta?: { tokens_remaining?: number }
): Response {
  const response: ApiResponse<T> = {
    data,
    meta: {
      request_id: crypto.randomUUID(),
      tokens_used: 1,
      ...meta,
    },
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number = 400,
  retryAfter?: number
): Response {
  const response: ApiResponse = {
    error: {
      code,
      message,
      ...(retryAfter && { retry_after: retryAfter }),
    },
  };

  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type': 'application/json',
  };

  if (retryAfter) {
    headers['Retry-After'] = retryAfter.toString();
  }

  return new Response(JSON.stringify(response), { status, headers });
}

export function notFoundResponse(message: string = 'Resource not found'): Response {
  return errorResponse('not_found', message, 404);
}

export function unauthorizedResponse(message: string = 'Unauthorized'): Response {
  return errorResponse('unauthorized', message, 401);
}

export function rateLimitResponse(retryAfter: number): Response {
  return errorResponse(
    'rate_limit_exceeded',
    `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
    429,
    retryAfter
  );
}

export function internalErrorResponse(message: string = 'Internal server error'): Response {
  return errorResponse('internal_error', message, 500);
}
