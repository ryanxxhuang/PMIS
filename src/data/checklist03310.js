// 內建自主檢查表範本:場鑄結構用混凝土(依施工綱要規範第 03310 章)。
// 之後「上傳規範 AI 生成範本」落地後,此檔為第一個驗證樣板/離線後備。
// kind:'num' 依 min/max 自動判定;'bool' 勾選=合格。source=出處條文。

export const TEMPLATE_03310 = {
  key: 'builtin-03310',
  title: '場鑄結構用混凝土 自主檢查表',
  source: '施工綱要規範 第 03310 章 結構用混凝土',
  items: [
    // 澆置前
    { no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造單位並經同意', kind: 'bool', standard: '≥24 小時前通知', source: '3.1.1(3)' },
    { no: 'B2', group: '澆置前', item: '模板無積水、鋼筋無浮銹,預埋物定位固定', kind: 'bool', standard: '目視檢查', source: '3.1.1(2)' },
    { no: 'B3', group: '澆置前', item: '既有混凝土面已打毛、清潔並充分潤濕', kind: 'bool', standard: '目視檢查', source: '3.1.1(1)' },
    { no: 'B4', group: '澆置前', item: '施工縫面保持濕潤時數', kind: 'num', min: 12, unit: '小時', standard: '≥12 小時', source: '3.2.7(1)D' },
    { no: 'B5', group: '澆置前', item: '瀉槽坡度(V/H)', kind: 'num', min: 0.33, max: 0.5, unit: 'V/H', standard: '1/3 ~ 1/2', source: '3.1.2(3)B' },
    { no: 'B6', group: '澆置前', item: '象鼻管出口距澆置點距離', kind: 'num', max: 150, unit: 'cm', standard: '≤150 cm', source: '3.1.2(5)B' },
    // 澆置中
    { no: 'C1', group: '澆置中', item: '澆置時混凝土溫度', kind: 'num', min: 13, max: 32, unit: '℃', standard: '13~32 ℃', source: '3.2.2(9)' },
    { no: 'C2', group: '澆置中', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm', standard: '18 ± 2.5 cm(依配比設計)', source: '3.4.4' },
    { no: 'C3', group: '澆置中', item: '上下層澆置間隔', kind: 'num', max: 45, unit: '分', standard: '≤45 分鐘', source: '3.2.2(6)' },
    { no: 'C4', group: '澆置中', item: '澆置後開始振動時間', kind: 'num', max: 15, unit: '分', standard: '≤15 分鐘內', source: '3.2.4(5)' },
    { no: 'C5', group: '澆置中', item: '振動器頻率', kind: 'num', min: 7000, unit: '次/分', standard: '≥7,000 次/分', source: '3.2.4(4)' },
    { no: 'C6', group: '澆置中', item: '梁版振動棒插入支撐混凝土深度', kind: 'num', min: 8, max: 12, unit: 'cm', standard: '約 10 cm', source: '3.2.4(6)' },
    // 取樣與養護
    { no: 'D1', group: '取樣養護', item: '抗壓試體已依數量取樣(預拌每組 6 個)', kind: 'bool', standard: '<100m³ 1組;100~200m³ 2組…', source: '3.4.4、3.3.2(2)' },
    { no: 'D2', group: '取樣養護', item: '新拌混凝土氯離子含量', kind: 'num', max: 0.6, unit: 'kg/m³', standard: '≤0.6 kg/m³(一般 RC)', source: '3.4.4' },
    { no: 'D3', group: '取樣養護', item: '澆置後防天候保護天數', kind: 'num', min: 7, unit: '天', standard: '≥7 天', source: '3.6.2' },
  ],
}
