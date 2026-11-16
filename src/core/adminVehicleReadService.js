import { adminCan, resolveAdminAccess } from './adminAuthorization.js';
import { listAdminVehicleRows, listAdminPhotoCheckRows, auditVehicleRead } from './adminVehicleReadRepository.js';

const vehicleId=/^vehicle_[A-Za-z0-9_-]{8,100}$/;
const driverId=/^staff_[A-Za-z0-9_-]{8,94}$/;
const checkId=/^photo-check_[A-Za-z0-9_-]{8,120}$/;
const statuses=['draft','pending_review','approved','photo_check_required','suspended','rejected'];
const fail=(status,code)=>({ok:false,status,error:status===403?'forbidden':status===404?'not found':'invalid request',code});
const encode=x=>btoa(JSON.stringify(x)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function pageQuery(params,scope,filter,checks) {
  if(!(params instanceof URLSearchParams))return null;
  for(const key of params.keys())if(!(checks?['limit','cursor']:['status','limit','cursor']).includes(key)||params.getAll(key).length!==1)return null;
  const status=params.get('status')??'';
  if(!checks&&params.has('status')&&!statuses.includes(status))return null;
  const count=params.get('limit');if(count!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(count))return null;
  let after='';const cursor=params.get('cursor');
  if(cursor!==null){
    if(!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))return null;
    try {const value=JSON.parse(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')));
      if(!Array.isArray(value)||value.length!==3||encode(value)!==cursor||value[0]!==scope||value[1]!==filter
        ||typeof value[2]!=='string'||!(checks?checkId:vehicleId).test(value[2]))return null;after=value[2];
    }catch{return null;}
  }
  return {status,limit:count===null?20:Number(count),after};
}
async function authorize(env,user,options,checks) {
  const access=await resolveAdminAccess(env,user);
  if(!access.ok||!adminCan(access,'vehicles.read')||(checks&&!adminCan(access,'vehicles.verify')))return {error:fail(403,'permission_required')};
  if(access.isOwner&&(options.mfa?.required!==true||options.mfa?.verified!==true))return {error:fail(403,'owner_mfa_required')};
  return {access};
}
function number(value,nullable=false) {
  if(nullable&&value===null)return null;
  if(!Number.isSafeInteger(value)||value<1)throw new Error('Invalid operational number');return value;
}
function text(value,max,pattern) {
  if(typeof value!=='string'||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||(pattern&&!pattern.test(value)))throw new Error('Invalid operational text');return value;
}
function choice(value,allowed){if(!allowed.includes(value))throw new Error('Invalid operational state');return value;}
export async function getAdminVehicles(env,user,params=new URLSearchParams(),options={}) {
  const auth=await authorize(env,user,options,false);if(auth.error)return auth.error;
  const status=params instanceof URLSearchParams?(params.get('status')??''):'';
  const scope='admin.vehicles.v1',page=pageQuery(params,scope,status,false);if(!page)return fail(400,'invalid_query');
  const rows=await listAdminVehicleRows(env,{...page,after:page.after});
  const vehicles=rows.slice(0,page.limit).map(r=>({id:text(r.id,108,vehicleId),driverId:text(r.driver_id,100,driverId),
    make:text(r.make,80),model:text(r.model,80),plate:text(r.plate,32),status:choice(r.status,statuses),revision:number(r.revision),
    lastPhotoCheckPassedAt:number(r.last_photo_check_passed_at,true),nextPhotoCheckDueAt:number(r.next_photo_check_due_at,true)}));
  const nextCursor=rows.length>page.limit?encode([scope,status,vehicles.at(-1).id]):null;
  await auditVehicleRead(env,{actor:auth.access.accountId,action:'admin.vehicles_read',target:'vehicles',requestId:options.requestId});
  return {ok:true,vehicles,nextCursor};
}
export async function getAdminVehiclePhotoChecks(env,user,id,params=new URLSearchParams(),options={}) {
  const auth=await authorize(env,user,options,true);if(auth.error)return auth.error;
  if(typeof id!=='string'||!vehicleId.test(id))return fail(400,'invalid_vehicle_id');
  const scope='admin.vehicle-photo-checks.v1',page=pageQuery(params,scope,id,true);if(!page)return fail(400,'invalid_query');
  const snapshot=await listAdminPhotoCheckRows(env,{vehicleId:id,after:page.after,limit:page.limit});
  if(!snapshot.vehicle)return fail(404,'vehicle_not_found');
  const checks=snapshot.rows.slice(0,page.limit).map(r=>{
    if(r.vehicle_id!==id)throw new Error('Invalid operational binding');
    return {id:text(r.id,132,checkId),vehicleId:id,kind:choice(r.kind,['monthly','complaint','manual']),
      restrictionMode:choice(r.restriction_mode,['grace_period','after_current_trip','immediate']),result:choice(r.result,['pending','passed','failed','manual_review']),
      revision:number(r.revision),dueAt:number(r.due_at),graceUntil:number(r.grace_until),createdAt:number(r.created_at),updatedAt:number(r.updated_at)};
  });
  const nextCursor=snapshot.rows.length>page.limit?encode([scope,id,checks.at(-1).id]):null;
  const vehicleRevision=number(snapshot.vehicle.revision);
  await auditVehicleRead(env,{actor:auth.access.accountId,action:'admin.vehicle_photo_checks_read',target:id,requestId:options.requestId});
  return {ok:true,vehicleId:id,vehicleRevision,checks,nextCursor};
}
