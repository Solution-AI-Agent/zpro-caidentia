let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export function csrfHeaders() {
  return { "x-csrf-token": csrf };
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "x-csrf-token": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.message ?? "요청을 처리하지 못했습니다.",
    );
  return data as T;
}
export async function fileContent(file: File, base64: boolean) {
  if (file.size > 2 * 1024 * 1024)
    throw new Error("2 MB 이하의 파일을 사용하세요.");
  if (!base64) return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
