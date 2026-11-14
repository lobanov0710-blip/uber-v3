import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const script=new URL('../scripts/adminMfaBootstrap.mjs',import.meta.url).pathname;
test('control-plane help exposes no bootstrap secret and performs no database action',()=>{
 const result=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});assert.equal(result.status,0);assert.ok(result.stdout.includes('LOCAL')||result.stdout.includes('local'));
 assert.ok(!/bootstrap_[A-Za-z0-9_-]{43}/.test(result.stdout));
});
test('non-interactive CI cannot generate or print OWNER bootstrap codes',()=>{
 const result=spawnSync(process.execPath,[script,'--local-db','/nonexistent/fixture.sqlite','--owner-id','fixture-owner'],{encoding:'utf8',env:{...process.env,CI:'true'}});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.ok(result.stderr.includes('CONTROL-PLANE ACTION FAILED'));
 assert.ok(!/bootstrap_[A-Za-z0-9_-]{43}/.test(result.stderr));
});
