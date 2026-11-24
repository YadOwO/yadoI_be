/**
 * 注销账号内部接口的集成测试：yado_hub 用机器凭证调 DELETE /internal/v1/users/{userId}。
 *
 * 用开发态免鉴权造数据、验证旧身份被拒（不调用 Logto），直接连接 DATABASE_URL 指向的库（需已迁移），结束后清理。
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

/** 要注销的用户：开发态免鉴权的身份，需在加载 app 之前写入环境变量 */
const USER_ID = `test-account-${randomUUID()}`;
/** 另一个用户，用来验证注销不会误伤别人的数据 */
const OTHER_USER_ID = `test-account-other-${randomUUID()}`;
/** yado_hub 持有的凭证明文；本服务只存它的 sha256 */
const HUB_TOKEN = `hub-${randomUUID()}`;

process.env.AUTH_DEV_BYPASS = 'true';
process.env.AUTH_DEV_USER_ID = USER_ID;
process.env.INTERNAL_MACHINE_TOKENS = `yado-hub:${createHash('sha256').update(HUB_TOKEN).digest('hex')}`;

const { default: app } = await import('../src/app.js');
const { closeDb, db } = await import('../src/db/index.js');
const { categories, deletedUsers, items } = await import('../src/db/schema.js');

after(async () => {
  await db.delete(deletedUsers).where(eq(deletedUsers.userId, USER_ID));
  await db.delete(items).where(eq(items.userId, OTHER_USER_ID));
  await db.delete(categories).where(eq(categories.userId, OTHER_USER_ID));
  await db.delete(items).where(eq(items.userId, USER_ID));
  await db.delete(categories).where(eq(categories.userId, USER_ID));
  await closeDb();
});

/** 调内部删除接口 */
function deleteUser(userId: string, authorization: string | null = `Bearer ${HUB_TOKEN}`): Promise<Response> {
  const headers: Record<string, string> = authorization === null ? {} : { Authorization: authorization };
  return Promise.resolve(app.request(`/internal/v1/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers }));
}

describe('DELETE /internal/v1/users/{userId}', () => {
  test('只删本人数据（包括软删除记录），写入注销名单并拦截旧身份，不动别人，且可重复调用', async () => {
    const [activeCategory] = await db
      .insert(categories)
      .values({ userId: USER_ID, name: `在用分类-${randomUUID()}` })
      .returning();
    const [deletedCategory] = await db
      .insert(categories)
      .values({ userId: USER_ID, name: `已删分类-${randomUUID()}`, deletedAt: new Date() })
      .returning();
    assert.ok(activeCategory !== undefined && deletedCategory !== undefined);
    await db.insert(items).values([
      { userId: USER_ID, name: '在用物品', categoryId: activeCategory.id },
      { userId: USER_ID, name: '已删物品', deletedAt: new Date() },
    ]);

    const [otherCategory] = await db
      .insert(categories)
      .values({ userId: OTHER_USER_ID, name: `别人的分类-${randomUUID()}` })
      .returning();
    assert.ok(otherCategory !== undefined);
    await db.insert(items).values({ userId: OTHER_USER_ID, name: '别人的物品', categoryId: otherCategory.id });

    // 没带凭证或凭证不对：401，什么都不删
    assert.equal((await deleteUser(USER_ID, null)).status, 401);
    assert.equal((await deleteUser(USER_ID, 'Bearer not-the-hub-token')).status, 401);
    assert.equal((await db.select().from(items).where(eq(items.userId, USER_ID))).length, 2);
    assert.equal((await db.select().from(categories).where(eq(categories.userId, USER_ID))).length, 2);

    const response = await deleteUser(USER_ID);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });

    assert.equal((await db.select().from(items).where(eq(items.userId, USER_ID))).length, 0);
    assert.equal((await db.select().from(categories).where(eq(categories.userId, USER_ID))).length, 0);

    const otherCategories = await db.select().from(categories).where(eq(categories.userId, OTHER_USER_ID));
    const otherItems = await db.select().from(items).where(eq(items.userId, OTHER_USER_ID));
    assert.equal(otherCategories.length, 1);
    assert.equal(otherItems.length, 1);
    assert.equal(otherCategories[0]?.id, otherCategory.id);
    assert.equal(otherCategories[0]?.deletedAt, null);
    assert.equal(otherItems[0]?.name, '别人的物品');
    assert.equal(otherItems[0]?.categoryId, otherCategory.id);
    assert.equal(otherItems[0]?.deletedAt, null);

    // 注销名单：只有本人在名单里
    const deletedSelf = await db.select().from(deletedUsers).where(eq(deletedUsers.userId, USER_ID));
    const deletedOther = await db.select().from(deletedUsers).where(eq(deletedUsers.userId, OTHER_USER_ID));
    assert.equal(deletedSelf.length, 1);
    assert.equal(deletedOther.length, 0);

    // 注销后同一身份（等同注销前签发的旧 token）的读写接口一律 401
    assert.equal((await app.request('/v1/categories')).status, 401);
    const createCategoryResponse = await app.request('/v1/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `注销后新建分类-${randomUUID()}` }),
    });
    assert.equal(createCategoryResponse.status, 401);
    const createItemResponse = await app.request('/v1/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '注销后新建物品' }),
    });
    assert.equal(createItemResponse.status, 401);

    // 旧身份写不回去：本人数据仍为 0 行
    assert.equal((await db.select().from(items).where(eq(items.userId, USER_ID))).length, 0);
    assert.equal((await db.select().from(categories).where(eq(categories.userId, USER_ID))).length, 0);

    const retryResponse = await deleteUser(USER_ID);
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { deleted: true });
  });

  test('给 App 的注销接口已经没有了，内部接口不进 openapi.json', async () => {
    assert.equal((await app.request('/v1/account', { method: 'DELETE' })).status, 404);

    const doc: unknown = await (await app.request('/openapi.json')).json();
    assert.ok(typeof doc === 'object' && doc !== null && 'paths' in doc);
    const paths = doc.paths;
    assert.ok(typeof paths === 'object' && paths !== null);
    assert.deepEqual(
      Object.keys(paths).filter((path) => path.startsWith('/internal') || path === '/v1/account'),
      [],
    );
  });
});
