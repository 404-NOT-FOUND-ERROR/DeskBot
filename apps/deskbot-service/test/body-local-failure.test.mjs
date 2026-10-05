import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBodyCommandLocalFailure } from '../src/body-perception.mjs';

test('a bridge refusal settles only its linked command and never proves physical execution',()=>{
  const at='2026-10-05T10:00:00.000Z';
  const world={body:{revision:0,yaw:{actual_degrees:null},turns:[{device_id:'test',source_event_id:'body-perception:sample',execution_status:'queued',
    commands:[{command_id:'cmd',type:'orientation.base_yaw',status:'queued'}]}]}};
  const receipt={command_id:'cmd',type:'orientation.base_yaw',device_id:'test',source_event_id:'body-perception:sample',status:'failed',
    acknowledgment:{source:'deskbot-websocket-bridge',error:{code:'yaw_contract_not_supported',message:'contract absent'}}};
  const before=structuredClone(world);
  assert.equal(applyBodyCommandLocalFailure(world,receipt,at,{}).accepted,false);
  assert.deepEqual(world,before);
  assert.equal(applyBodyCommandLocalFailure(world,receipt,at,{commandAttested:true}).accepted,true);
  assert.equal(world.body.turns[0].execution_status,'failed');
  assert.equal(world.body.turns[0].commands[0].verification_status,'service_rejection');
  assert.equal(world.body.turns[0].commands[0].hardware_verified,false);
  assert.equal(world.body.yaw.actual_degrees,null);
  assert.equal(applyBodyCommandLocalFailure(world,receipt,at,{commandAttested:true}).duplicate,true);
});
