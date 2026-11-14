const utf8 = new TextEncoder();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function randomBytes(size) { return crypto.getRandomValues(new Uint8Array(size)); }
export function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function decode64(value) { return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); }
export function randomToken(prefix) { return prefix + '_' + base64url(randomBytes(32)); }
export async function digest(context,value) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(context+'|'+value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function base32(bytes) {
 let bits=0,value=0,out='';
 for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(value>>>bits)&31];}}
 if(bits)out+=alphabet[(value<<(5-bits))&31];return out;
}
export function unbase32(text) {
 if(!/^[A-Z2-7]{32}$/.test(text))throw new Error('Invalid seed encoding');
 let bits=0,value=0,out=[];
 for(const char of text){value=(value<<5)|alphabet.indexOf(char);bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255);}}
 return Uint8Array.from(out);
}
async function encryptionKey(env) {
 const encoded=env?.ADMIN_MFA_ENCRYPTION_KEY;
 if(typeof encoded!=='string'||!/^[A-Za-z0-9+/_-]{43}=?$/.test(encoded))throw new Error('MFA encryption unavailable');
 const raw=decode64(encoded);if(raw.length!==32)throw new Error('MFA encryption unavailable');
 return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
export async function assertMfaConfigured(env){ await encryptionKey(env); }
export async function encryptSeed(env,account,seed) {
 const key=await encryptionKey(env),iv=randomBytes(12);
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode('admin-mfa|'+account+'|seed|v1')},key,seed);
 return JSON.stringify({version:1,iv:base64url(iv),ciphertext:base64url(new Uint8Array(encrypted))});
}
export async function decryptSeed(env,account,envelope) {
 const data=JSON.parse(envelope);if(data.version!==1)throw new Error('Unknown MFA key version');
 const iv=decode64(data.iv);if(iv.length!==12)throw new Error('Invalid seed envelope');
 const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:utf8.encode('admin-mfa|'+account+'|seed|v1')},await encryptionKey(env),decode64(data.ciphertext));
 if(decrypted.byteLength!==20)throw new Error('Invalid seed size');return new Uint8Array(decrypted);
}
export async function totp(seed,counter) {
 if(!Number.isSafeInteger(counter)||counter<0)throw new Error('Invalid TOTP counter');
 const message=new Uint8Array(8);let value=BigInt(counter);
 for(let i=7;i>=0;i--){message[i]=Number(value&255n);value>>=8n;}
 const key=await crypto.subtle.importKey('raw',seed,{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,message)),offset=bytes[19]&15;
 const binary=((bytes[offset]&127)<<24)|(bytes[offset+1]<<16)|(bytes[offset+2]<<8)|bytes[offset+3];
 return (binary%1_000_000).toString().padStart(6,'0');
}
function equal(a,b){let different=a.length^b.length;for(let i=0;i<6;i++)different|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return different===0;}
export async function matchingCounter(seed,code,now) {
 if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
 const current=Math.floor(now/30000);let matched=null;
 for(const offset of [-1,0,1])if(current+offset>=0&&equal(await totp(seed,current+offset),code))matched=current+offset;
 return matched;
}
export function recoveryCode(){return Array.from(randomBytes(16),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();}
export function normalizeRecovery(value){return typeof value==='string'&&/^[A-Fa-f0-9-]{32,39}$/.test(value)?value.replace(/-/g,'').toLowerCase():'';}
