/**
 * 注销账号集成测试：开发态免鉴权，直接连接 DATABASE_URL 指向的库（需已迁移）。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

/** 当前登录的测试用户，需在加载 app 之前写入环境变量 */
const USER_ID = `test-account-${randomUUID()}`;
/** 另一个用户，用来验证注销不会误伤别人的数据 */
const OTHER_USER_ID = `test-account-other-${randomUUID()}`;
process.env.AUTH_DEV_BYPASS = 'true';
process.env.AUTH_DEV_USER_ID = USER_ID;

const { default: app } = await import('../src/app.js');
const { closeDb, db } = await import('../src/db/index.js');
const { categories, items } = await import('../src/db/schema.js');

after(async () => {
  await db.delete(items).where(eq(items.userId, OTHER_USER_ID));
  await db.delete(categories).where(eq(categories.userId, OTHER_USER_ID));
  await db.delete(items).where(eq(items.userId, USER_ID));
  await db.delete(categories).where(eq(categories.userId, USER_ID));
  await closeDb();
});

describe('注销账号', () => {
  test('只删本人数据（包括软删除记录），不动别人，且可重复调用', async () => {
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

    const response = await app.request('/v1/account', { method: 'DELETE' });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');

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

    const retryResponse = await app.request('/v1/account', { method: 'DELETE' });
    assert.equal(retryResponse.status, 204);
  });

  test('openapi.json 包含 DELETE /v1/account', async () => {
    const response = await app.request('/openapi.json');
    assert.equal(response.status, 200);
    const doc: unknown = await response.json();
    assert.ok(typeof doc === 'object' && doc !== null && 'paths' in doc);
    const paths = doc.paths;
    assert.ok(typeof paths === 'object' && paths !== null && '/v1/account' in paths);
    const accountPath = paths['/v1/account'];
    assert.ok(typeof accountPath === 'object' && accountPath !== null && 'delete' in accountPath);
  });
});
