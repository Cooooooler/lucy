import { QueryFailedError } from 'typeorm';

/**
 * 连接池/连接释放类失败的文案特征。这类错误由 pg / pg-pool 直接抛出**裸 Error**，
 * 没有可判定的类型，也没有稳定的 name，只能按文案识别。
 */
const CONNECTION_ERROR =
  /timeout exceeded when trying to connect|connection terminated|already (?:been )?released|already been connected|cannot use a pool after/i;

/**
 * Postgres 连接/停机/资源不足/语句取消类 SQLSTATE：
 * - 08*（connection exception，SQLSTATE 定长 5 位）
 * - 57P01/57P02/57P03（shutdown / cannot connect now）、57P04（database dropped）
 * - 53300（too many connections）
 * - 57014（query canceled，语句超时走这条）
 * 结构化判据优先于文案：SQLSTATE 不随驱动版本或措辞变化。
 */
const PG_INFRA_CODE = /^(?:08[0-9A-Z]{3}|57P0[1-4]|53300|57014)$/;

/**
 * 是否为数据库/连接层的基础设施错误（连接、语句、事务失败）。
 *
 * 主判据用 TypeORM 核心导出的 `QueryFailedError` 做 instanceof——它是库自身声明的类
 * （不是驱动私有实现），比 `'driverError' in error` 这类形状嗅探精确：嗅探会漏掉非查询类
 * 失败（它们既不是 QueryFailedError 也不带 driverError），又会把任何碰巧带同名属性的第三方
 * 错误吞成基础设施错误。连接池类失败补 SQLSTATE 与文案判据：它们含 timeout 字样，漏判就会
 * 被上层当成业务/模型失败，误报成「模型调用超时」。
 */
export function isInfrastructureError(error: unknown): boolean {
  if (error instanceof QueryFailedError) return true;
  if (!(error instanceof Error)) return false;
  // 结构化优先：pg 的连接/取消类失败带 SQLSTATE（code），不随驱动文案变化
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && PG_INFRA_CODE.test(code)) return true;
  // pg-pool 的连接类失败是裸 Error，没有稳定类型/name，只能按文案兜底
  return CONNECTION_ERROR.test(error.message);
}
