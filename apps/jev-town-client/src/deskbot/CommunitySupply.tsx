import type { DeskBotWorldMap } from './types.ts';
import { communitySupplyAt } from './communitySupply.ts';

export function CommunitySupply({ map, onPlace }: { map: DeskBotWorldMap | null; onPlace: (id: string) => void }) {
  const supply = communitySupplyAt(map);
  if (!supply) return null;
  const waiting = supply.needingMeal > 0 && supply.ready !== null && supply.ready < supply.needingMeal;
  return <section className={`life-block life-community${waiting ? ' life-community--waiting' : ''}`} aria-label="小镇当前食物与补给">
    <div className="life-row"><div><span className="deskbot-mode__eyebrow">大家的日常补给</span><h2>今天的饭，从哪里来</h2></div><span className="life-chip">{supply.population} 位生活者</span></div>
    <div className="life-community__portions"><button type="button" onClick={() => onPlace('warm-pot-courtyard')}><strong>{supply.ready ?? '—'}</strong><span>长桌可取 · 份</span></button><div><strong>{supply.carried}</strong><span>随身带着 · 份</span></div><div><strong>{supply.needingMeal}</strong><span>等着吃饭 · 位</span></div></div>
    <p className="life-community__state">{supply.ready === null ? '长桌库存还没有接上，先看看大家正在做什么。' : waiting ? '长桌还不够，采收、做饭和送到桌边都需要时间。' : supply.needingMeal ? '桌边已有饭食，大家会按自己的需要前来。' : '这一刻大家暂时不急着吃饭，日常还在继续。'}{supply.eating ? ` ${supply.eating} 位正在用餐${supply.heldMeals > supply.heldPausedMeals ? `，${supply.heldMeals - supply.heldPausedMeals} 份已经留给这次用餐` : ''}。` : ''}{supply.heldPausedMeals ? ` 另有 ${supply.heldPausedMeals} 份饭食已预留，对应用餐暂时停下。` : !supply.eating && supply.heldMeals ? ` ${supply.heldMeals} 份饭食已经预留，等待实际用餐。` : ''}</p>
    <details className="life-community__details"><summary>食材与实际进展{ supply.work.length ? ` · ${supply.work.length} 件在办` : ''}</summary>
      <div className="life-community__ingredients"><button type="button" onClick={() => onPlace('moss-sprout-garden')}>架上苔芽 <strong>{supply.ingredients.moss ?? '—'}</strong> · 光果 <strong>{supply.ingredients.fruit ?? '—'}</strong></button><button type="button" onClick={() => onPlace('warm-pot-courtyard')}>灶边清水 <strong>{supply.ingredients.water ?? '—'}</strong></button>{supply.source ? <button type="button" onClick={() => onPlace('backlit-grove')}>林缘枝上光果 <strong>{Math.round(supply.source.quantity * 10) / 10}</strong>{supply.source.capacity !== null ? ` / ${supply.source.capacity}` : ''}<small>缓慢结实，还要实际采摘。</small></button> : null}</div>
      {supply.work.length ? <ul className="life-community__work">{supply.work.slice(0, 5).map(work => <li key={work.id}><span className={work.status === 'paused' ? 'is-paused' : ''} aria-hidden="true"/><div><strong>{work.name} · {work.status === 'paused' ? '暂时停下' : work.kind}</strong><p>{work.title}</p></div>{work.locationId ? <button type="button" onClick={() => onPlace(work.locationId!)}>看看 ↗</button> : null}</li>)}</ul> : <p className="life-community__empty">这一刻没有正在进行的采收、做饭或食材运输。</p>}
      {supply.needs.length ? <p className="life-community__names">惦记着吃饭：{supply.needs.map(person => person.name).join('、')}</p> : null}
    </details>
  </section>;
}
