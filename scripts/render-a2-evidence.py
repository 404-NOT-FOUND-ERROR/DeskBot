"""Render a static chart from the executed A2 fixture, with no invented metrics.

Optional documentation tool: Python + Pillow; use --font for a CJK font on other
platforms. Not a screenshot, not a model experiment and not a CI dependency.
"""
import argparse
import json
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from PIL import Image, ImageDraw, ImageFont

parser=argparse.ArgumentParser()
parser.add_argument('--font',default='C:/Windows/Fonts/msyh.ttc')
parser.add_argument('--report',default='research/experiments/a2-lifecycle-2026-11-01/report.json')
parser.add_argument('--out',default='documentation/images/a2-2026-11-01/goal-continuity.png')
args=parser.parse_args()
report=json.loads(Path(args.report).read_text(encoding='utf-8'))
W,H=1440,1170
im=Image.new('RGB',(W,H),'#f4f1e8');d=ImageDraw.Draw(im)
ink='#1c3244';muted='#5b6b75';blue='#326883';green='#22634d';amber='#93601f'
font=lambda n:ImageFont.truetype(args.font,n)
def text(x,y,s,n=24,color=ink):d.text((x,y),str(s),font=font(n),fill=color)
def box(x,y,x2,y2,fill,outline=None):d.rounded_rectangle((x,y,x2,y2),radius=16,fill=fill,outline=outline,width=2)
text(64,40,'DESKBOT  /  A2  /  执行证据',23,blue)
text(64,88,'同一件事，可以等一晚，也可以换办法',44)
text(64,158,'隔离规则样本 · 人为编排行为 · 真实任务执行与 SQLite 恢复 · 模型调用 0 次',23,muted)
box(64,212,1376,340,'#1c3244')
text(94,235,'始终保留：goal:a2-water',23,'#9ddac0')
text(94,276,'目标：备好一批自用清水',32,'#ffffff')
text(860,238,'1 个目标 ID  /  1 份完成标准',24,'#ffffff')
text(860,281,'换方法，不换目标，不补造结果',23,'#c6d6dc')
text(112,370,'发生了什么',22,muted);text(702,370,'目标状态',22,muted)
text(922,370,'结果证据',22,muted);text(1110,370,'随身清水',22,muted)
status={'active':('进行中',blue),'postponed':('暂缓',amber),'completed':('已完成',green)}
for i,r in enumerate(report['rows']):
    y=418+i*84
    if i%2==0:box(64,y-6,1376,y+68,'#fffdf7')
    if i<len(report['rows'])-1:d.line((89,y+30,89,y+107),fill='#c2c9c4',width=3)
    d.ellipse((81,y+18,97,y+34),fill=green if r['evidence_ids'] else blue)
    text(112,y,r['label'],24)
    dt=datetime.fromisoformat(r['at'].replace('Z','+00:00')).astimezone(ZoneInfo('Asia/Shanghai'))
    text(112,y+34,dt.strftime('%m-%d %H:%M')+'  上海时间',18,muted)
    label,color=status[r['lifecycle_status']]
    if r['review_due']:label+=' · 到期复查'
    text(702,y+14,label,23,color)
    text(950,y+14,len(r['evidence_ids']),26,green if r['evidence_ids'] else muted)
    d.rounded_rectangle((1112,y+21,1272,y+38),radius=8,fill='#dce5e2')
    if r['water']:d.rounded_rectangle((1112,y+21,1112+min(160,r['water']*40),y+38),radius=8,fill='#4f9eae')
    text(1293,y+7,r['water'],28,blue)
box(64,1034,1376,1110,'#e0e9df')
text(90,1055,'核验：13 小时后未失败  ·  方法确已更换  ·  只产出 4 份水  ·  重启后仍只有 1 次执行',24,green)
text(64,1128,'数据：research/experiments/a2-lifecycle-2026-11-01/report.json  ·  不代表自然跨日或真实模型验收通过',18,muted)
out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True);im.save(out,optimize=True)
print(out.resolve())
