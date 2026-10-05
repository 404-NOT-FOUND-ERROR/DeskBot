export interface DeskBotBodyCommand {
  command_id: string;
  type: string;
  status: string;
  requested_yaw_degrees?: number;
  acknowledged_at?: string | null;
  dispatched_at?: string | null;
  expires_at?: string;
  simulated?: boolean;
  hardware_verified?: boolean;
  verification_status?: 'verified'|'verification_missing'|'actual_yaw_out_of_range'|'actual_yaw_deviates_from_request'|'simulation'|'unverified_device_report';
  feedback_kind?: 'open_loop_report'|'measured';
  error_code?: string | null;
  error_message?: string | null;
  result?: { reported_yaw_degrees?: number; simulated?: boolean; measured?:boolean; measured_actual_yaw_degrees?:number } | null;
}

export interface DeskBotBodyTurn {
  turn_id: string;
  event_id: string;
  device_id: string;
  kind: string;
  observed_at: string;
  received_at: string;
  expires_at: string;
  perception_status: 'observed' | 'unsupported' | 'record_only' | 'cooldown';
  summary: string;
  response: { text: string; expression: string; intensity: number };
  execution_status: 'not_requested' | 'awaiting_queue' | 'queued' | 'dispatched' | 'acknowledged' | 'acknowledged_report' | 'failed' | 'unsupported' | 'suppressed' | 'simulation' | 'expired';
  execution_reason?:string;
  unsupported_outputs?:{type:string;reason:string}[];
  world_attention?:{status:'pending'|'chosen'|'expired';expires_at:string;decision:{at:string;selected:boolean;actor_id:string;plan_id:string|null;goal:string;location_id:string;text:string}|null};
  commands: DeskBotBodyCommand[];
  independent_evidence: false;
  direct_identity_change: false;
  simulated: boolean;
  hardware_verified: boolean;
  source_label: string;
}

export interface DeskBotBodyPerception {
  schema: 'deskbot.body-perception.v1';
  installed_at: string;
  revision: number;
  character_id: string;
  hardware: { camera: false; locomotion: false; yaw_degrees_of_freedom: 1; yaw_limit_degrees: number };
  attention: { kind: 'head_touch' | 'screen_touch'; observed_at: string; expires_at: string; device_id: string; turn_id: string } | null;
  last_sound_direction: { angle_degrees: number; coordinate_frame:'calibrated_forward'|'unknown_frame'; confidence:number|null; speaker_identity: 'unknown'; observed_at: string; expires_at: string; device_id: string; status: 'fresh' | 'stale' | 'uncertain' } | null;
  shell: { status: 'unknown' | 'recognized' | 'stale'; shell_id: string | null; label: string | null; last_known_shell_id: string | null; reason: string; observed_at: string; expires_at:string; device_id: string; hardware_verified:boolean } | null;
  yaw: { actual_degrees: number | null; reported_degrees:number|null; feedback_kind:'unknown'|'open_loop_report'|'measured'; last_ack_at: string | null; device_id: string | null; status: 'unknown' | 'acknowledged_report' | 'measured' };
  turns: DeskBotBodyTurn[];
  connection?: {
    devices: { device_id: string; connected: boolean; transport: 'websocket'; simulated: boolean; capabilities: Record<string, boolean>; last_seen_at: string | null }[];
    hardware_verified: boolean;
  };
}

export const BODY_REVIEW_SCENARIOS = [
  { id: 'head_touch', name: '轻碰头顶', description: '头部触摸输入，屏幕表达与回执。' },
  { id: 'screen_touch', name: '点一下屏幕', description: '触屏输入与可解释的回应。' },
  { id: 'sound_left', name: '从左边说话', description: '相对声源方向与单轴转头回执。' },
  { id: 'sound_right', name: '从右边说话', description: '另一侧声源方向，仍不推断用户身份。' },
  { id: 'unknown_shell', name: '无法识别的壳', description: '保持壳身份不确定，不凭读数编造形态。' },
  { id: 'registered_shell', name: '已登记的壳', description: '按登记信息识别壳，保留输入来源。' },
  { id: 'failed_yaw', name: '转头执行失败', description: '显示设备失败回执，意图不算动作完成。' },
  { id: 'busy_sound', name: '忙着时听到声音', description: '呈现当前感知及反馈处置，保留实际工作状态。' },
] as const;
export type BodyReviewScenarioId = typeof BODY_REVIEW_SCENARIOS[number]['id'];
export interface BodyReviewRound { scenario_id: BodyReviewScenarioId; body: DeskBotBodyPerception }
