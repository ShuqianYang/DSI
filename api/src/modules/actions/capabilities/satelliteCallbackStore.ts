/**
 * Satellite 切片回调等待存储
 *
 * satellite capability 提报需求后在此注册等待，
 * 回调路由到达后根据 requirementId 唤醒对应 Promise。
 */

export interface SliceCallbackPayload {
  id: string;
  satellite: string;
  acquisition_time: string;
  resolution: number;
  source_image_id: string;
  center_longitude: number;
  center_latitude: number;
  target_type: string;
  confidence: number;
  width: number;
  height: number;
  path: string;
  url: string;
  requirementId: string;
  lon_ul?: number;
  lat_ul?: number;
  lon_ur?: number;
  lat_ur?: number;
}

type PendingCallback = {
  resolve: (data: SliceCallbackPayload) => void;
  reject: (err: Error) => void;
};

const pendingCallbacks = new Map<string, PendingCallback>();

export function registerSliceCallback(requirementId: string): Promise<SliceCallbackPayload> {
  return new Promise((resolve, reject) => {
    pendingCallbacks.set(requirementId, { resolve, reject });
  });
}

export function resolveSliceCallback(requirementId: string, payload: SliceCallbackPayload): boolean {
  const pending = pendingCallbacks.get(requirementId);
  if (!pending) return false;
  pending.resolve(payload);
  pendingCallbacks.delete(requirementId);
  return true;
}

export function rejectSliceCallback(requirementId: string, err: Error): boolean {
  const pending = pendingCallbacks.get(requirementId);
  if (!pending) return false;
  pending.reject(err);
  pendingCallbacks.delete(requirementId);
  return true;
}

export function cleanupSliceCallback(requirementId: string): void {
  pendingCallbacks.delete(requirementId);
}
