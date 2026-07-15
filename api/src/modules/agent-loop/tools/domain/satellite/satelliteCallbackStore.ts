/**
 * Waiters for legacy satellite slice callbacks.
 *
 * The legacy demand API returns a requirement id first, then posts the image
 * slice to /agent/callback/slice when the product is ready.
 */

export interface SatelliteSliceCallbackPayload {
  id?: string;
  satellite?: string;
  acquisition_time?: string;
  resolution?: number;
  source_image_id?: string;
  center_longitude?: number;
  center_latitude?: number;
  target_type?: string;
  confidence?: number;
  width?: number;
  height?: number;
  path?: string;
  url?: string;
  requirementId?: string;
  lon_ul?: number;
  lat_ul?: number;
  lon_ur?: number;
  lat_ur?: number;
  lon_ll?: number;
  lat_ll?: number;
  lon_lr?: number;
  lat_lr?: number;
}

type PendingCallback = {
  resolve: (payload: SatelliteSliceCallbackPayload) => void;
  reject: (error: Error) => void;
};

const pendingCallbacks = new Map<string, PendingCallback>();

export function registerSatelliteSliceCallback(requirementId: string): Promise<SatelliteSliceCallbackPayload> {
  return new Promise((resolve, reject) => {
    pendingCallbacks.set(requirementId, { resolve, reject });
  });
}

export function resolveSatelliteSliceCallback(
  requirementId: string,
  payload: SatelliteSliceCallbackPayload
): boolean {
  const pending = pendingCallbacks.get(requirementId);
  if (!pending) return false;
  pending.resolve(payload);
  pendingCallbacks.delete(requirementId);
  return true;
}

export function rejectSatelliteSliceCallback(requirementId: string, error: Error): boolean {
  const pending = pendingCallbacks.get(requirementId);
  if (!pending) return false;
  pending.reject(error);
  pendingCallbacks.delete(requirementId);
  return true;
}

export function cleanupSatelliteSliceCallback(requirementId: string): void {
  pendingCallbacks.delete(requirementId);
}
