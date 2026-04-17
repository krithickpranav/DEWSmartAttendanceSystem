export interface GeoResult {
  allowed: boolean;
  distance: number;
  error?: string;
}

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

export async function checkGeoAccess(
  companyLat: number,
  companyLng: number,
  radiusMeters: number,
): Promise<GeoResult> {
  // If company location is at default (0,0), skip restriction
  if (companyLat === 0 && companyLng === 0) {
    return { allowed: true, distance: 0 };
  }
  try {
    const pos = await getCurrentPosition();
    const distance = haversineDistance(
      pos.coords.latitude,
      pos.coords.longitude,
      companyLat,
      companyLng,
    );
    return {
      allowed: distance <= radiusMeters,
      distance: Math.round(distance),
    };
  } catch {
    // Fail-closed: deny access if location is unavailable or permission denied
    return {
      allowed: false,
      distance: 0,
      error: "Location required. Please enable location access to check in.",
    };
  }
}
