import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,chmod,rm,open,rename} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
const execute=promisify(execFile);
export async function privateDirectory(prefix,parent=homedir()){
 const folder=await mkdtemp(path.join(parent,prefix));
 try{
  if(process.platform==='win32'){
   const system=path.join(process.env.SystemRoot||'C:\\Windows','System32');
   const identity=await execute(path.join(system,'whoami.exe'),['/user','/fo','csv','/nh'],{windowsHide:true,timeout:10000});
   const ids=identity.stdout.match(/S-1-[0-9-]+/g);if(ids?.length!==1)throw Error('Owner SID unavailable');
   await execute(path.join(system,'icacls.exe'),[folder,'/inheritance:r','/grant:r','*'+ids[0]+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{windowsHide:true,timeout:10000});
  }else await chmod(folder,0o700);
  return folder;
 }catch{await rm(folder,{recursive:true,force:true});throw Error('Private folder access could not be secured');}
}
export async function writeJson(folder,name,value){
 const temporary=path.join(folder,name+'.partial'),handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 await rename(temporary,path.join(folder,name));
}
