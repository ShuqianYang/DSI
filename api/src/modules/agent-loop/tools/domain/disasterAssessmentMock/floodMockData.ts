export const FLOOD_DEFAULT_REGION = "湖南石门县";

export const FLOOD_BRIDGE_LNG = 110.89457167309149;
export const FLOOD_BRIDGE_LAT = 29.881490688312095;

export const FLOOD_CENTER_LNG = 110.894662;
export const FLOOD_CENTER_LAT = 29.881476;

export const FLOOD_RECT = {
  west: 110.89344101467812,
  south: 29.880513149375275,
  east: 110.89603739300453,
  north: 29.88216900048024,
} as const;

export const FLOOD_BOUNDS = [
  [FLOOD_RECT.west, FLOOD_RECT.south],
  [FLOOD_RECT.east, FLOOD_RECT.south],
  [FLOOD_RECT.east, FLOOD_RECT.north],
  [FLOOD_RECT.west, FLOOD_RECT.north],
  [FLOOD_RECT.west, FLOOD_RECT.south],
] as [number, number][];

export const FLOOD_PRE_LOCAL_IMAGE_URL = "/local-tiles/pre_flood.png";
export const FLOOD_POST_LOCAL_IMAGE_URL = "/local-tiles/post_flood.png";

export const FLOOD_PRE_QUERY_DATA_PAYLOAD = {
  pageNo: 1,
  pageSize: 10,
  satelliteName: "高分五号A星",
  payloadType: ["可见光"],
  productType: "目标切片",
  dataType: "洪水前",
  targetType: "洪水前",
  reqObj: "天元认知计算",
  reqContent: "接收到天元认知计算系统的历史影像查询(洪水)需求，完成影像检索并反馈",
} as const;

export const FLOOD_LABEL_NAME_MAP: Record<string, string> = {
  bridge_washout: "桥梁主体冲毁",
  bridge_debris_in_water: "桥面碎片漂流",
  approach_road_cut: "桥头连接处冲断",
  road_overtopped: "道路淹没",
  new_inundation_area: "新增淹没区",
  building_exposure_flood_edge: "建筑临水风险",
  high_turbidity_floodwater: "高浊度洪水覆盖",
  unaffected_road_negative_sample: "未受灾道路",
};

export const FLOOD_SEVERITY_MAP: Record<string, { level: string; color: string }> = {
  high: { level: "severe", color: "#DC2626" },
  medium: { level: "moderate", color: "#2563EB" },
  none: { level: "none", color: "#22C55E" },
};
