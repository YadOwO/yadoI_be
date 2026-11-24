/**
 * 物品购入价汇总内部接口的集成测试：yado_hub 用机器凭证调 GET /internal/v1/users/{userId}/item-value-summary。
 *
 * 直接连接 DATABASE_URL 指向的库（需已迁移）造数据，结束后清理。内部接口走机器凭证，不经过 Logto 鉴权。
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { inArray } from 'drizzle-orm';

/** 被统计的用户 */
const USER_ID = `test-item-value-${randomUUID()}`;
/** 另一个有数据的用户，用来验证汇总不会混进别人的物品 */
const OTHER_USER_ID = `test-item-value-other-${randomUUID()}`;
/** 没有任何物品的用户 */
const EMPTY_USER_ID = `test-item-value-empty-${randomUUID()}`;
/** 用来验证小数合计精度的用户，数据单独放，不和口径用例互相影响 */
const PRECISION_USER_ID = `test-item-value-precision-${randomUUID()}`;
/** yado_hub 持有的凭证明文；本服务只存它的 sha256 */
const HUB_TOKEN = `hub-${randomUUID()}`;

process.env.INTERNAL_MACHINE_TOKENS = `yado-hub:${createHash('sha256').update(HUB_TOKEN).digest('hex')}`;

const { default: app } = await import('../src/app.js');
const { closeDb, db } = await import('../src/db/index.js');
const { items } = await import('../src/db/schema.js');

after(async () => {
  await db.delete(items).where(inArray(items.userId, [USER_ID, OTHER_USER_ID, EMPTY_USER_ID, PRECISION_USER_ID]));
  await closeDb();
});

/** 调内部汇总接口 */
function getSummary(userId: string, authorization: string | null = `Bearer ${HUB_TOKEN}`): Promise<Response> {
  const headers: Record<string, string> = authorization === null ? {} : { Authorization: authorization };
  return Promise.resolve(app.request(`/internal/v1/users/${encodeURIComponent(userId)}/item-value-summary`, { headers }));
}

describe('GET /internal/v1/users/{userId}/item-value-summary', () => {
  test('没带凭证或凭证不对时返回 401', async () => {
    assert.equal((await getSummary(USER_ID, null)).status, 401);
    assert.equal((await getSummary(USER_ID, 'Bearer not-the-hub-token')).status, 401);
    assert.equal((await getSummary(USER_ID, 'Basic abc')).status, 401);
  });

  test('只算本人在用和退役物品：不算已卖出、已软删除和别人的，没填价格的只计件数', async () => {
    /** 本人最近一次更新的物品时刻；比它更晚的只出现在不该参与汇总的物品上，用来验证 lastItemUpdatedAt 的口径 */
    const latestCountedAt = new Date('2026-03-01T08:00:00.000Z');
    const earlierAt = new Date('2026-01-15T08:00:00.000Z');
    const laterNotCountedAt = new Date('2026-06-01T08:00:00.000Z');

    await db.insert(items).values([
      // 在用有价：100.10 + 0.00，0 元也算有价
      { userId: USER_ID, name: '在用有价', status: 'in_service', purchasePrice: 100.1, updatedAt: earlierAt },
      { userId: USER_ID, name: '在用零元', status: 'in_service', purchasePrice: 0, updatedAt: latestCountedAt },
      // 在用没填价格：只计入 unpricedItemCount
      { userId: USER_ID, name: '在用无价', status: 'in_service', purchasePrice: null, updatedAt: earlierAt },
      // 退役有价
      { userId: USER_ID, name: '退役有价', status: 'retired', purchasePrice: 50.05, updatedAt: earlierAt },
      // 以下三种都不参与汇总：已卖出、已软删除、别人的
      { userId: USER_ID, name: '已卖出', status: 'sold', purchasePrice: 999.99, updatedAt: laterNotCountedAt },
      {
        userId: USER_ID,
        name: '已删除',
        status: 'in_service',
        purchasePrice: 888.88,
        updatedAt: laterNotCountedAt,
        deletedAt: laterNotCountedAt,
      },
      { userId: OTHER_USER_ID, name: '别人的', status: 'in_service', purchasePrice: 777.77, updatedAt: laterNotCountedAt },
      { userId: OTHER_USER_ID, name: '别人的退役', status: 'retired', purchasePrice: 11.11, updatedAt: laterNotCountedAt },
    ]);

    const response = await getSummary(USER_ID);
    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    assert.deepEqual(body, {
      inServicePurchaseTotal: '100.10',
      retiredPurchaseTotal: '50.05',
      pricedItemCount: 3,
      unpricedItemCount: 1,
      lastItemUpdatedAt: latestCountedAt.toISOString(),
    });

    // lastItemUpdatedAt 是合法的 ISO 8601（UTC）字符串
    assert.ok(typeof body === 'object' && body !== null && 'lastItemUpdatedAt' in body);
    const lastItemUpdatedAt = body.lastItemUpdatedAt;
    assert.ok(typeof lastItemUpdatedAt === 'string');
    assert.equal(new Date(lastItemUpdatedAt).toISOString(), lastItemUpdatedAt);
  });

  test('合计在数据库里算，小数不丢精度', async () => {
    // 0.1 + 0.2 在 JS 里是 0.30000000000000004，数据库 numeric 相加应该正好是 0.30
    await db.insert(items).values([
      { userId: PRECISION_USER_ID, name: '一毛', status: 'in_service', purchasePrice: 0.1 },
      { userId: PRECISION_USER_ID, name: '两毛', status: 'in_service', purchasePrice: 0.2 },
    ]);

    const response = await getSummary(PRECISION_USER_ID);
    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    assert.ok(typeof body === 'object' && body !== null && 'inServicePurchaseTotal' in body);
    assert.equal(body.inServicePurchaseTotal, '0.30');
  });

  test('没有数据的用户返回全 0 和 null', async () => {
    const response = await getSummary(EMPTY_USER_ID);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      inServicePurchaseTotal: '0.00',
      retiredPurchaseTotal: '0.00',
      pricedItemCount: 0,
      unpricedItemCount: 0,
      lastItemUpdatedAt: null,
    });
  });

  test('内部接口不进 openapi.json', async () => {
    const doc: unknown = await (await app.request('/openapi.json')).json();
    assert.ok(typeof doc === 'object' && doc !== null && 'paths' in doc);
    const paths = doc.paths;
    assert.ok(typeof paths === 'object' && paths !== null);
    assert.deepEqual(
      Object.keys(paths).filter((path) => path.startsWith('/internal')),
      [],
    );
  });
});
