/**
 * 数据库表定义（Drizzle ORM）。
 *
 * 隔离约定：本产品所有表都位于 `yadoi` schema 下。多个 yado 产品共享同一个 Postgres
 * 实例但各自独占 schema；需要读取其他产品数据时，只读对方显式暴露的 view，
 * 不直接读对方的表，以此保留将来拆分为独立库的可能性。
 *
 * 当前没有业务表：脚手架阶段的示例表已移除，待物品数据模型确认后再建。
 * 新增业务表时遵循以下已确定的约定：
 * - 统一具备 id(uuid) / user_id / created_at / updated_at / deleted_at 五个字段，
 *   以满足多端增量同步（updated_at 作游标，deleted_at 作软删除墓碑）
 * - 金额与币种分字段存储，购入价格与当前估值分开，缺失值不按 0 处理
 * - 时间统一 timestamptz，对外输出 ISO 8601
 * - 离开状态（已出售/赠送/丢失）保留记录，不参与当前持有汇总
 */
import { pgSchema } from 'drizzle-orm/pg-core';

/** 本产品独占的 Postgres schema 名 */
export const DB_SCHEMA_NAME = 'yadoi';

export const yadoiSchema = pgSchema(DB_SCHEMA_NAME);
