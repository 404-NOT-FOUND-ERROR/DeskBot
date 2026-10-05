import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBodyDeviceProfiles } from '../src/body-device-config.mjs';

test('local commissioning has no default device and rejects simulation or conflicting identity', () => {
  const root=mkdtempSync(join(tmpdir(),'deskbot-body-config-')),file=join(root,'body_devices.json');
  const save=devices=>writeFileSync(file,JSON.stringify({schema:'deskbot.body-devices.v1',devices}));
  try {
    assert.deepEqual(loadBodyDeviceProfiles(file),[]);
    const device={device_id:'actual-unit',character_id:'shaping-001',commissioned:false};
    save([device]);assert.equal(loadBodyDeviceProfiles(file)[0].commissioned,false);
    save([{...device,simulated:true}]);assert.throws(()=>loadBodyDeviceProfiles(file));
    save([{...device,character_id:'someone-else'}]);assert.throws(()=>loadBodyDeviceProfiles(file));
    save([device,device]);assert.throws(()=>loadBodyDeviceProfiles(file));
    save([{...device,shellCalibration:{device_id:'wrong-unit',calibration_id:'test',mappings:{}}}]);assert.throws(()=>loadBodyDeviceProfiles(file));
    save([{...device,capabilities:{camera:'yes'}}]);assert.throws(()=>loadBodyDeviceProfiles(file));
  } finally {rmSync(root,{recursive:true,force:true});}
});
