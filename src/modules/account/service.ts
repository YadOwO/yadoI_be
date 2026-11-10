/**
 * 账号模块业务逻辑。
 *
 * 目前只有注销账号时的数据清除；路由层只负责鉴权与响应，数据操作集中在这里。
 */
import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { categories, items } from '../../db/schema.js';

/**
 * 清除某个用户在 yadoi schema 里的全部业务数据。
 *
 * - 注销账号是「禁止物理删除业务数据」的唯一例外：这里是物理删除，不是软删除
 * - 会删掉该用户全部 items 和 categories，包括 deleted_at 非空的软删除（墓碑）行
 * - 整个过程幂等：用户没有数据或重复调用时，删除 0 行，同样正常返回
 * - 不删 Logto 用户：同一个 Logto 账号由多个产品共用，删了会影响其他产品登录
 * - 不吞错：事务内任何一步失败都会整体回滚并向上抛出，交给全局 onError 返回 500
 *
 * 先删 items 再删 categories：items.category_id 外键引用 categories 且为 on delete set null，
 * 先删分类会触发一次无意义的置空更新。
 *
 * @param userId 要清除数据的用户，取自鉴权中间件写入的 Logto JWT sub
 */
export async function deleteAccountData(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(items).where(eq(items.userId, userId));
    await tx.delete(categories).where(eq(categories.userId, userId));
  });
}
