/**
 * 账号模块业务逻辑。
 *
 * 目前只有注销账号：删除 Logto 用户、写注销名单、清除业务数据；
 * 路由层只负责鉴权与响应，数据操作集中在这里。
 */
import { eq } from 'drizzle-orm';

import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { categories, deletedUsers, items } from '../../db/schema.js';
import { deleteLogtoUser } from '../../shared/logto-management.js';

/**
 * 注销账号：删除 Logto 用户，再写注销名单并清除这个用户在 yadoi schema 里的全部业务数据。
 *
 * - 删除 Logto 用户会影响整个芽豆系列：所有芽豆 App 共用同一个 Logto 账号，注销后都无法再登录
 * - 注销账号是「禁止物理删除业务数据」的唯一例外：这里是物理删除，不是软删除
 * - 会删掉该用户全部 items 和 categories，包括 deleted_at 非空的软删除（墓碑）行
 * - 不吞错：任何一步失败都向上抛出，交给全局 onError 返回；事务内失败会整体回滚
 *
 * 顺序是先删 Logto 再动库：Logto 删除失败时什么都没动，用户可以重试；
 * Logto 成功但事务失败时，用户还不在注销名单里，可以用同一个 token 重试（Logto 返回 404 也算成功）。
 * 整个过程幂等：用户没有数据或重复调用时，删除 0 行，同样正常返回。
 *
 * 注销名单（deleted_users）用来拦截注销前签发、还没过期的旧 token：requireAuth 验签后会查它。
 * 已经通过鉴权、正在执行的请求和注销同时发生时，仍有很小的窗口可能写入数据，
 * 所以 App 端要先停掉写请求再调注销接口。
 *
 * 事务里先删 items 再删 categories：items.category_id 外键引用 categories 且为 on delete set null，
 * 先删分类会触发一次无意义的置空更新。
 *
 * @param userId 要注销的用户，取自鉴权中间件写入的 Logto JWT sub
 */
export async function deleteAccount(userId: string): Promise<void> {
  // 开发态免鉴权的用户是假用户，Logto 里并不存在，跳过远程调用
  if (!env.isDevAuthBypassEnabled) {
    await deleteLogtoUser(userId);
  }

  await db.transaction(async (tx) => {
    await tx.insert(deletedUsers).values({ userId }).onConflictDoNothing();
    await tx.delete(items).where(eq(items.userId, userId));
    await tx.delete(categories).where(eq(categories.userId, userId));
  });
}
