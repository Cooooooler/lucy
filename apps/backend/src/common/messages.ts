/**
 * 用户可读的响应文案集中定义（错误侧）。
 *
 * 成功侧文案由各控制器的 `@SuccessMessage` 直接声明（离端点近、随业务改动一起评审），
 * 这里只放错误侧的共享映射：HTTP 状态兜底、框架英文默认串归一、校验约束中文模板、
 * 请求字段中文名。前端对失败响应不做自动展示，调用方经 `errorMessageOf` 取后端原文案。
 */

/** 按 HTTP 状态的中文兜底：过滤器在 message 缺失或为框架英文默认串时使用 */
export const HTTP_STATUS_MESSAGES: Record<number, string> = {
  400: '请求参数有误',
  401: '未登录或登录已过期',
  403: '无权限访问',
  404: '请求的资源不存在',
  405: '不支持的请求方法',
  409: '请求与当前状态冲突',
  413: '请求内容过大',
  415: '不支持的文件类型',
  422: '请求内容无法处理',
  429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误',
  503: '服务暂时不可用，请稍后重试',
};

/**
 * 需归一的框架英文默认串：Nest/http-exception 的默认 message、passport 的
 * `Unauthorized`、throttler 的 `Too Many Requests` 等。出现即按 HTTP 状态
 * 换成上面的中文，避免用户看到 `Unauthorized` 之类的英文。
 */
export const FRAMEWORK_DEFAULT_MESSAGES = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Method Not Allowed',
  'Conflict',
  'Payload Too Large',
  'Unsupported Media Type',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
  'Service Unavailable',
]);

/** 请求字段中文名：校验报错时把属性名翻译成人话；未收录的字段回退属性名本身 */
export const FIELD_LABELS: Record<string, string> = {
  account: '账号',
  username: '用户名',
  nickname: '昵称',
  email: '邮箱',
  password: '密码',
  title: '标题',
  name: '名称',
  description: '描述',
  content: '内容',
  model: '模型',
  keyword: '关键字',
  cursor: '分页游标',
  page: '页码',
  pageSize: '每页条数',
  limit: '数量限制',
  status: '状态',
  role: '角色',
  visibility: '可见性',
  file: '文件',
  reasoning: '深度思考',
};

export function fieldLabel(property: string): string {
  return FIELD_LABELS[property] ?? property;
}

/**
 * class-validator 约束键 → 中文文案模板。
 * 约束值取自装饰器参数（如 MaxLength(100)），由 validation-exception-factory
 * 经 `error.contexts[key].constraints` 传入；取不到时用不带数值的文案。
 */
export type ValidationMessageFn = (
  label: string,
  constraints?: unknown[],
) => string;

function num(constraints: unknown[] | undefined, index: number): number | null {
  const raw = constraints?.[index];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export const VALIDATION_MESSAGES: Record<string, ValidationMessageFn> = {
  isString: (label) => `${label}应为文本`,
  isNotEmpty: (label) => `${label}不能为空`,
  isInt: (label) => `${label}应为整数`,
  isNumber: (label) => `${label}应为数字`,
  isBoolean: (label) => `${label}应为 true 或 false`,
  isEmail: (label) => `${label}格式不正确`,
  isUUID: (label) => `${label}格式不正确`,
  isEnum: (label) => `${label}取值不合法`,
  isIn: (label) => `${label}取值不合法`,
  isArray: (label) => `${label}应为数组`,
  isObject: (label) => `${label}应为对象`,
  arrayNotEmpty: (label) => `${label}不能为空数组`,
  min: (label, constraints) => {
    const bound = num(constraints, 0);
    return bound === null ? `${label}过小` : `${label}不能小于 ${bound}`;
  },
  max: (label, constraints) => {
    const bound = num(constraints, 0);
    return bound === null ? `${label}过大` : `${label}不能大于 ${bound}`;
  },
  minLength: (label, constraints) => {
    const bound = num(constraints, 0);
    return bound === null
      ? `${label}过短`
      : `${label}长度不能少于 ${bound} 个字符`;
  },
  maxLength: (label, constraints) => {
    const bound = num(constraints, 0);
    return bound === null
      ? `${label}过长`
      : `${label}长度不能超过 ${bound} 个字符`;
  },
  length: (label, constraints) => {
    const minValue = num(constraints, 0);
    const maxValue = num(constraints, 1);
    return minValue === null || maxValue === null
      ? `${label}长度不符合要求`
      : `${label}长度应在 ${minValue}-${maxValue} 个字符之间`;
  },
  matches: (label) => `${label}格式不正确`,
  // whitelist/forbidNonWhitelisted 产出的是带 `property xxx should not exist` 的键：
  // 此处匹配约束键本身（`whitelistValidation`），属性名仍按 error.property 取。
  whitelistValidation: (label) => `不支持的参数：${label}`,
};
