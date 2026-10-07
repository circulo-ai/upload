"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import type { FileRouter, FileRouterEndpoint } from "./router";
import type { PresignedResponse, UploadResponse } from "./routes/handler";
import type {
  FileRouterCompletionFile,
  FileRouterCompletionResponse,
} from "./routes/router-handler";

export interface UploadClientOptions {
  url?: string | URL;
  fetcher?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit);
}

/** Error returned by a client-side upload request. */
export class UploadClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "UploadClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface UploadFilesOptions<TInput = unknown> {
  input?: TInput;
  context?: string;
  headers?: HeadersInit | (() => HeadersInit);
  signal?: AbortSignal;
  onUploadBegin?: (fileName: string) => void;
  onUploadProgress?: (progress: number, file: File) => void;
}

export interface UploadHelpers<TRouter extends FileRouter> {
  uploadFiles: <TEndpoint extends FileRouterEndpoint<TRouter>>(
    endpoint: TEndpoint | ((router: TRouter) => TEndpoint),
    files: File[] | FileList,
    options?: UploadFilesOptions,
  ) => Promise<FileRouterCompletionFile[]>;
  useFileUpload: <TEndpoint extends FileRouterEndpoint<TRouter>>(
    endpoint: TEndpoint | ((router: TRouter) => TEndpoint),
    options?: UseFileUploadOptions,
  ) => UseFileUploadResult;
  getRouteConfig: <TEndpoint extends FileRouterEndpoint<TRouter>>(
    endpoint: TEndpoint | ((router: TRouter) => TEndpoint),
  ) => TRouter[TEndpoint]["config"];
}

export interface UseFileUploadOptions extends UploadFilesOptions {
  onUploadComplete?: (files: FileRouterCompletionFile[]) => void;
  onUploadError?: (error: Error) => void;
}

export interface UseFileUploadResult {
  startUpload: (
    files: File[] | FileList,
    input?: unknown,
  ) => Promise<FileRouterCompletionFile[]>;
  isUploading: boolean;
  progress: number;
  error: Error | null;
  reset: () => void;
}

export interface UploadButtonProps<TRouter extends FileRouter> extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onError"
> {
  endpoint:
    | FileRouterEndpoint<TRouter>
    | ((router: TRouter) => FileRouterEndpoint<TRouter>);
  input?: unknown;
  context?: string;
  headers?: HeadersInit | (() => HeadersInit);
  signal?: AbortSignal;
  onClientUploadComplete?: (files: FileRouterCompletionFile[]) => void;
  onUploadError?: (error: Error) => void;
  onUploadProgress?: (progress: number) => void;
  onUploadBegin?: (fileName: string) => void;
  children?: ReactNode;
}

export interface UploadDropzoneProps<TRouter extends FileRouter> extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "onDrop"
> {
  endpoint:
    | FileRouterEndpoint<TRouter>
    | ((router: TRouter) => FileRouterEndpoint<TRouter>);
  input?: unknown;
  onClientUploadComplete?: (files: FileRouterCompletionFile[]) => void;
  onUploadError?: (error: Error) => void;
  onUploadProgress?: (progress: number) => void;
  onDrop?: (files: File[]) => void;
  onUploadBegin?: (fileName: string) => void;
  context?: string;
  headers?: HeadersInit | (() => HeadersInit);
  signal?: AbortSignal;
  children?: ReactNode;
}

function resolveEndpoint<TRouter extends FileRouter>(
  endpoint:
    | FileRouterEndpoint<TRouter>
    | ((router: TRouter) => FileRouterEndpoint<TRouter>),
  router: TRouter,
): FileRouterEndpoint<TRouter> {
  return typeof endpoint === "function" ? endpoint(router) : endpoint;
}

function joinUrl(base: string | URL, path: string): string {
  const baseValue = String(base).replace(/\/$/, "");
  if (baseValue.startsWith("/"))
    return `${baseValue}/${path.replace(/^\//, "")}`;
  return new URL(path.replace(/^\//, ""), `${baseValue}/`).toString();
}

function mergeHeaders(
  ...sources: Array<HeadersInit | (() => HeadersInit) | undefined>
): Headers {
  const headers = new Headers();
  for (const source of sources) {
    if (typeof source === "function") {
      for (const [key, value] of new Headers(source()).entries())
        headers.set(key, value);
    } else if (source) {
      for (const [key, value] of new Headers(source).entries())
        headers.set(key, value);
    }
  }
  return headers;
}

async function parseJson<T>(response: Response): Promise<T> {
  let body: (T & { error?: unknown; code?: string; details?: unknown }) | null;
  try {
    body = (await response.json()) as T & {
      error?: unknown;
      code?: string;
      details?: unknown;
    };
  } catch {
    throw new UploadClientError(
      `Upload request failed (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      typeof body?.error === "string"
        ? body.error
        : `Upload request failed (${response.status})`;
    throw new UploadClientError(
      message,
      response.status,
      body?.code,
      body?.details,
    );
  }
  return body;
}

function responseToUpload(
  file: File,
  presigned: PresignedResponse,
  context?: string,
): UploadResponse {
  const now = new Date();
  return {
    id: presigned.fileInfo.key,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    key: presigned.fileInfo.key,
    path: presigned.fileInfo.path,
    url: presigned.downloadUrl || presigned.fileInfo.path,
    downloadUrl: presigned.downloadUrl,
    uploadedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    context: context ?? "",
  };
}

function uploadWithProgress(
  url: string,
  body: BodyInit,
  headers: Headers,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void,
  fetcher: typeof fetch,
): Promise<Response> {
  if (
    typeof XMLHttpRequest === "undefined" ||
    body instanceof FormData === false
  ) {
    return fetcher(url, { method: "POST", body, headers, signal });
  }

  return new Promise<Response>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    headers.forEach((value, key) => request.setRequestHeader(key, value));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.onload = () =>
      resolve(new Response(request.responseText, { status: request.status }));
    request.onerror = () => reject(new Error("Network error while uploading"));
    request.onabort = () =>
      reject(new DOMException("Upload aborted", "AbortError"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}

export function createUploadHelpers<TRouter extends FileRouter>(
  router: TRouter,
  clientOptions: UploadClientOptions = {},
): UploadHelpers<TRouter> {
  const baseUrl = clientOptions.url ?? "/api/files";
  const fetcher = clientOptions.fetcher ?? fetch;

  const uploadFiles = async <TEndpoint extends FileRouterEndpoint<TRouter>>(
    endpointArg: TEndpoint | ((router: TRouter) => TEndpoint),
    inputFiles: File[] | FileList,
    options: UploadFilesOptions = {},
  ): Promise<FileRouterCompletionFile[]> => {
    const endpoint = resolveEndpoint(endpointArg, router);
    const files = Array.from(inputFiles);
    if (files.length === 0) return [];

    const headers = mergeHeaders(clientOptions.headers, options.headers);
    const presignedResponse = await parseJson<{
      files: PresignedResponse[];
      directUploadSupported: boolean;
    }>(
      await fetcher(
        `${joinUrl(baseUrl, "presigned/batch")}?endpoint=${encodeURIComponent(endpoint)}${options.context ? `&type=${encodeURIComponent(options.context)}` : ""}`,
        {
          method: "POST",
          headers: mergeHeaders(headers, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            files: files.map((file) => ({
              fileName: file.name,
              contentType: file.type || "application/octet-stream",
              fileSize: file.size,
            })),
            input: options.input,
          }),
          signal: options.signal,
        },
      ),
    );

    let uploaded: UploadResponse[];
    if (presignedResponse.directUploadSupported) {
      if (presignedResponse.files.length !== files.length) {
        throw new UploadClientError(
          "The server returned an incomplete presigned upload plan",
          502,
          "INVALID_RESPONSE",
        );
      }
      uploaded = [];
      for (const [index, presigned] of presignedResponse.files.entries()) {
        const file = files[index];
        if (!file) continue;
        options.onUploadBegin?.(file.name);
        const response = await fetcher(presigned.presignedUrl, {
          method: "PUT",
          headers: mergeHeaders(presigned.uploadHeaders),
          body: file,
          signal: options.signal,
        });
        if (!response.ok)
          throw new Error(
            `Upload failed for ${file.name} (${response.status})`,
          );
        options.onUploadProgress?.(
          Math.round(((index + 1) / files.length) * 100),
          file,
        );
        uploaded.push(responseToUpload(file, presigned, options.context));
      }
    } else {
      const formData = new FormData();
      for (const file of files) formData.append("file", file, file.name);
      if (options.context) formData.append("context", options.context);
      if (options.input !== undefined)
        formData.append("input", JSON.stringify(options.input));
      const response = await uploadWithProgress(
        `${joinUrl(baseUrl, "upload")}?endpoint=${encodeURIComponent(endpoint)}`,
        formData,
        headers,
        options.signal,
        (progress) => options.onUploadProgress?.(progress, files[0]!),
        fetcher,
      );
      const result = await parseJson<
        FileRouterCompletionResponse | UploadResponse
      >(response);
      uploaded = "files" in result ? result.files : [result];
    }

    if (presignedResponse.directUploadSupported) {
      const completion = await parseJson<FileRouterCompletionResponse>(
        await fetcher(
          `${joinUrl(baseUrl, "complete")}?endpoint=${encodeURIComponent(endpoint)}`,
          {
            method: "POST",
            headers: mergeHeaders(headers, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({ files: uploaded, input: options.input }),
            signal: options.signal,
          },
        ),
      );
      return completion.files;
    }

    return uploaded;
  };

  const useFileUpload = <TEndpoint extends FileRouterEndpoint<TRouter>>(
    endpointArg: TEndpoint | ((router: TRouter) => TEndpoint),
    options: UseFileUploadOptions = {},
  ): UseFileUploadResult => {
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<Error | null>(null);
    const mounted = useRef(true);

    useEffect(() => {
      return () => {
        mounted.current = false;
      };
    }, []);

    const reset = useCallback(() => {
      setProgress(0);
      setError(null);
    }, []);

    const startUpload = useCallback(
      async (files: File[] | FileList, input?: unknown) => {
        setIsUploading(true);
        setError(null);
        try {
          const result = await uploadFiles(endpointArg, files, {
            ...options,
            input,
            onUploadBegin: options.onUploadBegin,
            onUploadProgress: (value, file) => {
              if (mounted.current) setProgress(value);
              options.onUploadProgress?.(value, file);
            },
          });
          options.onUploadComplete?.(result);
          return result;
        } catch (cause) {
          const uploadError =
            cause instanceof Error ? cause : new Error("Upload failed");
          if (mounted.current) setError(uploadError);
          options.onUploadError?.(uploadError);
          throw uploadError;
        } finally {
          if (mounted.current) setIsUploading(false);
        }
      },
      [endpointArg, options, uploadFiles],
    );

    return { startUpload, isUploading, progress, error, reset };
  };

  const getRouteConfig = <TEndpoint extends FileRouterEndpoint<TRouter>>(
    endpointArg: TEndpoint | ((router: TRouter) => TEndpoint),
  ) => {
    const endpoint = resolveEndpoint(endpointArg, router);
    const route = router[endpoint];
    if (!Object.hasOwn(router, endpoint) || !route)
      throw new UploadClientError(
        "Upload endpoint is not configured",
        404,
        "UNKNOWN_ENDPOINT",
      );
    return route.config;
  };

  return { uploadFiles, useFileUpload, getRouteConfig };
}

export function generateUploadButton<TRouter extends FileRouter>(
  router: TRouter,
  options: UploadClientOptions = {},
) {
  return function UploadButton({
    endpoint,
    input,
    context,
    headers,
    signal,
    onClientUploadComplete,
    onUploadError,
    onUploadProgress,
    onUploadBegin,
    children = "Choose file(s)",
    disabled,
    ...buttonProps
  }: UploadButtonProps<TRouter>) {
    const inputRef = useRef<HTMLInputElement>(null);
    const { uploadFiles } = useMemo(
      () => createUploadHelpers(router, options),
      [router, options],
    );
    const [isUploading, setIsUploading] = useState(false);

    const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files;
      if (!files?.length) return;
      setIsUploading(true);
      try {
        const result = await uploadFiles(endpoint, files, {
          input,
          context,
          headers,
          signal,
          onUploadBegin,
          onUploadProgress: (value) => onUploadProgress?.(value),
        });
        onClientUploadComplete?.(result);
      } catch (cause) {
        onUploadError?.(
          cause instanceof Error ? cause : new Error("Upload failed"),
        );
      } finally {
        setIsUploading(false);
        event.currentTarget.value = "";
      }
    };

    return (
      <>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={selectFiles}
        />
        <button
          {...buttonProps}
          type="button"
          disabled={disabled || isUploading}
          onClick={() => inputRef.current?.click()}
          aria-busy={isUploading}
        >
          {isUploading ? "Uploading…" : children}
        </button>
      </>
    );
  };
}

export function generateUploadDropzone<TRouter extends FileRouter>(
  router: TRouter,
  options: UploadClientOptions = {},
) {
  return function UploadDropzone({
    endpoint,
    input,
    context,
    headers,
    signal,
    onClientUploadComplete,
    onUploadError,
    onUploadProgress,
    onUploadBegin,
    onDrop,
    children = "Drop files here or click to browse",
    disabled,
    ...inputProps
  }: UploadDropzoneProps<TRouter>) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const { uploadFiles } = useMemo(
      () => createUploadHelpers(router, options),
      [router, options],
    );

    const upload = async (files: File[]) => {
      if (!files.length) return;
      onDrop?.(files);
      setIsUploading(true);
      try {
        const result = await uploadFiles(endpoint, files, {
          input,
          context,
          headers,
          signal,
          onUploadBegin,
          onUploadProgress: (value) => onUploadProgress?.(value),
        });
        onClientUploadComplete?.(result);
      } catch (cause) {
        onUploadError?.(
          cause instanceof Error ? cause : new Error("Upload failed"),
        );
      } finally {
        setIsUploading(false);
      }
    };

    const onChange = (event: ChangeEvent<HTMLInputElement>) => {
      void upload(Array.from(event.currentTarget.files ?? []));
      event.currentTarget.value = "";
    };
    const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(true);
    };
    const onDragLeave = () => setIsDragging(false);
    const onDropFiles = (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      void upload(Array.from(event.dataTransfer.files));
    };

    return (
      <label
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDropFiles}
        aria-busy={isUploading}
        data-dragging={isDragging || undefined}
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 140,
          padding: 24,
          border: "1px dashed currentColor",
          borderRadius: 12,
          cursor: disabled || isUploading ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <input
          ref={inputRef}
          {...inputProps}
          type="file"
          multiple
          hidden
          disabled={disabled || isUploading}
          onChange={onChange}
        />
        <span>{isUploading ? "Uploading…" : children}</span>
      </label>
    );
  };
}

export function generateUploadComponents<TRouter extends FileRouter>(
  router: TRouter,
  options: UploadClientOptions = {},
) {
  return {
    UploadButton: generateUploadButton(router, options),
    UploadDropzone: generateUploadDropzone(router, options),
  };
}
