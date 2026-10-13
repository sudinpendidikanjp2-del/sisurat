export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Silakan masuk terlebih dahulu') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Anda tidak memiliki izin untuk tindakan ini') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Data tidak ditemukan') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const invalidState = (message: string) => new AppError(409, 'INVALID_STATE', message);
