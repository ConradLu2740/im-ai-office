/** 错误消息提取：Error 取 message（替代 String(e).replace("Error: ", "")——
 *  后者依赖 toString() 前缀恰为 "Error: "，一旦错误类设置了自己的 name（如 ValueError）
 *  就会把 "ValueError: x" 削成 "Valueinvalid x"；且对消息体内含 "Error: " 的会误削）。 */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
