/**
 * 机器鉴权的单元测试：不连数据库、不加载 config/env.ts，只用中间件本身。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Hono } from 'hono';

import { handleError } from '../src/shared/errors.js';
import type { AppEnv } from '../src/types.js';
import { createRequireMachine, parseMachineTokens } from '../src/middleware/machine.js';

/** yado_hub 持有的凭证明文 */
const HUB_TOKEN = 'a1b2c3d4'.repeat(8);

/** 凭证的 sha256，本服务的 INTERNAL_MACHINE_TOKENS 里只存它 */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 挂了机器鉴权的测试应用，返回写进 context 的调用方 ID */
function appWith(tokensValue: string): Hono<AppEnv> {
  const tokens = parseMachineTokens(tokensValue);
  assert.ok(tokens !== null, '测试用的凭证配置应能解析');
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.delete('/internal/v1/users/:userId', createRequireMachine(tokens), (c) => c.json({ caller: c.get('machineId') }));
  return app;
}

/** 发一次删除请求 */
function request(app: Hono<AppEnv>, authorization?: string): Promise<Response> {
  const headers: Record<string, string> = authorization === undefined ? {} : { Authorization: authorization };
  return Promise.resolve(app.request('/internal/v1/users/u1', { method: 'DELETE', headers }));
}

describe('parseMachineTokens', () => {
  it('空字符串得到空表', () => {
    assert.equal(parseMachineTokens('')?.size, 0);
    assert.equal(parseMachineTokens(' , ')?.size, 0);
  });

  it('解析 调用方ID:sha256，允许同一调用方配两项（换凭证时新旧并存）', () => {
    const oldHash = sha256('old');
    const newHash = sha256('new');
    const tokens = parseMachineTokens(` yado-hub:${oldHash} , yado-hub:${newHash}`);
    assert.deepEqual(
      [...(tokens ?? new Map<string, string>())],
      [
        [oldHash, 'yado-hub'],
        [newHash, 'yado-hub'],
      ],
    );
  });

  it('格式不对返回 null', () => {
    for (const value of ['yado-hub', 'yado-hub:not-a-sha256', `Yado:${sha256('x')}`, `yado-hub:${sha256('x')}:extra`]) {
      assert.equal(parseMachineTokens(value), null, value);
    }
  });
});

describe('createRequireMachine', () => {
  it('凭证对：放行，并写入调用方 ID', async () => {
    const response = await request(appWith(`yado-hub:${sha256(HUB_TOKEN)}`), `Bearer ${HUB_TOKEN}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { caller: 'yado-hub' });
  });

  it('Bearer 不区分大小写，凭证首尾空白忽略', async () => {
    const response = await request(appWith(`yado-hub:${sha256(HUB_TOKEN)}`), `bearer  ${HUB_TOKEN} `);
    assert.equal(response.status, 200);
  });

  it('没带凭证、凭证为空、凭证不对、带的是用户 JWT 形式都返回 401', async () => {
    const app = appWith(`yado-hub:${sha256(HUB_TOKEN)}`);
    for (const authorization of [undefined, 'Bearer ', `Bearer ${HUB_TOKEN}x`, `Basic ${HUB_TOKEN}`, 'Bearer eyJhbGciOi.x.y']) {
      const response = await request(app, authorization);
      assert.equal(response.status, 401, String(authorization));
      const body: unknown = await response.json();
      assert.ok(typeof body === 'object' && body !== null && 'code' in body && body.code === 'UNAUTHORIZED');
    }
  });

  it('没配任何凭证时一律 401', async () => {
    const response = await request(appWith(''), `Bearer ${HUB_TOKEN}`);
    assert.equal(response.status, 401);
  });
});
