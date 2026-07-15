export const EARTHQUAKE_DEFAULT_REGION = "广西柳州市柳南区";
export const EARTHQUAKE_MAGNITUDE = 5.2;

export const EARTHQUAKE_CENTER_LNG = 109.25982181039833;
export const EARTHQUAKE_CENTER_LAT = 24.366071571884453;

export const EARTHQUAKE_RECT = {
  west: 109.25894741025947,
  south: 24.36555725731195,
  east: 109.26069621053718,
  north: 24.366585886456956,
} as const;

export const EARTHQUAKE_BOUNDS = [
  [EARTHQUAKE_RECT.west, EARTHQUAKE_RECT.south],
  [EARTHQUAKE_RECT.east, EARTHQUAKE_RECT.south],
  [EARTHQUAKE_RECT.east, EARTHQUAKE_RECT.north],
  [EARTHQUAKE_RECT.west, EARTHQUAKE_RECT.north],
  [EARTHQUAKE_RECT.west, EARTHQUAKE_RECT.south],
] as [number, number][];

export const EARTHQUAKE_PRE_LOCAL_IMAGE_URL = "/local-tiles/pre_earthquake.png";
export const EARTHQUAKE_POST_LOCAL_IMAGE_URL = "/local-tiles/post_earthquake.png";

export const EARTHQUAKE_PRE_QUERY_DATA_PAYLOAD = {
  pageNo: 1,
  pageSize: 10,
  satelliteName: "高分五号A星",
  payloadType: ["可见光"],
  productType: "目标切片",
  dataType: "地震前",
  targetType: "地震前",
  reqObj: "天元认知计算",
  reqContent: "接收到天元认知计算系统的历史影像查询(地震)需求，完成影像检索并反馈",
} as const;

export const EARTHQUAKE_ASSESSMENT = {
  collapsedBuildings: 3,
  damagedBuildings: 17,
  blockedRoadSegments: 2,
  affectedObjects: ["居民建筑", "乡镇道路", "供电线路", "应急避难点周边"],
  riskLevel: "medium",
  advice: "建议优先核查震中周边居民点、道路通达性和供电线路，保持震后影像滚动更新。",
} as const;
