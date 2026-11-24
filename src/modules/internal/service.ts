/**
 * 内部接口的业务逻辑：用户注销时删除本服务里这个用户的数据、给 yado_hub 的数据联动提供物品购入价汇总；
 * 路由层只负责鉴权与响应。
 */
import { and, eq, inArray, isNull, max, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { categories, deletedUsers, items } from '../../db/schema.js';
import type { InternalItemValueSummaryDTO } from './schemas.js';

/**
 * 删除用户数据：在一个事务里写入注销名单，再物理删除这个用户在 yadoi schema 里的全部业务数据。
 *
 * - 注销账号是「禁止物理删除业务数据」的唯一例外：这里是物理删除，不是软删除
 * - 会删掉该用户全部 items 和 categories，包括 deleted_at 非空的软删除（墓碑）行
 * - 删 Logto 用户不在这里：yado_hub 等所有服务都删完后才删
 * - 不吞错：任何一步失败都向上抛出，事务整体回滚，yado_hub 收到 500 后中止注销、让 App 重试
 * - 幂等：用户没有数据或重复调用时删除 0 行，同样正常返回
 *
 * 注销名单（deleted_users）用来拦截注销前签发、还没过期的旧 token：requireAuth 验签后会查它。
 * 已经通过鉴权、正在执行的请求和注销同时发生时，仍有很小的窗口可能写入数据，所以 App 端要先停掉写请求再注销。
 *
 * 事务里先删 items 再删 categories：items.category_id 外键引用 categories 且为 on delete set null，
 * 先删分类会触发一次无意义的置空更新。
 *
 * @param userId 要注销的 Logto 用户 ID，由 yado_hub 在路径里传入
 */
export async function deleteUserData(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(deletedUsers).values({ userId }).onConflictDoNothing();
    await tx.delete(items).where(eq(items.userId, userId));
    await tx.delete(categories).where(eq(categories.userId, userId));
  });
}

/**
 * 统计一个用户在用和退役物品的购入价汇总，给 yado_hub 的数据联动用。
 *
 * - 口径与 yadoI 统计页「持有购入总值」（HeldPurchaseTotalSummary）一致：只算 in_service 和 retired、
 *   deleted_at 为空的物品；sold 和软删除的不算；购入价为空的物品不参与合计、只计入 unpricedItemCount；0 元也算有价
 * - 只给汇总、不给明细：不返回任何一条物品的名称、分类、备注或单价，yado_hub 与芽豆资产拿到的只有合计和件数
 * - 合计在数据库里算完再转成两位小数的文本，不把 purchase_price 读成 JS number 相加，避免浮点误差；没有数据时是 "0.00"
 * - 只统计传入的 userId；调用方（yado_hub）在路径里指定用户，所以路由只认机器凭证
 *
 * @param userId 要统计的 Logto 用户 ID，由 yado_hub 在路径里传入
 */
export async function getItemValueSummary(userId: string): Promise<InternalItemValueSummaryDTO> {
  const [row] = await db
    .select({
      inServicePurchaseTotal: sql<string>`cast(coalesce(sum(${items.purchasePrice}) filter (where ${items.status} = 'in_service'), 0) as numeric(20,2))::text`,
      retiredPurchaseTotal: sql<string>`cast(coalesce(sum(${items.purchasePrice}) filter (where ${items.status} = 'retired'), 0) as numeric(20,2))::text`,
      pricedItemCount: sql<number>`count(*) filter (where ${items.purchasePrice} is not null)`.mapWith(Number),
      unpricedItemCount: sql<number>`count(*) filter (where ${items.purchasePrice} is null)`.mapWith(Number),
      lastItemUpdatedAt: max(items.updatedAt),
    })
    .from(items)
    .where(and(eq(items.userId, userId), isNull(items.deletedAt), inArray(items.status, ['in_service', 'retired'])));

  // 不带 group by 的聚合查询一定返回一行；noUncheckedIndexedAccess 下仍要判空，空时按没有数据处理
  if (row === undefined) {
    return {
      inServicePurchaseTotal: '0.00',
      retiredPurchaseTotal: '0.00',
      pricedItemCount: 0,
      unpricedItemCount: 0,
      lastItemUpdatedAt: null,
    };
  }

  return {
    inServicePurchaseTotal: row.inServicePurchaseTotal,
    retiredPurchaseTotal: row.retiredPurchaseTotal,
    pricedItemCount: row.pricedItemCount,
    unpricedItemCount: row.unpricedItemCount,
    lastItemUpdatedAt: row.lastItemUpdatedAt === null ? null : row.lastItemUpdatedAt.toISOString(),
  };
}
