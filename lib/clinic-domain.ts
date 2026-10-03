export function normalizePhone(s: string): string {
  return String(s)
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/\s/g, '')
    .replace(/^\+20/, '0');
}

export function cairoDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function cairoInstant(date: string, time: string): string {
  const target = Date.parse(date + 'T' + time + ':00Z');
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      })
      .formatToParts(new Date(instant))
      .map(p => [p.type, p.value])
    );
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    instant += target - local;
  }
  return new Date(instant).toISOString();
}

export function formatTime(value: string | Date): string {
  const raw = String(value ?? '');
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const date = match 
    ? new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])))
    : new Date(value);
    
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: match ? 'UTC' : 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12'
  }).format(date);
}

export function availableSlots(
  clinic: { opens: string; closes: string },
  service: { duration_minutes: number; active: boolean },
  date: string,
  bookings: Array<{ status: string; scheduled_at: string; duration_minutes: number }> = [],
  now: number = Date.now()
): string[] {
  if (!service?.active) return [];
  const [oh, om] = clinic.opens.split(':').map(Number);
  const [ch, cm] = clinic.closes.split(':').map(Number);
  const duration = Number(service.duration_minutes);
  const result: string[] = [];

  if (!Number.isFinite(duration) || duration < 5) return result;

  for (let minute = oh * 60 + om; minute + duration <= ch * 60 + cm; minute += 5) {
    const label = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    const stamp = Date.parse(cairoInstant(date, label));
    if (stamp <= now) continue;
    
    const occupied = bookings.some(b => 
      b.status !== 'cancelled' && 
      stamp < Date.parse(b.scheduled_at) + b.duration_minutes * 60000 && 
      stamp + duration * 60000 > Date.parse(b.scheduled_at)
    );
    if (!occupied) result.push(label);
  }
  return result;
}

export function isMapsLink(value: string): boolean {
  try {
    const u = new URL(String(value || ''));
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (
      h === 'maps.app.goo.gl' || 
      h === 'maps.google.com' || 
      (h === 'google.com' && u.pathname.startsWith('/maps')) || 
      (h === 'www.google.com' && u.pathname.startsWith('/maps'))
    );
  } catch {
    return false;
  }
}

export function mapsUrl(clinic: { address?: string; name?: string; latitude?: number | null; longitude?: number | null }): string {
  if (isMapsLink(clinic.address || '')) return new URL(clinic.address || '').href;
  if (typeof clinic.latitude === 'number' && typeof clinic.longitude === 'number') {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(clinic.latitude + ',' + clinic.longitude);
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(clinic.address || clinic.name || '');
}
