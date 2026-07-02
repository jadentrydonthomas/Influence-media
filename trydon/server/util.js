export const TZ = () => process.env.TRYDON_TZ || 'America/Indiana/Indianapolis';

// YYYY-MM-DD in the user's timezone
export function todayIso(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ() });
}

export function nowParts() {
  const s = new Date().toLocaleString('en-US', {
    timeZone: TZ(), weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: false,
  });
  const d = new Date();
  const hm = d.toLocaleTimeString('en-GB', { timeZone: TZ(), hour: '2-digit', minute: '2-digit' });
  const weekday = new Date().toLocaleDateString('en-US', { timeZone: TZ(), weekday: 'long' });
  return { iso: todayIso(), weekday, hm, label: s };
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function to12(hm) {
  if (!hm) return '';
  const [H, M] = hm.split(':');
  let h = +H;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return M === '00' ? `${h} ${ap}` : `${h}:${M} ${ap}`;
}
