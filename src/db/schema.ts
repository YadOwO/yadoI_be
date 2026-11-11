/**
 * 数据库表定义（Drizzle ORM）。
 *
 * 隔离约定：本产品所有表都位于 `yadoi` schema 下。多个 yado 产品共享同一个 Postgres
 * 实例但各自独占 schema；需要读取其他产品数据时，只读对方显式暴露的 view，
 * 不直接读对方的表，以此保留将来拆分为独立库的可能性。
 *
 * 通用约定：
 * - 每张业务表都具备 id(uuid) / user_id / created_at / updated_at / deleted_at。
 *   deleted_at 用于软删除（防误删、留审计线索），列表接口不下发已删除记录；
 *   列表一次返回全量，不做游标式增量同步
 * - 日历日期（购入、卖出、保修截止）用 date，避免时区换算导致日期偏移一天；
 *   事件时刻（创建、更新、删除）用 timestamptz，对外输出 ISO 8601
 * - 枚举列存 text 而非 pg enum：值集合仍在演进期，改动只需改代码、不必迁移数据库。
 *   合法值由各模块的 schemas.ts 用 Zod 把关，值本身用 snake_case
 * - 图标只有物品有，用 iconType + iconValue 两列表达（emoji / preset 素材库 / photo 照片 /
 *   cutout 抠图），照片类另有 iconFocusX / iconFocusY 记录取景中心；
 *   数据结构一次定好、能力可分期实现，将来新增图标来源不必改表。分类本期不做图标
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** 本产品独占的 Postgres schema 名 */
export const DB_SCHEMA_NAME = 'yadoi';

export const yadoiSchema = pgSchema(DB_SCHEMA_NAME);

/**
 * 物品分类表。
 *
 * 单层结构，不做父子嵌套；分类由用户自行维护，可改名、可排序。
 * 本期不做分类图标，列表靠名称与顺序区分即可。
 */
export const categories = yadoiSchema.table(
  'categories',
  {
    /** 全局唯一 ID（UUID v4），跨端同步的稳定标识 */
    id: uuid('id').primaryKey().defaultRandom(),
    /** 所属用户，取 Logto JWT 的 sub */
    userId: text('user_id').notNull(),
    /** 分类名称 */
    name: text('name').notNull(),
    /** 展示顺序，数值小的排前面，便于用户把常用分类置顶 */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 最后更新时间 */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** 软删除标记：非空表示已删除，保留记录用于防误删与审计，列表接口不下发 */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // 列表查询按用户过滤，附带 updated_at 便于按最近变更排序
    index('categories_user_updated_idx').on(table.userId, table.updatedAt),
    // 同一用户下分类名不重复；限定未删除的行，使删除过的分类名可以再次启用
    uniqueIndex('categories_user_name_uniq')
      .on(table.userId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * 物品表。
 *
 * 产品定位是「记录并回看自己拥有些什么」，不是资产成本核算，因此金额只做朴素记录，
 * 不派生日均成本一类指标；持有天数、是否在保等可推导的信息一律不落库。
 */
export const items = yadoiSchema.table(
  'items',
  {
    /** 全局唯一 ID（UUID v4），允许客户端生成以支持离线先建后传 */
    id: uuid('id').primaryKey().defaultRandom(),
    /** 所属用户，取 Logto JWT 的 sub */
    userId: text('user_id').notNull(),
    /** 物品名称，唯一的必填业务字段 */
    name: text('name').notNull(),
    /** 所属分类，允许为空表示未分类；分类被删除时置空而不连带删除物品 */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** 图标来源：emoji / preset（内置素材库）/ photo（照片）/ cutout（抠图） */
    iconType: text('icon_type'),
    /**
     * 图标内容，按 iconType 解释：emoji 字符或素材库 key；
     * photo / cutout 存 App 生成的文件名 `<uuid>.<ext>`，第二期作为对象存储的 key
     */
    iconValue: text('icon_value'),
    /** 原图小图标取景中心的横向位置，0 到 1，原点在左上角，没有记录时为空 */
    iconFocusX: doublePrecision('icon_focus_x'),
    /** 原图小图标取景中心的纵向位置，0 到 1，原点在左上角，没有记录时为空 */
    iconFocusY: doublePrecision('icon_focus_y'),
    /** 生命周期状态：in_service（现役）/ retired（退役）/ sold（已卖出），三者互斥 */
    status: text('status').notNull().default('in_service'),
    /**
     * 是否收藏。
     * 收藏与 status 是彼此独立的维度：退役的物品同样可以是收藏，
     * 因此不并入 status 枚举。
     */
    isFavorite: boolean('is_favorite').notNull().default(false),
    /** 备注：入手缘由、来自谁、使用感受等，是回看时真正想读的内容 */
    note: text('note'),
    /** 购入金额，暂不记币种；缺失即为空，不按 0 处理 */
    purchasePrice: numeric('purchase_price', { precision: 12, scale: 2, mode: 'number' }),
    /** 卖出金额，仅在 status 为 sold 时有意义 */
    salePrice: numeric('sale_price', { precision: 12, scale: 2, mode: 'number' }),
    /** 入手日期 */
    purchasedAt: date('purchased_at'),
    /** 卖出日期 */
    soldAt: date('sold_at'),
    /**
     * 保修截止日期。
     * 「是否在保」由该日期与当天比较得出，不存成状态值——状态值会随时间自动失效，
     * 而没有任何人会去逐条修正过期的数据。
     */
    warrantyUntil: date('warranty_until'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 最后更新时间 */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** 软删除标记：非空表示已删除，保留记录用于防误删与审计，列表接口不下发 */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // 列表查询按用户过滤，附带 updated_at 便于按最近变更排序
    index('items_user_updated_idx').on(table.userId, table.updatedAt),
    // 图标的来源与内容必须成对出现，避免出现只有 type 没有 value 的脏数据
    check('items_icon_pair_ck', sql`(${table.iconType} is null) = (${table.iconValue} is null)`),
  ],
);

/**
 * 注销名单：已注销账号的 Logto 用户 ID。
 *
 * 这不是业务表，所以没有 id、updated_at、deleted_at 这些列；只存 Logto 用户 ID 和注销时间。
 * 鉴权时用它拒绝注销前签发、还没过期的 access token（JWT 离线验签，Logto 删用户后旧 token 仍能过验签）。
 * 业务数据原则上只做软删除；用户注销账号是唯一的例外，会物理删除这个用户的全部
 * items、categories，并写入本表。
 */
export const deletedUsers = yadoiSchema.table('deleted_users', {
  /** 已注销的 Logto 用户 ID（JWT 的 sub） */
  userId: text('user_id').primaryKey(),
  /** 注销时间 */
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CategoryRow = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;
export type ItemRow = typeof items.$inferSelect;
export type ItemInsert = typeof items.$inferInsert;
