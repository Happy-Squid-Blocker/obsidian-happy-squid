/** The subset of Obsidian's `requestUrl` contract used by the account reads. */
export interface HttpRequestOptions {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}

/** The response fields the plugin reads. */
export interface HttpResponse {
  status: number;
  json: unknown;
  text: string;
}

export type HttpRequest = (options: HttpRequestOptions) => Promise<HttpResponse>;

const HTTP_SUCCESS_START = 200;
const HTTP_REDIRECTION_START = 300;

export function isSuccessfulResponse(response: HttpResponse): boolean {
  return response.status >= HTTP_SUCCESS_START && response.status < HTTP_REDIRECTION_START;
}
