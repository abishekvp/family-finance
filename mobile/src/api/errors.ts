import { AxiosError } from "axios";

export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
  }
  return fallback;
}
