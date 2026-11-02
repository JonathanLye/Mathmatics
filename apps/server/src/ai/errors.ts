// 适配器只抛出原因码，不抛出原始错误信息或响应体：它们可能含学生文本或密钥，不能进入 model_calls。
export class AdapterError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'AdapterError';
    this.reason = reason;
  }
}
