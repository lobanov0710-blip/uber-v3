import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,chmod,rm,open,rename} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
const execute=promisify(execFile);
export async function privateDirectory(prefix,parent=homedir()){
 const folder=await mkdtemp(path.join(parent,prefix));
 let safeFailure='PRIVATE_DIRECTORY';
 try{
  if(process.platform==='win32'){
   const system=path.join(process.env.SystemRoot||'C:\\Windows','System32');
   const literal=folder.replaceAll("'","''");
   const command=[
    "$ErrorActionPreference='Stop'; $stage='OWNER'; try {",
    "$p='"+literal+"'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;",
    "$stage='DACL'; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid);",
    "$acl.SetSecurityDescriptorSddlForm(('D:P(A;OICI;FA;;;'+$sid.Value+')(A;OICI;FA;;;SY)'),[System.Security.AccessControl.AccessControlSections]::Access);",
    "$stage='APPLY'; Set-Acl -LiteralPath $p -AclObject $acl; $stage='READ'; $actual=Get-Acl -LiteralPath $p;",
    "$stage='ENUMERATE'; $rules=@($actual.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]));",
    "$stage='COUNT'; if (!$actual.AreAccessRulesProtected -or $rules.Count -ne 2) { throw 'Rejected' };",
    "$stage='RIGHTS'; foreach ($rule in $rules) { if ($rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18') -or $rule.AccessControlType -ne 'Allow' -or ($rule.FileSystemRights -band 2032127) -ne 2032127) { throw 'Rejected' } }",
    "} catch { [Console]::Error.WriteLine('PRIVATE_ACL_'+$stage); exit 1 }"
   ].join(' ');
   try{await execute(path.join(system,'WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000});}
   catch(error){safeFailure=error.stderr?.match(/PRIVATE_ACL_(?:OWNER|DACL|APPLY|READ|ENUMERATE|COUNT|RIGHTS)/)?.[0]??'PRIVATE_ACL_EXECUTION';throw error;}
  }else await chmod(folder,0o700);
  return folder;
 }catch{await rm(folder,{recursive:true,force:true});throw Error('Private folder access could not be secured: '+safeFailure);}
}
export async function writeJson(folder,name,value){
 const temporary=path.join(folder,name+'.partial'),handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 await rename(temporary,path.join(folder,name));
}
