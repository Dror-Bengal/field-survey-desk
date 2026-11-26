import type { GeoPoint } from '../db/types.js';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface FlagInput {
  clientGeo: GeoPoint | null;
  clientAccuracyM: number | null;
  clientTs: Date;
  serverTs: Date;
  workingSettlementGeo: GeoPoint | null;
  workingSettlementCodes: string[];
  voterPollingCode: string | null;
}

const FAR_THRESHOLD_M = 5_000;
const LOW_ACCURACY_M = 100;
const CLOCK_SKEW_MS = 60_000;

export function computeFlags(i: FlagInput): string[] {
  const flags: string[] = [];
  if (!i.clientGeo) flags.push('no_gps');
  if (i.clientAccuracyM !== null && i.clientAccuracyM > LOW_ACCURACY_M) {
    flags.push('gps_low_accuracy');
  }
  if (i.clientGeo && i.workingSettlementGeo) {
    const d = haversineMeters(i.clientGeo.coordinates, i.workingSettlementGeo.coordinates);
    if (d > FAR_THRESHOLD_M) flags.push('far_from_settlement');
  }
  if (
    i.voterPollingCode &&
    i.workingSettlementCodes.length > 0 &&
    !i.workingSettlementCodes.includes(i.voterPollingCode)
  ) {
    flags.push('voter_polling_mismatch');
  }
  if (Math.abs(i.clientTs.getTime() - i.serverTs.getTime()) > CLOCK_SKEW_MS) {
    flags.push('clock_skew');
  }
  return flags;
}
