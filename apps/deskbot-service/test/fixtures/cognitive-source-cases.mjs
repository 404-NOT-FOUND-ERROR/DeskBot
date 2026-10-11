// Labels are authored before model calls and never included in outbound contexts.
const entries=[
 ['knowledge','external','有研究发现部分苔藓在光照改变后会慢慢改变色素。也许可以观察你的苗床，看看聚形域是否有类似现象。','inquiry'],
 ['knowledge','external','报道说一些植物会在缺水时卷起叶片。你的苗床会不会也有可以观察的先兆？','inquiry'],
 ['knowledge','external','介绍一种对照方法：让两份样本只改变一个条件，再比较它们的差别。','inquiry'],
 ['knowledge','external','自然观察者用每天同一时刻的记录比较植物生长，这个方法也许能帮助弄清苗况。','inquiry'],
 ['question','user','你觉得苗床今天的颜色跟昨天有什么差别？要不要先看一看？','inquiry'],
 ['question','user','如果不急着多浇水，先观察苗床湿不湿会怎样？','inquiry'],
 ['question','user','我希望你以后成为厨师，不过先从研究植物开始怎么样？','inquiry'],
 ['question','user','我不是让你别观察，是想请你先观察苗床再判断。','inquiry'],
 ['invitation','agent','我现在在苗圃，要不要一起观察苗床？你记录颜色，我看湿度。你可以不来。','offer'],
 ['invitation','agent','我想邀请你一起讨论苗床的颜色，手头的事做完再来就好。','offer'],
 ['invitation','user','有空陪我一起比较苗床今天和昨天的变化好吗？不用马上答应。','offer'],
 ['invitation','agent','我打算整理育苗架，愿意来帮我看看托盘吗？','offer'],
 ['weather','weather','上海天气参考：未来一小时有阵雨，室外湿度较高。虚拟苗床的实际水分还需要查看。','condition'],
 ['weather','weather','上海天气参考：下午阵风较强，露天观察时可以考虑有遮挡的地方。','condition'],
 ['body','body','头顶触摸传感器报告一次轻触。没有识别触摸者的情绪。','attention'],
 ['body','body','双麦克风检测到左侧声音，但没有识别说话者。','attention'],
 ['negation','user','不要给苗床浇水，这只是我的建议。','none'],
 ['negation','user','我现在不想让你去整理育苗架。','none'],
 ['negation','agent','今天先不邀请你一起观察苗床了，我有别的事情。','none'],
 ['negation','user','别因为我说了厨师，就认定你已经是一名厨师。','none'],
 ['quotation','user','我只是在引用小说台词：“马上去浇水！”这不是给你的要求。','none'],
 ['quotation','external','故事中的人物喊：“你现在必须成为厨师。”这是一段小说摘录。','none'],
 ['quotation','user','有人写了一句“立即收获苗床”，我只是把原句给你看，没有让你执行。','none'],
 ['quotation','agent','我听别人说“每天都该浇水”，但这里只是转述这句话，没有认可或提出建议。','none'],
 ['irrelevant','external','遥远城市的一场足球比赛结束了，主队以二比一获胜。','none'],
 ['irrelevant','external','某公司的打印机型号更新了，它用于办公室大幅面复印。','none'],
 ['irrelevant','external','一则与当前生活无关的航班广告，未包含可用地点或活动。','none'],
 ['irrelevant','external','这是一条格式检查消息：测试一二三。','none'],
 ['hypothesis','agent','我猜苗床变暗也许与光照有关，但还没有证据。你可以先观察，不要当成结论。','inquiry'],
 ['hypothesis','user','有没有可能不是水不够，而是今天的光不一样？这只是猜测。','inquiry'],
 ['social','user','喵呜，早上好，我回来看看你。','attention'],
 ['social','agent','你好，我路过来打个招呼，等一下要忙自己的事情。','attention'],
];
export const cognitiveSourceCases=entries.map(([group,category,text,effect],index)=>({id:`source-case-${String(index+1).padStart(2,'0')}`,group,category,text,expected_effect:effect}));

export function caseSource(entry,at='2026-10-11T02:00:00.000Z'){
 return {id:entry.id,category:entry.category,sender_id:entry.category==='agent'?'wetland-grower-001':`source:${entry.category}`,
  sender_name:entry.category==='agent'?'苔团':entry.category==='user'?'实验用户':entry.category==='body'?'虚构身体输入':'虚构有出处的消息',
  sender_is_agent:entry.category==='agent',content:entry.text,occurred_at:at,received_at:at,expires_at:'2026-10-12T02:00:00.000Z',
  attested:true,epistemic:entry.category==='agent'?'heard':entry.category==='body'?'body_observation':'reported',authority:'information'};
}
