export const PIPELINE = [
  { key: 'lead_captured', label: 'Lead Captured', color: 'sky', owner: 'Sales' },
  { key: 'site_survey_scheduled', label: 'Site Survey Scheduled', color: 'violet', owner: 'Sales' },
  { key: 'survey_completed', label: 'Site Survey Completed', color: 'teal', owner: 'Site Survey' },
  { key: 'quotation_sent', label: 'Quotation Sent', color: 'amber', owner: 'Sales' },
  { key: 'docs_verified', label: 'Documents Verified', color: 'slate', owner: 'Accounts' },
  { key: 'discom_applied', label: 'DISCOM Application', color: 'violet', owner: 'Accounts' },
  { key: 'material_dispatched', label: 'Material Dispatched', color: 'amber', owner: 'Installation' },
  { key: 'installation_in_progress', label: 'Installation In Progress', color: 'sky', owner: 'Installation' },
  { key: 'net_metering_pending', label: 'Net Metering Pending', color: 'amber', owner: 'Installation' },
  { key: 'commissioned', label: 'Commissioned', color: 'green', owner: 'Installation' },
  { key: 'subsidy_disbursed', label: 'Subsidy Disbursed', color: 'green', owner: 'Accounts' },
];

export const PIPELINE_MAP = Object.fromEntries(PIPELINE.map((s) => [s.key, s]));
export const STAGE_STATUS = ['Pending', 'In Progress', 'Completed'];

export const PROPERTY_TYPES = ['Residential', 'Commercial / Office', 'Industrial / Factory', 'Agricultural / Pump'];
export const ROOF_TYPES = ['Rented Roof / No Roof', 'Small Space (100-200 sq. ft.)', 'Medium Space (300-500 sq. ft.)', 'Large Open Roof (500+ sq. ft.)'];
export const TIMELINES = ['Immediately', 'Within 1-2 months', 'Sirf jankari aur quotation chahiye'];
export const SOURCES = ['Website', 'Referral', 'Walk-in', 'WhatsApp Ad', 'Field Agent', 'Telecall', 'Exhibition', 'Existing Customer', 'Admin'];
export const STATES = ['Bihar', 'Uttar Pradesh', 'Jharkhand'];
export const CITIES = {
  Bihar: ['Patna', 'Muzaffarpur', 'Gaya', 'Bhagalpur', 'Darbhanga', 'Purnia', 'Motihari', 'Nalanda'],
  'Uttar Pradesh': ['Varanasi', 'Gorakhpur', 'Lucknow', 'Prayagraj', 'Ayodhya'],
  Jharkhand: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Hazaribagh'],
};

export function nextStageStatus(current) {
  if (!current) return 'In Progress';
  const idx = STAGE_STATUS.indexOf(current);
  return STAGE_STATUS[Math.min(STAGE_STATUS.length - 1, idx + 1)];
}

export function currentStageInfo(stages) {
  const list = Array.isArray(stages) ? stages : [];
  if (!list.length) return { key: 'lead_captured', label: 'Lead Captured', color: 'sky', stageIndex: 0, completedCount: 0, progressPct: 0, allCompleted: false };
  const completedCount = list.filter((s) => s.status === 'Completed').length;
  const active = list.find((s) => s.status === 'In Progress');
  const completed = list.filter((s) => s.status === 'Completed').pop();
  const info = active || completed || list[0];
  const def = PIPELINE_MAP[info.key] || { label: info.key, color: 'slate' };
  const total = list.length;
  return {
    key: info.key,
    label: def.label || info.key,
    color: def.color,
    stageIndex: Math.max(0, list.findIndex((s) => s.key === info.key)),
    completedCount,
    progressPct: total ? Math.round((completedCount / total) * 100) : 0,
    allCompleted: completedCount === total,
  };
}

export function stageList(stages) {
  return (Array.isArray(stages) ? stages : []).map((s) => {
    const def = PIPELINE_MAP[s.key] || { label: s.key, color: 'slate', owner: '-' };
    return { ...s, label: def.label, color: def.color, owner: s.owner || def.owner };
  });
}

export function estimateCapacity(lead) {
  const fromSolar = lead?.solar?.proposed_size_kw;
  if (fromSolar) return Number(fromSolar);
  const bill = lead?.monthly_bill;
  if (bill) return Math.round(Math.min(10, Math.max(1, Number(bill) / 900)) * 10) / 10;
  return null;
}

export function quoteTotal(q) {
  if (!q) return 0;
  return Number(q.grandTotal || 0);
}

export function invoiceOutstanding(inv) {
  if (!inv) return 0;
  return Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0));
}

export function mapLead(b) {
  if (!b || typeof b !== 'object') return null;
  const stages = Array.isArray(b.stages) ? b.stages : [];
  const cur = currentStageInfo(stages);
  const q = b.quotation;
  const inv = b.invoice;
  const capacity = estimateCapacity(b);
  const tasks = Array.isArray(b.tasks) ? b.tasks : [];

  return {
    id: b.id,
    code: b.code || '',
    name: b.full_name || b.name || '',
    phone: b.phone,
    whatsapp: b.phone,
    email: b.email,
    city: b.city,
    state: b.state,
    pincode: b.pincode,
    propertyType: b.property_type,
    monthlyBill: b.monthly_bill,
    roofType: b.roof_type,
    timeline: b.timeline,
    source: b.source,
    notes: b.notes,
    capacity,
    budget: quoteTotal(q) || (b.monthly_bill ? Number(b.monthly_bill) * 900 : null),
    createdAt: b.created_at || b.createdAt,
    updatedAt: b.updated_at || b.updatedAt,
    owner: b.assigned_name || b.assigned_to || '-',
    assignedTo: b.assigned_to || null,
    assignedName: b.assigned_name || null,
    trackingToken: b.tracking_token,
    address: b.address || [b.city, b.state].filter(Boolean).join(', '),
    currentStageKey: cur.key,
    currentStageLabel: cur.label,
    currentStageColor: cur.color,
    stageIndex: cur.stageIndex,
    completedCount: cur.completedCount,
    progressPct: cur.progressPct,
    allCompleted: cur.allCompleted,
    stages: stageList(stages),
    quotation: q,
    quotationHistory: b.quotation_history || [],
    invoice: inv
      ? { ...inv, payments: Array.isArray(inv.payments) ? inv.payments : [] }
      : inv,
    survey: b.site_survey,
    solar: b.solar,
    comments: Array.isArray(b.comments) ? b.comments : [],
    tasks,
    activity: Array.isArray(b.activity) ? b.activity : [],
    inventory: Array.isArray(b.inventory) ? b.inventory : [],
  };
}

export function toLeadCreate(d) {
  const payload = {
    full_name: (d.name || '').trim(),
    phone: d.phone,
    email: (d.email || '').trim(),
    monthly_bill: Number(d.monthlyBill) || 0,
    source: d.source || 'Admin',
  };
  if (d.state) payload.state = d.state;
  if (d.city) payload.city = d.city;
  if (d.pincode) payload.pincode = d.pincode;
  if (d.propertyType) payload.property_type = d.propertyType;
  if (d.roofType) payload.roof_type = d.roofType;
  if (d.timeline) payload.timeline = d.timeline;
  if (d.notes) payload.notes = d.notes;
  return payload;
}

export function leadsByMonth(leads, months = 6) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en-IN', { month: 'short' }), leads: 0 });
  }
  leads.forEach((l) => {
    const d = new Date(l.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = buckets.find((b) => b.key === key);
    if (bucket) bucket.leads += 1;
  });
  return buckets;
}

export function leadCsv(leads) {
  const head = ['Code', 'Name', 'Phone', 'Email', 'City', 'State', 'Source', 'Owner', 'Stage', 'Capacity(kW)', 'MonthlyBill', 'CreatedAt'];
  const rows = leads.map((l) => [l.code, l.name, l.phone, l.email, l.city, l.state, l.source, l.owner, l.currentStageLabel, l.capacity ?? '', l.monthlyBill ?? '', l.createdAt]);
  return [head, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}
