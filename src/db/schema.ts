/**
 * 数据库表定义（Drizzle ORM）。
 *
 * 隔离约定：本产品所有表都位于 `yadoi` schema 下。多个 yado 产品共享同一个 Postgres
 * 实例但各自独占 schema；需要读取其他产品数据时，只读对方显式暴露的 view，
 * 不直接读对方的表，以此保留将来拆分为独立库的可能性。
 */
import { index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** 本产品独占的 Postgres schema 名 */
export const DB_SCHEMA_NAME = 'yadoi';

export const yadoiSchema = pgSchema(DB_SCHEMA_NAME);

/**
 * 物品表。
 *
 * 当前仅包含多端同步必需的基础字段与物品名称。业务字段（分类、使用状态、
 * 购入价格与币种、当前估值、购买日期、开始使用日期、图片等）待物品数据模型
 * 确认后再补充，补充时遵循以下已确定的原则：
 * - 金额与币种分字段存储，购入价格与当前估值分开，缺失值不按 0 处理
 * - 时间统一 timestamptz，对外输出 ISO 8601
 * - 离开状态（已出售/赠送/丢失）保留记录，不参与当前持有汇总
 */
export const items = yadoiSchema.table(
  'items',
  {
    /** 全局唯一 ID（UUID v4），跨端同步的稳定标识 */
    id: uuid('id').primaryKey().defaultRandom(),
    /** 所属用户，取 Logto JWT 的 sub */
    userId: text('user_id').notNull(),
    /** 物品名称 */
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 最后更新时间，作为增量同步的游标 */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** 软删除墓碑：非空表示已删除，保留记录以便把删除动作同步到其他端 */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // 增量同步：按用户拉取某个时间点之后发生变更的记录
    index('items_user_updated_idx').on(table.userId, table.updatedAt),
  ],
);

export type ItemRow = typeof items.$inferSelect;
export type ItemInsert = typeof items.$inferInsert;
