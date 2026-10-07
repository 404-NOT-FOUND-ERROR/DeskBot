/** Closed, authored visual layers. A visual never grants inventory, anatomy or hardware abilities. */
export interface ShapingAppearance {
  schema:'deskbot.role-stage-appearance.v1';
  form:null|{direction_id:'wetland_frog';stage_id:string|null;figure_form:'leaf-frog';label:string;accessories:string[];palette?:{secondary:string;light:string}};
  vocation:null|{direction_id:'chef'|'workshop_maker';stage_id:string|null;figure_vocation:'chef'|'workshop-maker';label:string;accessories:string[]};
  anchors?:string[];identity_anchor?:unknown;physical_shell_changed:false;
}
export const SHAPING_ANCHORS=['seed-eyes','pear-shell','chest-pearl','stubby-feet','light-grains'] as const;
export function shapingAppearanceLayers(value:ShapingAppearance|null|undefined) {
  if(value?.schema!=='deskbot.role-stage-appearance.v1'||value.physical_shell_changed!==false)return {form:'base' as const,vocation:'none' as const};
  const form=value.form?.direction_id==='wetland_frog'&&value.form.figure_form==='leaf-frog'?'leaf-frog':'base';
  const vocation=value.vocation?.direction_id==='chef'&&value.vocation.figure_vocation==='chef'?'chef':value.vocation?.direction_id==='workshop_maker'&&value.vocation.figure_vocation==='workshop-maker'?'workshop-maker':'none';
  return {form,vocation};
}
export function shapingAppearanceKey(value:ShapingAppearance|null|undefined):string {
  const layers=shapingAppearanceLayers(value);
  return `${layers.form}:${value?.form?.stage_id??'base'}:${layers.vocation}:${value?.vocation?.stage_id??'base'}`;
}
export function shapingAppearanceLabel(value:ShapingAppearance|null|undefined):string {
  const layers=shapingAppearanceLayers(value);
  return [layers.form==='leaf-frog'?'荷叶青蛙':'初生光粒体',layers.vocation==='chef'?'灶边厨师':layers.vocation==='workshop-maker'?'工坊学徒':null].filter(Boolean).join(' · ');
}
