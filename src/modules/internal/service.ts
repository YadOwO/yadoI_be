/**
 * 内部接口的业务逻辑：用户注销时删除本服务里这个用户的数据，以及注销前汇总这个用户有多少数据；
 * 路由层只负责鉴权与响应。
 */
import { and, count, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { categories, deletedUsers, items } from '../../db/schema.js';

/**
 * 统计用户还没删除的物品件数，供 yado_hub 在注销确认页显示「N 件物品」。
 *
 * 完全只读：只数 items 里 user_id 匹配且 deleted_at 为空的行（软删除的不算），
 * 不统计 categories，没有任何写操作和副作用。用户不存在或没有物品时返回 0。
 *
 * @param userId 要汇总的 Logto 用户 ID，由 yado_hub 在路径里传入
 * @returns 未删除的物品件数，非负整数
 */
export async function countUserItems(userId: string): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(items)
    .where(and(eq(items.userId, userId), isNull(items.deletedAt)));
  // count(*) 在 Postgres 里是 bigint，drizzle 的 count() 已转成 number；聚合查询一定返回一行，这里仍显式判空
  return rows[0]?.total ?? 0;
}

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
