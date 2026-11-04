// 06 §6 的 mirrorToken 走查询参数（功能必需）；访问日志不能落原文（A 复审 P1-1）。
// 只脱敏 token= / mirrorToken=，其余查询参数保留，便于排障。
const SECRET_QUERY = /([?&](?:token|mirrorToken)=)[^&#]*/gi;

export function redactUrl(url: string): string {
  return url.replace(SECRET_QUERY, '$1***');
}

type RequestLike = {
  method?: string;
  url?: string;
  headers: { host?: string | undefined };
  socket?: { remoteAddress?: string | undefined; remotePort?: number | undefined };
};

export function requestSerializer(req: RequestLike): Record<string, unknown> {
  return {
    method: req.method,
    url: redactUrl(req.url ?? ''),
    host: req.headers.host,
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort,
  };
}
