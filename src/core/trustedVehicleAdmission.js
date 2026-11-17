// Fixed server-owned SQL only. A legacy class/status or an old candidate is not
// evidence. The bound server time can tighten, never extend, document validity.
export function trustedVehicleGuard(vehicle, now, matchClass = true) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(vehicle) || !/^\?[1-9][0-9]*$/.test(now) || typeof matchClass !== 'boolean') {
    throw new Error('Invalid vehicle admission SQL parameters');
  }
  return `EXISTS(SELECT 1 FROM vehicle_current_trusted_assessments tva
    WHERE tva.vehicle_id=${vehicle}.id AND tva.outcome='candidate' AND tva.class IS NOT NULL
      ${matchClass ? `AND tva.class=${vehicle}.class` : ''}
      AND typeof(${vehicle}.color)='text' AND length(${vehicle}.color)<=80
      AND length(trim(${vehicle}.color,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0
      AND instr(${vehicle}.color,char(0))=0 AND ${vehicle}.color NOT GLOB ('*['||char(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,127)||']*')
      AND NOT EXISTS(SELECT 1 FROM json_each(tva.evidence_json) e JOIN document_resources td ON td.id=json_extract(e.value,'$.documentId')
        WHERE td.expires_at IS NOT NULL AND td.expires_at<=MAX(${now},CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))))`;
}
