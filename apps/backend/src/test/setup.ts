/**
 * 后端测试环境变量注入。
 *
 * app.module.spec.ts 导入 app.module.ts 时，模块顶层会执行 ConfigModule.forRoot()
 * 并校验 envValidationSchema，其中 JWT_SECRET 为 required。CI/本地若未在环境变量中
 * 提供该值，会抛出 "Config validation error: JWT_SECRET is required" 导致进程退出。
 * setupFiles 在所有测试文件之前执行，提前 process.env 注入即可绕过该校验。
 */
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-32';
