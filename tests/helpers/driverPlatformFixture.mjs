import { sqliteD1 } from './sqliteD1.mjs';
export const driver = { id: 'staff_driver123', role: 'driver' };
export const vehicle = 'vehicle_12345678';
export const otherVehicle = 'vehicle_87654321';
export const time = 1800000000000;

export function fixture(t) {
  const DB = sqliteD1();
  t.after(() => DB.sqlite.close());
  DB.sqlite.prepare(`INSERT INTO staff_accounts
    (id,login,display_name,role,status,password_algorithm,password_iterations,
     password_salt,password_hash,password_changed_at,created_at,updated_at)
    VALUES (?,?,?,'driver','active','pbkdf2-sha256',100000,?,?,1,1,1)`)
    .run(driver.id, 'testdriver', 'Test Driver', 'A'.repeat(32), 'B'.repeat(43));
  DB.sqlite.prepare(`INSERT INTO driver_profiles
    (staff_account_id,normalized_phone,registration_status,identity_status,created_at,updated_at)
    VALUES (?,?,'approved','verified',1,1)`).run(driver.id, '+79990000000');
  for (const id of [vehicle, otherVehicle]) {
    DB.sqlite.prepare(`INSERT INTO vehicles
      (id,driver_id,vin,plate,make,model,class,capacity,status,created_at,updated_at)
      VALUES (?,?,'TESTVIN0000000001','TEST','Test','Car','comfort',4,'approved',1,1)`)
      .run(id, driver.id);
  }
  DB.sqlite.prepare(`INSERT INTO driver_availability
    (driver_id,state,revision,updated_at) VALUES (?,'off_line',1,1)`).run(driver.id);
  return DB;
}

