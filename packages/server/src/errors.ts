export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export function apiError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } };
}
