import assert from 'node:assert/strict';
import test from 'node:test';
import { base32,unbase32,totp,matchingCounter,encryptSeed,decryptSeed } from '../src/core/ownerMfaCrypto.js';
const seed=new TextEncoder().encode('12345678901234567890');
const env={ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
test('RFC 6238 SHA-1 vectors truncated to the approved six digits',async()=>{
 for(const [seconds,code] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']])assert.equal(await totp(seed,Math.floor(seconds/30)),code);
 assert.deepEqual(unbase32(base32(seed)),seed);
});
test('TOTP permits only previous/current/next step and rejects malformed codes',async()=>{
 const now=1800000000000,counter=Math.floor(now/30000);
 for(const offset of [-1,0,1])assert.equal(await matchingCounter(seed,await totp(seed,counter+offset),now),counter+offset);
 assert.equal(await matchingCounter(seed,await totp(seed,counter-2),now),null);
 for(const code of ['12345','1234567','abcdef',123456,null])assert.equal(await matchingCounter(seed,code,now),null);
});
test('AES-GCM binds the seed to account/version and never stores plaintext',async()=>{
 const ciphertext=await encryptSeed(env,'owner-1',seed);
 assert.ok(!ciphertext.includes(base32(seed)));assert.deepEqual(await decryptSeed(env,'owner-1',ciphertext),seed);
 await assert.rejects(()=>decryptSeed(env,'owner-2',ciphertext));
 await assert.rejects(()=>decryptSeed({ADMIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64')},'owner-1',ciphertext));
 const envelope=JSON.parse(ciphertext);envelope.version=2;await assert.rejects(()=>decryptSeed(env,'owner-1',JSON.stringify(envelope)));
 await assert.rejects(()=>encryptSeed({},'owner-1',seed));
});
