export interface GenericError {
  details: string[];
  message: string;
}

export const createGenericError = (
  message: string,
  error?: Error | string[] | unknown
): GenericError => {
  let details: string[] = [];
  if (error) {
    if (Array.isArray(error)) {
      details = error;
    } else if (error instanceof Error) {
      details = [error.message];
    } else {
      details = [String(error)];
    }
  }

  return {
    message,
    details,
  };
};

export type Result<T> =
  | {
      error: null;
      data: T;
    }
  | {
      error: GenericError;
      data: null;
    };
