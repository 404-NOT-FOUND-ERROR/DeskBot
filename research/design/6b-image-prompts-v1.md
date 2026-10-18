# 6B 生图提示词与来源




2026-10-12 · 使用内置 image_gen；未使用 CLI。五张选用图为意向参考，不代表已完成界面、3D 模型、物理规则或制造图。补充扩展总图说明全镇与首区的尺度关系，最初的风语林图改为局部近景参考。

参考来源：项目已发布的 `documentation/images/shaping-field-2026-10-05/live-ui.jpg`；后续参考图之间的派生关系如下。完整提示词原样留存，实际图片需经人工造型、材质、模型与状态实现。

后续用户确认继续沿用现有 low poly。这些图的细节密度偏高，仅取空间、配色、轮廓与状态方向；正式样板使用简洁几何、有限材质和局部动效。实际 Three.js 场景截图与性能测量先验收，再批量制作，不承诺逐件复刻生图里的植被和纹理。

## region windleaf-grove-overview-v1.png（局部生活空间）

图片：[windleaf-grove-overview-v1.png](../../documentation/images/6b-design-2026-10-12/windleaf-grove-overview-v1.png)

生成方式：新图，无输入图片。根据现有项目的风格观察编写视觉描述。

```text
Use case: stylized-concept.
Asset type: DeskBot 6B environment art direction reference, NOT a screenshot or already implemented feature.
Primary request: create a polished 16:9 landscape isometric 3D concept of 风语林 (Whisperleaf Grove), a first expansion area in 聚形域 / The Shaping Field, a fantastical companion world inhabited by condensed light-particle beings. The visual language is an achievable refined low-poly game scene: soft faceted trees, simple modeled roofs, rounded chunky forms, gently textured wood and stone, soft ambient occlusion, legible paths, miniature toy scale. Inspired by the existing project's muted mint green terrain, pale paths, teal water, red/brown tiny roofs; improve richness without changing to realistic fantasy painting.
Scene: one continuous grounded terrain neighborhood, visibly connected to a small familiar town at one edge, with three interconnected subareas. A sheltered low forest clearing has softly glowing translucent leaf surfaces, moss, a small resting seat and observation stones. A breezy ridge has a modest open wooden work shelter, handmade light-leaf collection frames with two different fabric shutters, cloth tabs showing wind direction, a shallow rain catcher and a repair stool. A return/meeting platform has a small shared wooden worktable, labeled-by-shape specimen trays, baskets, spare tools and two residents calmly exchanging materials. Distinct usable walking paths connect all three and return to the town; no floating isolated island.
Show quiet ongoing life: a few fallen luminous leaves lodged on a handmade rack, one repaired patch on fabric, worn footprints on paths, organized tools after work. A small virtual Miaowu near one rack: rounded black circular screen-face with two pale cyan eyes, pale ceramic-like head and short body, modest initial cat ears; not a finalized character design. Two tiny different light-particle residents provide scale, not a crowd.
Lighting: late afternoon warm sun through canopy, understated amber and cyan particles localized around leaves and created objects. Forest greens, sage, warm ivory, cedar brown and small terracotta accents; only selective glow. Strong silhouette hierarchy, readable terrain heights and functional objects; camera is isometric 3/4 looking down, moderate perspective, full environment comfortably framed.
Constraints: no text, no UI, no watermark, no castles, no giant portal, no neon cyberpunk, no dense particle fog, no combat, no extravagant unbuildable twisting geometry. Keep the familiar low-poly warmth and grounded daily living. This is a buildable environment direction for later Three.js modeling.
```

## ui daily-life-ui-v1.png

图片：[daily-life-ui-v1.png](../../documentation/images/6b-design-2026-10-12/daily-life-ui-v1.png)

生成方式：以项目 live-ui.jpg 为编辑目标，以区域总览为场景与风格参考。

```text
Use case: ui-mockup.
Asset type: high-fidelity desktop web app visual direction for DeskBot 6B.
Input image 1 is the existing live UI screenshot to redesign; input image 2 is the new Windleaf Grove environment concept for the world viewport. Produce a full flat app screen, 16:9 landscape, not a computer-on-a-desk photograph.
Primary request: improve the existing cozy Shaping Field companion-world UI into a polished, calm everyday living interface. Preserve a large interactive 3D world viewport, practical map controls, a recognizable Miaowu companion panel and ALWAYS visible chat composer. Use the second image's buildable toy low-poly forest area inside the viewport. This is an intention reference, not an implemented screenshot.
Layout: slim restrained top bar with brand at left, location breadcrumb, local time and weather at right. World viewport takes roughly 74% of the content width and most height. One compact warm-white companion panel on the side occupies remaining width, with generous padding and clear short hierarchy. At bottom of world area there is an anchored chat bar, not a blocking modal. A small unobtrusive location chip and compact zoom/reset controls hover over the world. No huge headline, no developer dashboard, no wall of cards, no modal covering the world, no fake progress percentages.
Art direction: refined warm ivory paper background, deep forest-green typography, pale sage separators, soft 16px corner radius, very light shadows, small amber and teal accents aligned with the world light. Clean Chinese sans-serif UI labels, a restrained editorial serif only for the brand/title. Crisp readable screen design with consistent grid and spacing. The illustrated forest should stay within its viewport and not be used as the entire interface background.
Visible Chinese text, render these verbatim and use only this concise copy:
Brand: "聚形域"
Breadcrumb: "雾灯镇 / 风语林"
Weather/time: "上海 · 16:20 · 微风"
Companion title: "喵呜"
Status: "在风口棚"
Tabs: "此刻" "牵挂" "朋友" "回顾" with "此刻" active.
Main statement: "复看昨天的光叶架"
Support: "风小了，我想看看纹路有没有变化。"
A small memory item: "昨天留下的"
Memory sentence: "修好的布片，还系在架子上。"
A small follow-up item: "接下来"
Follow-up sentence: "记录一次，再决定要不要换位置。"
A subtle link: "看看这件事的经过"
Chat placeholder: "和喵呜说说话，也可以问问他在忙什么…"
Send button: "发送"
Tiny corner caption: "6B 意向稿"
World props reflect one real-state-inspired ongoing activity: a resident inspecting the same installed collection frame, tied cloth patch, tools laid nearby, a few local glowing leaves, readable paths. Miaowu is the same small pale toy with round black screen face and two cyan eyes as in image 2. Keep imaginative life legible and quiet, no game quest HUD, no inventory grind, no coins/XP, no tech debug IDs/tokens/API labels.
```

## assets windleaf-modular-assets-v1.png

图片：[windleaf-modular-assets-v1.png](../../documentation/images/6b-design-2026-10-12/windleaf-modular-assets-v1.png)

生成方式：以区域总览为参考，重新组织为六组模块资产意向。

```text
Use case: stylized-concept.
Asset type: game environment modular asset art-direction sheet for DeskBot 6B.
Input image: reference for the palette, materials and handmade forest objects. Transform the reference's objects into a clean 16:9 landscape modeling concept board on warm ivory, six evenly spaced cells with large legible isolated isometric 3D objects. This is visual reference for subsequent Three.js modeling, not actual model files and not manufactured hardware.
Style: simplify to achievable refined low-poly geometry, broad faceted shapes, rounded edges, sparse hand-crafted texture accents; lower detail than the reference panorama. Warm cedar wood, sage green canvas, cream cloth, pale stone, selective warm cyan/amber glow. Consistent camera, scale and soft contact shadows. Show functional hinges and cloth edges clearly.
Six cells:
A: a small freestanding light-leaf collection frame, rectangular timber supports, removable specimen tray and pivoting cloth shutter; show the same frame in three states: open, half-closed, visibly patched with a tied repair seam. No elaborate machinery.
B: a modest open work shelter with four posts and a shallow wood roof, one compact workbench, two stools, a wind ribbon on a short pole, stored spare cloth and tools; plain modeled boards and repeated parts.
C: a small communal return table on a low wooden platform, two removable specimen trays, one wicker basket, a carry satchel and a folded note tied to one tray; attractive used but orderly daily-life traces.
D: three reusable low-poly tree silhouettes plus one mossy rock and a cluster of translucent glowing leaf shapes. Broad facet canopy masses, instancing-friendly repeated pieces, no dense individual botanical microgeometry.
E: a small warm lantern integrated with a path marker or rail, same object lit and extinguished. The OFF state is visibly unlit, no decorative glow. This provides later night-state modeling reference.
F: a plain narrow footbridge section, one branching path tile, a step module and a shallow stone rain-catching basin with dry and rain-filled states; transparent shallow blue-green water surface, no huge waterfall.
Labels: only neat small letters A, B, C, D, E, F, no other text. No character turnarounds, no complex castle, no realism, no UI mockup, no floating particles hiding geometry, no glowing entire screen. Give all props generous negative space, no cropping. Emphasize buildable shape vocabulary and clearly visible state changes.
```

## states windleaf-day-dusk-rain-v2.png

图片：[windleaf-day-dusk-rain-v2.png](../../documentation/images/6b-design-2026-10-12/windleaf-day-dusk-rain-v2.png)

生成方式：以区域总览为参考制作三状态对照；随后修正 DAY 面板误亮的路灯。

```text
Use case: lighting-weather.
Asset type: DeskBot 6B environment-state direction board, three-panel horizontal triptych.
Edit the attached Windleaf Grove reference into a 16:9 landscape comparison board showing THE SAME SMALL SCENE and camera in all three panels. Use a closer readable crop of the work shelter, two light-leaf collection frames, rain-catching basin and path-side lantern from the original. Keep object placement, terrain, timber shapes, frame patch and tied repair seam identical between panels. Consistent refined low-poly miniature-game rendering, warm cream thin dividers.
Panel A labelled only "DAY": soft clear late-afternoon daylight, gentle wind moves just the ribbon and cloth edge, all artificial lanterns explicitly OFF with dark unlit interiors. Leaf glow subtle and localized, warm sun is the dominant light. Tools are in use, basin shallow/dry.
Panel B labelled only "DUSK": same scene blue-gold dusk, workshop lamp and nearby working-area lamp warmly ON because the work shelter is still being used. Local leaf tracery softly glows, calm cool surroundings. Same visible patch on collection frame, moderate cloth tilt. Clear readable contrast, not overexposed.
Panel C labelled only "MIDNIGHT / RAIN": same scene with blue-green rainy midnight. Shelter work is finished, tools stored and a protective cloth pulled over one tray. Workshop lamp and work-area lamp OFF; exactly one small route-safety lantern remains dim warm, not all lights glowing. Gentle rain streaks, visibly wet wood, shallow puddles and basin holding collected rainwater. Leaf glow weaker than dusk, wind ribbon and collection shutter react to stronger wind but structure remains standing. A calm living-world atmosphere, not disaster or combat.
The contrast must show functioning-state-driven lighting, stored belongings, wind response, surface wetness and water changes. Night is not a flat black overlay. No relocation of buildings, no new invented giant light sources, no new residents, no excessive particles, no slogans, no extra text, no watermark. This is a visual intention comparison for future state-driven scene modeling, not a claim these mechanics are implemented.
```

最终定向修正提示词：

```text
Edit the attached three-panel environment lighting board with ONE precise correction. Keep the camera, geometry, labels, colors, all props, all three panels, and the DUSK and MIDNIGHT / RAIN panels unchanged.
In the top DAY panel only, the foreground path lantern near the lower-left corner is incorrectly glowing orange. Turn this lantern completely OFF: dark charcoal interior and non-emissive clear/dark glass, no glowing orange fill, no light spill on the post or ground. The daylight sun remains unchanged, so the surrounding forest stays warm and bright. The work-shelter hanging lantern in this DAY panel must also stay off.
Do not alter the middle panel's lit workshop lamp or the bottom rainy midnight panel's single dim route-safety lantern. No added text or new objects. Exact same composition and high-quality low-poly reference rendering, correcting only the artificial lantern state in the DAY panel.
```

## world-scale shaping-field-expanded-overview-v1.png

图片：[shaping-field-expanded-overview-v1.png](../../documentation/images/6b-design-2026-10-12/shaping-field-expanded-overview-v1.png)

生成方式：以既有完整镇区 live-ui.jpg 为尺度与几何风格参考，以风语林近景为局部设施参考。新总图表达保留整个镇区、扩展林地及水岸方向；没有承诺图中全部楼栋、桥梁、水磨坊、浅滩都已注册或会按图逐件制作。当前生图的树木与地表细节仍比运行资产预算密集，制作时按层级减少。

```text
Use case: stylized-concept.
Asset type: DeskBot 6B expanded world-scale environment reference, supplementary to a previously generated close-up, NOT an implemented screenshot.
Input image 1: reference for the current WHOLE town, its scale, many blocks, roads, building shapes and low-poly game style; remove its UI in this new image. Input image 2: reference for the detailed Windleaf Grove living sites; that close-up is only a small part of the new world, never the entire world.

Primary request: draw a much more zoomed-out, wide 16:9 isometric regional map for 聚形域 / The Shaping Field, showing a substantial existing town retained intact in character and scale plus spacious connected natural fantasy regions. This is a mainland landscape extending beyond the frame, not a tiny isolated diorama or floating island. The current town must remain a sizable urban neighborhood with approximately 35-45 low-poly homes and civic/workshop buildings in multiple street blocks, a central square, market stalls, nursery crop plots, residential lanes, materials workshop and waterside meeting spaces. The town occupies roughly 40 percent of the visible inhabitable land and should still feel like the existing complete town, not just three houses beside a grove.

New surrounding landscape: a broad Windleaf Grove occupying roughly another 40 percent of the inhabitable land, including several forest patches, open meadows, low ridges and a stream; distinct usable paths make loops and connect it to the town at two transition points. The three small living clusters from image 2 — sheltered leaf-observation clearing, ridge work shelter with collection racks, and shared return platform — are scattered within that broader forest and occupy only a small portion of it. Keep these legible, separated by meaningful travel distance, with simple terrain, paths, small bridges and resting spots. Preserve the forest's everyday creative life with small glowing leaf accents, tools and persistent handmade objects; no giant magical centerpiece. A connected river corridor follows the town boundary and opens into a luminous shallow wetland on the far side, with low reed beds, accessible shoreline and a few wooden observation platforms. This wetland is a later expansion direction. Distant softened hill and star-reflection landform silhouettes imply room for future development, without showing finished new settlements.
Show about six very tiny residents as scale cues, not character portraits. No monsters or combat.

Style: coherent buildable refined low-poly 3D game environment, warm ivory walls, muted terracotta and blue roofs, sage and mint green land, chunky faceted trees, restrained light-leaf tracery, teal water, simple modular timber forms. Match image 1's readable geometry while adding image 2's terrain layers and useful props. Preserve airy spaces and road readability at this distant camera; do not copy image 2's dense realistic vegetation or fill the entire world with dense tiny flowers.
Composition: a clear world-scale aerial isometric overview with both the full town and new forest visible together at the SAME consistent object scale; water corridor connects them, no disconnected mini islands. Broad navigation corridors, multiple loops, readable neighborhood structure. Soft afternoon lighting and ambient occlusion. Beautiful and grounded fantastical daily living, detailed enough to show different livelihoods.
Constraints: no text, no labels, no UI, no watermark, no castle, no cyberpunk, no giant portal, no thick particle fog, no collapsed town scale, no town replaced by one tiny courtyard. Do not imply every distant region is already implemented. New map image, not a 3D model file.
```
