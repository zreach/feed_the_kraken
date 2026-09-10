# 规则覆盖矩阵

状态说明：✅已实现并验证 ｜ 🟡已实现，数据待核验 ｜ ⬜规划中（扩展内容，不随基础版交付）

资料依据代码：**R**=官方规则书 V1.0（funtails.de, 2021-06-01 英文版）｜**C**=官方角色卡 PnP（FR/GR/RU/DK，2022-04）｜**社区**=github.com/ahmedbasamadz/FeedTheKraken（仅地图拓扑与英文卡名对照）

## 1. 开局与组件

| 规则/组件 | 依据 | 实现位置 | 测试 | 状态 |
|---|---|---|---|---|
| 5-11 人，阵营配置表（含5人局3/1或2/2随机） | R P5/P7 | engine/state.ts assignFactions | setup.test ×7 人数 | ✅ |
| 每人3枪，供应区40把 | R P4 | state.ts / gunSupply | effects.test 枪手/军火库 | ✅ |
| 23张导航牌（长）/19张（快） | R P4/P6 | data/gamedata.ts | setup.test 牌数唯一 | ✅（快图🟡） |
| 5张邪教仪式牌洗混 | R P15 | state.ts cultRitual | effects.test 三种仪式 | ✅ |
| 停职牌数量（1/2/3按人数） | R P4/P6/P11 | engine applyOffDuty | effects.test 停职分配 | ✅ |
| The Crew 卡：哗变阈值 3/4/5 | R P9 | gamedata mutinyThreshold | setup/effect 多处 | ✅ |
| 22张角色牌，船长开局亮出另抽 | R P8 + C | state.ts 角色池 | setup.test 人数参数化 | ✅ |
| 海盗秘密集结互识 | R P8 | views.ts teammatesOf | 视图测试 | ✅ |
| 11人局邪教主与邪教徒互不相识 | R P8 | 同上（teammatesOf 仅邪教徒单向） | — | ✅ |
| 双面地图（快/长） | R P4/P6 + 用户照片 | data/maps.ts（快图22格转录；2026-09 修正蓝/红胜利链路，各5张同色） | setup.test 同色链路回归 + 结构/距离 | ✅（第4/5跳衔接待实体板复核） |

## 2. 回合流程

| 规则 | 依据 | 实现位置 | 测试 | 状态 |
|---|---|---|---|---|
| 任命：船长选副手+领航员，不可自任/重复/停职(除非无人) | R P9 | engine appointTeam/canAppoint | setup+e2e | ✅ |
| 忠诚质询：秘密出枪、同时揭示、计数 | R P9 | engine mutinySubmit/Reveal | setup.test | ✅ |
| 哗变成功：最多枪者为新船长（割舌按0枪） | R P10 | resolveMutinyOutcome | setup.test | ✅ |
| 平局链：现任船长开始轮流指定退出者 | R P10 | tiePick pending | setup.test 平局 | ✅ |
| 成功哗变弃揭示的枪；失败收回 | R P10 | cleanupMutiny | setup.test 枪数 | ✅ |
| 哗变后新船长重新任命 | R P10 | finishMutiny 清空职位 | fuzz+e2e | ✅ |
| 航海：船长/副手各抽2弃1，日志洗混，领航员弃1 | R P10 | engine doDraw→prepareLogbook | setup.test 守恒 | ✅ |
| 洗牌：抽牌堆<4时合洗弃牌堆，简历不回洗 | R P11 | ensureDeckForDraw | fuzz | ✅ |
| 醉酒：船长职顺时针移交给简历最少者 | R P14 | pickFewestResume | e2e 实测触发 | ✅ |
| 美人鱼：选人看最近3张弃牌（私密） | R P14 | doCardAction mermaid | e2e 触发 | ✅ |
| 望远镜：选人看牌堆顶，弃或放回 | R P14 | telescope pending | effects.test | ✅ |
| 武装/缴械（仅长图）：领航员±1枪 | R P14 | armed/disarmed | fuzz | ✅ |
| 邪教暴动：航海末揭示仪式牌 | R P14 | cultUprising→executeRitual | effects.test ×3 | ✅ |
| 停职移交：航海成功后按人数发牌；哗变后不发 | R P11 | applyOffDuty（哗变路径不调用） | effects.test | ✅ |
| 停职者不可被任命（人手不足除外）；可哗变可为船长 | R P11 | canAppoint | fuzz | ✅ |
| 拒令跳海：两牌弃掉、领航员出局、紧急航海循环 | R P12 | handleNavigatorCommand jumpShip | setup.test | ✅ |
| 紧急航海：可指定停职者、无质询、副手不变 | R P12 | emergencyNavigator | setup.test | ✅ |
| <3人存活：空缺职位随机代替决策 | R P12 | advance alive<3 分支 | fuzz | ✅ |
| 补给线（长图）：越线全员补至3 | R P12 | moveShip refillGuns | effects.test | ✅ |
| 终局：蓝湾/绯红湾/海妖之域/献祭邪教主 | R P8 | moveShip/endGame | effects.test ×2 + fuzz | ✅ |
| 邪教主跳海不能获胜 | R P12 | 引擎无此胜利路径 | fuzz | ✅ |

## 3. 地图行动（进格先于导航牌行动）

| 规则 | 依据 | 实现位置 | 测试 | 状态 |
|---|---|---|---|---|
| 舱室搜查：秘密看阵营；被搜者不可皈依 | R P13 | cabinSearch | effects.test 私密日志 | ✅ |
| 鞭刑：本人秘密声明+船长随机公开"非X" | R P13 | flogging | effects.test | ✅ |
| 割舌：不可为船长、定船长按0枪 | R P13 | offWithTongue + countedGunsForCaptain | e2e 实测触发 | ✅ |
| 献祭海妖：选他人出局；邪教主→邪教立即胜 | R P14 | feedTheKraken | effects.test ×2 | ✅ |

## 4. 邪教仪式

| 规则 | 依据 | 实现位置 | 测试 | 状态 |
|---|---|---|---|---|
| 皈依邪教（×3）：选可皈依者；舱搜/鞭刑者免疫 | R P15 | conversionToCult + isConvertible | effects.test | ✅ |
| 邪教军火库（×1）：秘密分3枪 | R P15 | gunsStash | effects.test | ✅ |
| 邪教舱搜（×1）：邪教主看航海组阵营 | R P15 | cult_cabin_search 私密日志 | effects.test | ✅ |
| 皈依后弃原阵营、随邪教胜败 | R P15 | faction='cultist' | fuzz | ✅ |

## 5. 角色牌（22/22 全部实现）

| 角色 | 时机 | 实现 | 专项测试 | 状态 |
|---|---|---|---|---|
| 船长 | 开局 | state.ts | setup.test | ✅ |
| 窃癖者 | 任意 | kleptomaniac | effects.test | ✅ |
| 捣乱者 | 枪揭示后 | troublemaker 翻倍 | effects.test | ✅ |
| 军械师 | 弃1枪启动 | gunsmith + cleanupMutiny | effects.test | ✅ |
| 和平使者 | 枪揭示后 | peacemaker | effects.test | ✅ |
| 枪手 | 任意 | gunslinger | effects.test | ✅ |
| 吟游诗人 | 任命后 | minstrel 排除 | effects.test | ✅ |
| 水手长 | 抽牌前 | bosun 互换 | effects.test | ✅ |
| 草药师 | 任命前 | herbalist 移交停职 | effects.test | ✅ |
| 瞭望员 | 任意 | lookout | effects.test | ✅ |
| 大战略家 | 枪揭示后 | master_strategist | effects.test | ✅ |
| 走私者 | 抽牌前 | smuggler 抽3 | effects.test | ✅ |
| 煽动者 | 任命后 | agitator 强制≥1；对被排除者无效 | effects.test | ✅ |
| 顾问 | 任命前 | consultant 指定副手 | effects.test | ✅ |
| 主厨 | 任命后 | chief_cook 移交+重任命 | e2e/fuzz | ✅ |
| 蛊惑者 | 枪揭示后 | rabble_rouser 减半取整 | effects.test | ✅ |
| 档案员 | 抽牌前 | archivist 重抽 | effects.test | ✅ |
| 导师 | 任意 | mentor 翻面可复用 | effects.test | ✅ |
| 通灵者 | 黄牌回合 | spiritualist 交枪链 | effects.test | ✅ |
| 讨债人 | 任命后 | debt_collector | fuzz 触发 | ✅ |
| 平权者 | 任命后 | equalizer 阈值1+限1枪 | effects.test | ✅ |
| 教唆者 | 枪揭示后 | instigator 加入/拒绝翻面 | effects.test | ✅ |

## 6. 信息安全（服务端权威）

| 要求 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| 玩家视图投影，他人阵营/手牌/角色永不下发 | engine/views.ts | effects.test 隐私 + e2e 隐私抽查 | ✅ |
| 私密日志（舱搜结果/邪教舱搜）只发对应玩家 | views visibility | effects.test | ✅ |
| 哗变提交保密，揭示后才公开 | mutiny.stage + mutinyPublic | e2e | ✅ |
| 命令服务端校验（座位/阶段/权限/数量/目标） | engine RuleError | 全部测试 | ✅ |
| 不可猜测会话凭据（24字节随机+盐哈希） | util newSessionToken | e2e 伪造token拒绝 | ✅ |
| 幂等：reqId 单调，重复/过期请求忽略 | rooms.lastReqBySeat | smoke+e2e | ✅ |
| 限速（命令/聊天/创建/加入） | index RateLimiter | — | ✅ |
| 生产无调试接口/改盘能力 | 无此类端点 | 代码审查 | ✅ |
| 房主不能看真人玩家秘密 | 权限仅来自 token 座位 | 视图过滤 | ✅ |
| 代打功能仅限机器人座位 | rooms.resolveBotSeat | 代码审查+e2e | ✅ |

## 7. 持久化与恢复

| 要求 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| 每次状态变更落盘（SQLite） | rooms.persist + store | e2e | ✅ |
| 服务重启恢复房间/对局/日志/会话 | loadFromStore | e2e 重启恢复 ✅ | ✅ |
| 恢复不重复执行随机结算 | 状态快照含牌堆/RNG序列化 | e2e + fuzz 种子 | ✅ |
| 存档版本标识 | SAVE_VERSION | — | ✅ |
| 房间过期清理（大厅12h/对局72h） | rooms.cleanup | — | ✅ |
| 备份=复制 data/ftk.db | README | — | ✅ |

## 8. 待核验 / 已知边界

| 项 | 影响 | 状态 |
|---|---|---|
| 快航程地图 | 已按用户提供的官方照片完成转录，19张牌启用，auto=5-7人快图；2026-09 按实测修正蓝/红胜利链路（各5张同色） | ✅（第4/5跳衔接待实体板复核） |
| 长航程地图出口表逐格核验 | 极小概率个别出口与实体板不符 | 🟡 图标分布已核对，拓扑来自社区逆向；仓库已有 maptile_* 高清切图可核 |
| 规则书未明说的裁决（10条） | 见 RULES_NOTES.md §9，均记录取舍 | 🟡 已文档化 |
| 5-6人官方建议排除3角色 | 房间配置项 excludeSuggestedCharacters 已支持 | ✅ 可选 |
