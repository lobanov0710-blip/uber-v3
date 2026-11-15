// Private control plane only. Existing secrets are never rotated here.
import { randomBytes } from '../../src/core/ownerMfaCrypto.js';
export async function putMissingPhoneSecret(client,current,name,confirm,verifyScope){
 if(name!=='JWT_SECRET'&&name!=='ADMIN_MFA_ENCRYPTION_KEY')throw new Error('Unsupported phone secret');
 const jwt=name==='JWT_SECRET',present=jwt?current.jwtPresent:current.mfaKeyPresent;
 if(!Array.isArray(current.pending)||current.pending.length||typeof present!=='boolean')throw new Error('Reviewed schema and secret state required');
 if(present)return false;
 if(!jwt&&current.factors!==0)throw new Error('Existing factors require original key restoration');
 await verifyScope();
 await confirm(jwt?'SET JWT KEY ON uber-v3-staging':'SET MFA KEY ON uber-v3-staging');
 const bytes=randomBytes(32);let encoded=Buffer.from(bytes).toString('base64');
 try{await client.run(['secret','put',name],{input:encoded});}
 finally{bytes.fill(0);encoded=null;}
 return true;
}
