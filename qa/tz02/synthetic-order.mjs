import { seedAdmissionReferenceD1, seedAdmissionProofD1 } from '../../tests/helpers/admissionFixture.mjs';
import { sqliteD1 } from '../../tests/helpers/sqliteD1.mjs';

export const orderId = 'tz02_qa_synthetic_order';
const driver = 'tz02_qa_driver';
const first = 'tz02_qa_vehicle_1';
const second = 'tz02_qa_vehicle_2';
const sqlLiteral = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";

export async function seed(now, date) {
  const { sqlite, prepare } = sqliteD1();
  const statements = [];
  const DB = { prepare(sql) { return { bind(...args) {
    const query = prepare(sql).bind(...args);
    return { first: () => query.first(), async run() {
      const result = await query.run();
      statements.push(sql.replace(/\?(\d+)/g, (_, i) => sqlLiteral(args[Number(i) - 1])) + ';');
      return result;
    } };
  } }; } };
  try {
    await seedAdmissionReferenceD1(DB, 'Toyota', 'Camry');
    await DB.prepare(`INSERT INTO staff_accounts(id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at)
      VALUES(?1,?1,'TZ-02 synthetic driver','driver','active','pbkdf2-sha256',100000,?2,?3,1,1,1)`)
      .bind(driver, 'A'.repeat(32), 'B'.repeat(43)).run();
    await DB.prepare(`INSERT INTO driver_profiles(staff_account_id,normalized_phone,registration_status,identity_status,created_at,updated_at)
      VALUES(?1,'+79990000000','approved','verified',1,1)`).bind(driver).run();
    for (const [id, vin, plate, color] of [[first, 'TESTVIN0000000001', 'QA-TZ02-01', 'Белый'],
      [second, 'TESTVIN0000000002', 'QA-TZ02-02', 'Синий']]) {
      await DB.prepare(`INSERT INTO vehicles(id,driver_id,vin,plate,make,model,color,model_year,class,capacity,status,usage_basis,created_at,updated_at)
        VALUES(?1,?2,?3,?4,'Toyota','Camry',?5,2023,'comfort',4,'approved','owner',1,1)`)
        .bind(id, driver, vin, plate, color).run();
      await seedAdmissionProofD1(DB, id);
    }
    await DB.prepare(`INSERT INTO orders(id,name,phone,route,from_place,to_place,trip_date,status,created_at,updated_at)
      VALUES(?1,'TZ-02 synthetic passenger','+79990000001','Тест А → Тест Б','Тест А','Тест Б',?2,'new',?3,?3)`)
      .bind(orderId, date, now).run();
    return statements;
  } finally {
    sqlite.close();
  }
}

const change = (from, revision, fields) => `UPDATE orders SET ${fields}, revision=revision+1,
  updated_at=MAX(updated_at+1,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  WHERE id='${orderId}' AND status='${from}' AND revision=${revision};`;
const add = (id, vehicle, revision) => `INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,assigned_by,reason,created_at)
  SELECT '${id}',id,'${driver}','${vehicle}','staff_admission_fixture','TZ-02 synthetic assignment',updated_at
  FROM orders WHERE id='${orderId}' AND status='taken' AND revision=${revision} AND last_assignment_id='${id}'
  ON CONFLICT(id) DO NOTHING;`;
const retire = (id, state, revision) => `UPDATE order_assignments SET state='${state}',revision=revision+1,
  revoked_at=${state === 'revoked' ? "(SELECT updated_at FROM orders WHERE id=order_id)" : 'NULL'}
  WHERE id='${id}' AND order_id='${orderId}' AND state='active'
    AND EXISTS(SELECT 1 FROM orders WHERE id='${orderId}' AND revision=${revision});`;

export const transitions = {
  '01-assign': [change('new', 1, `status='taken',driver_id='${driver}',last_assignment_id='tz02_qa_assignment_1'`),
    add('tz02_qa_assignment_1', first, 2)],
  '02-reassign': [change('taken', 2, "last_assignment_id='tz02_qa_assignment_2'"),
    retire('tz02_qa_assignment_1', 'revoked', 3), add('tz02_qa_assignment_2', second, 3)],
  '03-finish': [change('taken', 3, "status='canceled'"), retire('tz02_qa_assignment_2', 'revoked', 4)]
};
