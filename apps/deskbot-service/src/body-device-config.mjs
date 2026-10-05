import { readFileSync } from 'node:fs';

// Commissioning is a local operator decision, never a device payload claim.
// This file contains calibration/capability limits only, not credentials.
export function loadBodyDeviceProfiles(filename) {
  let value;
  try { value = JSON.parse(readFileSync(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw new Error('身体设备配置无法读取，请检查本地 JSON 格式。'); }
  if (value.schema !== 'deskbot.body-devices.v1' || !Array.isArray(value.devices)) throw new Error('身体设备配置 schema 或 devices 无效。');
  const seen = new Set();
  return value.devices.map(device => {
    if (!device || typeof device.device_id !== 'string' || !device.device_id.trim()
      || device.character_id !== 'shaping-001' || seen.has(device.device_id)
      || typeof device.commissioned !== 'boolean' || device.simulated === true) throw new Error('身体设备配置需要唯一设备 ID、主角绑定和明确的实机调试状态。');
    seen.add(device.device_id);
    if (device.capabilities && (typeof device.capabilities !== 'object' || Array.isArray(device.capabilities)
      || Object.values(device.capabilities).some(value => typeof value !== 'boolean'))) throw new Error('身体设备能力配置必须是布尔值映射。');
    const calibration = device.shellCalibration;
    if (calibration && (calibration.device_id !== device.device_id || typeof calibration.calibration_id !== 'string'
      || !calibration.calibration_id.trim() || !calibration.mappings || typeof calibration.mappings !== 'object'
      || Array.isArray(calibration.mappings) || Object.values(calibration.mappings).some(id => typeof id !== 'string' || !id.trim()))) throw new Error('换壳校准必须绑定本设备并给出磁签名映射。');
    return structuredClone({ ...device, simulated: false });
  });
}
