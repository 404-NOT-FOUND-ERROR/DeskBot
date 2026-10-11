import type {ReactNode} from 'react';
export interface ConversationLine {id:string;speaker:string;text:string;at?:string}
export function mergeConversation(saved:ConversationLine[],local:ConversationLine[]) {
 return [...new Map([...saved,...local].map(line=>[line.id,line])).values()].slice(-40);
}
export function Conversation({lines,expanded,onToggle,historyError,children}:{lines:ConversationLine[];expanded:boolean;onToggle:()=>void;historyError:string;children:ReactNode}) {
 return <section className="deskbot-conversation" aria-label="和喵呜说话">
  <div className="deskbot-conversation__head"><strong>和喵呜说话</strong><button type="button" aria-expanded={expanded} aria-controls="deskbot-conversation-history" onClick={onToggle}>{expanded?'收起记录':'展开对话记录'}</button></div>
  {expanded?<div className="deskbot-conversation__history" id="deskbot-conversation-history">
   {historyError?<p role="status">历史记录暂未读取：{historyError}。仍可发送新对话。</p>:null}
   {lines.length?<ol aria-live="polite" aria-relevant="additions text">{lines.map(l=><li key={l.id} className={l.speaker==='你'?'is-user':'is-character'}><strong>{l.speaker}</strong>{l.at?<time>{new Date(l.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})}</time>:null}<p>{l.text}</p></li>)}</ol>:<p>说说今天的事，或问问它在忙什么。已经完成的对话会保存在本地，刷新后可以接着看。</p>}
  </div>:null}
  {children}
 </section>;
}
