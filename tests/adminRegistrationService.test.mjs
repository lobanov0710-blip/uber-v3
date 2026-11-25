import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, driver } from './helpers/driverPlatformFixture.mjs';
import { getAdminRegistrationQueue } from '../src/core/adminRegistrationService.js';

const admin = { id: 'staff_admin123', role: 'admin' };
function setup(t) {
  const DB = fixture(t);
  DB.sqlite.prepare(`INSERT INTO staff_accounts
    (id,login,display_name,role,status,password_algorithm,password_iterations,
     password_salt,password_hash,password_changed_at,created_at,updated_at)
    VALUES (?,'queue-admin','Test Admin','admin','active','pbkdf2-sha256',100000,?,?,1,1,1)`)
    .run(admin.id, 'A'.repeat(32), 'B'.repeat(43));
  DB.sqlite.exec("UPDATE driver_profiles SET registration_status='submitted'");
  return DB;
}

test('registration queue remains permission-controlled on real SQLite', async t => {
  const DB = setup(t);
  assert.equal((await getAdminRegistrationQueue({ DB }, admin)).status, 403);
  assert.equal((await getAdminRegistrationQueue({ DB }, driver)).status, 403);
  DB.sqlite.prepare(`INSERT INTO staff_permissions(account_id,permission,granted_by,created_at)
    VALUES (?,'drivers.read',?,1)`).run(admin.id, admin.id);
  const result = await getAdminRegistrationQueue({ DB }, admin);
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.registrations[0].driverId, driver.id);
  assert.equal((await getAdminRegistrationQueue({ DB }, admin, { status: 'approved' })).status, 400);
  assert.equal((await getAdminRegistrationQueue({ DB }, admin, { limit: 0 })).status, 400);
});

test('OWNER queue access requires the authoritative owner binding', async t => {
  const DB = setup(t);
  DB.sqlite.prepare('INSERT INTO staff_owner_binding(singleton,account_id,created_at) VALUES (1,?,1)')
    .run(admin.id);
  assert.equal((await getAdminRegistrationQueue({ DB }, admin)).count, 1);
});
