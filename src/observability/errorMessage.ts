export function toErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const objectError = error as Record<string, unknown>;

    if (typeof objectError.message === "string" && objectError.message.trim().length > 0) {
      return objectError.message;
    }

    const errors = objectError.errors;
    if (Array.isArray(errors)) {
      const first = errors.find(item => item && typeof item === "object") as
        | Record<string, unknown>
        | undefined;
      if (first && typeof first.message === "string" && first.message.trim().length > 0) {
        return first.message;
      }
    }
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

