/**
 * 注册请求的契约常量——校验装饰器与 Swagger `pattern` 共用的**唯一定义处**。
 *
 * 单独成文件的理由与 `common/pagination/cursor.ts`、`pagination.constants.ts` 相同：
 * 这两份正则会经 `@ApiProperty` 的 `pattern` 选项进入 openapi.json 与前端契约，
 * 放在 DTO 里会让文档生成测试反向 import DTO；两侧都只依赖这里，改一处不会漂移。
 */

/** 用户名字符集：仅字母数字下划线连字符 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * 密码复杂度：需同时含大写、小写、数字与**至少一个非字母数字字符**。
 *
 * 「特殊字符」按 `[^a-zA-Z0-9]` 判定而不是符号白名单：`_`/`-`/`+`/`~`/空格 等
 * 都算特殊字符。此前白名单只认 `!@#$%^&*(),.?":{}|<>`，`Str0ng-Pass` 这类密码会被
 * 400 且报错文案说「需包含特殊字符」，用户明明已经带了——白名单并非有意为之的安全
 * 收紧，只是把常见符号漏在了外面。
 */
export const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])/;
