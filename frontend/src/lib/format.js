export function formatINR(n) {
  return '\u20B9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function formatLakh(n) {
  if (n >= 10000000) return '\u20B9' + (n / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr';
  if (n >= 100000) return '\u20B9' + (n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Lakh';
  return formatINR(n);
}

export function formatNum(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

export function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ', ' +
    dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  );
}

export function daysFromNow(d) {
  const diff = new Date(d) - new Date();
  return Math.ceil(diff / 86400000);
}

export function relativeDue(d) {
  const n = daysFromNow(d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n}d overdue`;
  return `in ${n}d`;
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}

export function initials(name) {
  return (name || '')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
