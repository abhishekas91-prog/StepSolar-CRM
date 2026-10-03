function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function rad(d) {
  return (d * Math.PI) / 180;
}

export function sunPosition(lat, dayOfYear, hour) {
  const decl = 23.44 * Math.sin(rad((360 * (284 + dayOfYear)) / 365));
  const ha = 15 * (hour - 12);
  const sinAlt = Math.sin(rad(lat)) * Math.sin(rad(decl)) + Math.cos(rad(lat)) * Math.cos(rad(decl)) * Math.cos(rad(ha));
  const altitude = (Math.asin(clamp(sinAlt, -1, 1)) * 180) / Math.PI;
  const cosAz = (Math.sin(rad(decl)) - Math.sin(rad(lat)) * Math.sin(rad(altitude))) / (Math.cos(rad(lat)) * Math.cos(rad(altitude)) + 1e-9);
  let azimuth = (Math.acos(clamp(cosAz, -1, 1)) * 180) / Math.PI;
  if (ha > 0) azimuth = 360 - azimuth;
  return { altitude, azimuth, zenith: 90 - altitude };
}

export function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

export function sunDirection(lat, day, hour, distance = 70) {
  const { altitude, azimuth } = sunPosition(lat, day, hour);
  const alt = rad(Math.max(altitude, 2));
  const az = rad(azimuth);
  return [
    Math.sin(az) * Math.cos(alt) * distance,
    Math.sin(alt) * distance,
    Math.cos(az) * Math.cos(alt) * distance,
  ];
}

export function accessColor(v) {
  const t = clamp((Number(v) - 0.7) / 0.3, 0, 1);
  if (t < 0.5) {
    const u = t / 0.5;
    return [1, 0.45 + u * 0.4, 0.05];
  }
  const u = (t - 0.5) / 0.5;
  return [1 - u * 0.78, 0.85 + u * 0.05, 0.05 + u * 0.4];
}
