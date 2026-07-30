# yadoI_be 项目规则

本文件适用于 yadoI_be 仓库（Node.js + TypeScript 后端服务），是 Codex、Kiro CLI
及其他代码 Agent 的项目规则唯一来源。

## Agent 与 Skill 使用边界

- 本仓库是个人项目，不适用 Webull 工作流。
- 禁止调用或遵循任何名称以 `wb-` 开头的 skill，包括但不限于 `wb-commit`、
  `wb-code-review`、`wb-create-git-branch`、`wb-mr`、`wb-read-prd` 和 `wb-test-gen`。
- Git 提交、代码审查、分支和需求处理应遵循用户当次指令与本文件规则，不套用 Webull
  的需求单号、分支名、提交信息或 MR 规范。

## 语言

- 对话回复、文档、代码注释统一用中文。
- 代码标识符（变量、函数、类型、配置键、数据库字段）用英文。

## 注释规范

- 新增或修改变量、常量、函数和方法时，尽量使用中文 `/** */` 注释说明其业务含义、
  职责或关键约束。
- 声明级注释优先使用 `/** */`，不要用 `//` 代替；流程说明或局部实现细节可以使用 `//`。
- 注释应解释“为什么”或业务语义，不要只是重复代码本身。

## 技术栈边界

- 框架为 Hono，不要引入 Express / NestJS / Fastify 的写法或中间件。
- ORM 为 Drizzle，不要引入 Prisma / TypeORM。
- 校验为 Zod（v4），schema 一律从 `@hono/zod-openapi` 导入的 `z`，确保版本一致。
- 不要自行安装新依赖或引入新框架，需先与维护者确认。

## 类型安全

- 禁止 `any`。外部不可信数据用 `unknown` 并立即收窄。
- 禁止 `@ts-ignore`；确有必要时用 `@ts-expect-error` 并写明原因。
- 禁止用 `as` 掩盖真实的类型不匹配，禁止 `as unknown as T`。
- 导出的函数、类型必须显式标注参数与返回值类型。
- `tsconfig` 已开启 `strict` 与 `noUncheckedIndexedAccess`，不要为消除报错而放宽配置。
  数组下标访问结果可能为 `undefined`，必须显式判空。

## 命名

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| 文件、目录 | kebab-case 或小写 | `items/`, `routes.ts`, `env.ts` |
| 变量、函数 | camelCase | `toItemDTO`, `requireAuth` |
| 布尔变量 | is/has/should 前缀 | `isProduction`, `includeDeleted` |
| 常量 | UPPER_SNAKE_CASE | `DB_SCHEMA_NAME` |
| 接口 | PascalCase + `I` 前缀 | `IErrorBody` |
| 类型别名、Schema | PascalCase | `AppErrorStatus`, `ItemSchema` |
| 数据库字段 | snake_case | `user_id`, `deleted_at` |

## 分层职责

```
modules/<name>/schemas.ts   Zod 契约（校验 + 类型 + OpenAPI 文档的唯一来源）
modules/<name>/routes.ts    路由定义与处理逻辑
db/schema.ts                表结构
shared/                     跨模块通用能力
middleware/                 请求级横切逻辑
```

- 模块之间不互相 import，需要复用的逻辑下沉到 `shared/`。
- 数据契约只在 `schemas.ts` 定义一次，不在别处重复声明形状。

## 安全红线

- 所有涉及用户数据的查询**必须**按 `userId` 过滤，不得依赖客户端传入的用户标识。
- 新增业务路由**必须**在 `createRoute` 的 `middleware` 字段挂 `requireAuth`。
  不要改用 `app.use('/*', ...)`：子应用挂载后该通配不匹配模块根路径，会造成接口绕过鉴权。
- 不要在日志或错误响应中输出 token、密钥、完整 JWT 内容。
- 未预期异常只对外返回通用信息，详细堆栈仅记录服务端日志。
- 不要提交 `.env`；新增配置项同步补充到 `.env.example`。

## 数据库约定

- 本产品所有表位于 `yadoi` schema 下，通过 `yadoiSchema.table()` 定义。
- 跨产品读取数据只读对方暴露的 view，禁止直接读其他 schema 的表。
- 删除采用软删除（写 `deletedAt`），禁止物理删除业务数据。
- 每张业务表都应具备 `id`(uuid) / `user_id` / `created_at` / `updated_at` / `deleted_at`，
  以满足多端增量同步的需要。
- 生产环境表结构变更走 `db:generate` + `db:migrate`，不要用 `db:push`。

## 改动前后

- 改动运行时行为后，至少执行 `pnpm run typecheck` 与 `pnpm run build`。
- 新增或修改接口后，实际启动服务验证，不要只依据类型检查就宣称完成。
- 输出完整可运行代码，不要留 `// ...` 之类的省略片段；确实无法实现的占位需显著标注并在回复中说明。
