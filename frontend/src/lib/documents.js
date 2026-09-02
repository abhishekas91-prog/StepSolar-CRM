export const COMPANY = {
  name: 'STEP SOLAR ENERGY PVT. LTD.',
  shortName: 'STEP SOLAR ENERGY PVT LTD',
  gstin: '09ABPCS3779K1ZC',
  branchAddress: 'Dumri Padaw, Varanasi, U.P',
  branchPhone: '8081252114',
  email: 'sales@stepsolar.in',
  website: 'www.stepsolar.in',
  accountName: 'STEP SOLAR ENERGY PVT LTD',
  bankName: 'State Bank of India',
  accountNo: '44347774983',
  ifsc: 'SBIN0064874',
  bankBranch: 'Bhadaura',
  logoSrc: '/step-solar-logo.png',
};

export const INVOICE_ITEMS = [
  { desc: 'TATA Bifacial 590WP +String Ongrid Inverter', hsn: '85414300', qty: 1, unit: 'Set', price: 131790.48, gst: 5 },
  { desc: 'BOS - Erection, Installation & Commissioning Services', hsn: '9954', qty: 1, unit: 'Nos', price: 41203.39, gst: 18 },
];

export const QUOTE_ITEMS = [
  { desc: 'Solar Module (Bifacial DCR)', hsn: '590 WP (TATA)', qty: 5, unit: 'Nos.', price: 0, gst: 5 },
  { desc: 'Ongrid Solar Inverter', hsn: '3 KW (TATA)', qty: 1, unit: 'Nos.', price: 0, gst: 5 },
  { desc: 'ACDB (AC Distribution Box)', hsn: 'Standard', qty: 1, unit: 'Nos.', price: 0, gst: 18 },
  { desc: 'DCDB (DC Distribution Box)', hsn: 'Standard', qty: 1, unit: 'Nos.', price: 0, gst: 18 },
  { desc: 'Wiring Kit', hsn: 'Standard', qty: 1, unit: 'Nos.', price: 0, gst: 18 },
  { desc: 'Earthing Kit', hsn: 'Standard', qty: 1, unit: 'Nos.', price: 0, gst: 18 },
  { desc: 'All Standard G.I. Structures', hsn: 'Standard Heavy Duty', qty: 1, unit: 'Nos.', price: 0, gst: 18 },
  { desc: 'AC Cable / DC Cable / Earthing Wire', hsn: 'Standard High Quality', qty: 3, unit: 'Set', price: 0, gst: 18 },
  { desc: 'Transportation Charges', hsn: 'Safe Transit to Site', qty: 1, unit: 'Incl.', price: 0, gst: 18 },
  { desc: 'Installation Charges', hsn: 'Complete Commissioning', qty: 1, unit: 'Incl.', price: 0, gst: 18 },
];

export const COMMERCIAL_ITEMS = [
  { desc: 'Solar PV Modules (Bifacial DCR)', hsn: '590Wp TOPCON (Waaree)', qty: 86, unit: 'Nos.', price: 0, gst: 0 },
  { desc: 'Grid-Tie Solar Inverter', hsn: '50 kW Heavy Duty On-Grid Inverter (Waaree)', qty: 1, unit: 'Nos.', price: 0, gst: 0 },
  { desc: 'AC Distribution Box (ACDB)', hsn: '160A 4P MCCB & 320A IP & OP Standard Protection', qty: 1, unit: 'Nos.', price: 0, gst: 0 },
  { desc: 'DC Distribution Box (DCDB)', hsn: 'Standard Array Junction Box with SPD & Fuses', qty: 1, unit: 'Nos.', price: 0, gst: 0 },
  { desc: 'Module Mounting Structure (MMS)', hsn: 'HDG / Aluminum Short Rail Heavy Duty Structure', qty: 1, unit: 'Set', price: 0, gst: 0 },
  { desc: 'Solar DC Cable', hsn: '1C x 4 Sq.mm / 6 Sq.mm XLPE Copper Cable', qty: 650, unit: 'Mtr.', price: 0, gst: 0 },
  { desc: 'AC Armored Cable', hsn: '3.5C x 70 Sq.mm Aluminum Armored XLPE Cable', qty: 50, unit: 'Mtr.', price: 0, gst: 0 },
  { desc: 'Earthing & Protection System', hsn: '1.5M Copper Bonded Chemical Earthing Rods', qty: 3, unit: 'Sets', price: 0, gst: 0 },
  { desc: 'Lightning Arrester (LA)', hsn: 'Umbrella ESE LA with 3M Mast & Base Plate', qty: 1, unit: 'Set', price: 0, gst: 0 },
  { desc: 'MC4 Connectors & Wiring Kit', hsn: 'UV Resistant Male/Female Connectors & Accessories', qty: 50, unit: 'Pairs', price: 0, gst: 0 },
  { desc: 'Module Cleaning Kit', hsn: 'Manual Cleaning System (UPVC/HDPE Pipe & Hose)', qty: 1, unit: 'Set', price: 0, gst: 0 },
  { desc: 'Transportation & Civil I&C', hsn: 'Safe Transit to Site, Installation & Commissioning', qty: 1, unit: 'Incl.', price: 0, gst: 0 },
];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function itemPrice(it) {
  if (it == null) return 0;
  if (it.price != null && it.price !== '') return num(it.price);
  return num(it.rate);
}

export function itemGst(it, fallback = 0) {
  if (it == null) return fallback;
  if (it.gst != null && it.gst !== '') return num(it.gst);
  return fallback;
}

export function normalizeItem(it, gstFallback = 0) {
  const price = itemPrice(it);
  const qty = num(it?.qty, 1);
  const gst = itemGst(it, gstFallback);
  const amount = qty * price;
  const gstAmt = amount * gst / 100;
  return {
    desc: it?.desc || '',
    hsn: it?.hsn || '',
    qty,
    unit: it?.unit || 'Nos',
    price,
    rate: price,
    gst,
    amount,
    gstAmt,
    total: amount + gstAmt,
  };
}

export function normalizeItems(items, gstFallback = 0) {
  return (items || []).map((it) => normalizeItem(it, gstFallback));
}

export function computeItemCalcs(items, gstFallback = 0) {
  return normalizeItems(items, gstFallback);
}

export function inr(n) {
  return '\u20B9' + num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function documentTotals(items, extra = {}) {
  const gstFallback = num(extra.gstPercent);
  const rows = computeItemCalcs(items, gstFallback);
  const taxable = rows.reduce((s, i) => s + i.amount, 0);
  const gstTotal = rows.reduce((s, i) => s + i.gstAmt, 0);
  const grand = taxable + gstTotal;
  const subsidyCentral = num(extra.subsidyCentral);
  const subsidyState = num(extra.subsidyState);
  const netPayable = grand - subsidyCentral - subsidyState;
  return {
    items: rows,
    subtotal: round2(taxable),
    gstAmount: round2(gstTotal),
    grandTotal: round2(grand),
    subsidyCentral,
    subsidyState,
    netPayable: round2(netPayable),
  };
}

export function commercialTotals(q) {
  const capacity = num(q?.capacity ?? q?.capacityKwp);
  const rate = num(q?.rate ?? q?.ratePerWp);
  const gstPct = num(q?.gstPct ?? q?.commercialGst ?? q?.gstPercent);
  const wp = capacity * 1000;
  const base = wp * rate;
  const gstAmt = base * gstPct / 100;
  const grand = base + gstAmt;
  return {
    capacity,
    rate,
    gstPct,
    wp,
    base: round2(base),
    gstAmount: round2(gstAmt),
    grandTotal: round2(grand),
    subtotal: round2(base),
  };
}

export function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

export function autoFillPrices(items, targetGrand) {
  const target = num(targetGrand);
  const rows = (items || []).map((it) => ({ ...it, qty: num(it.qty), price: itemPrice(it), gst: itemGst(it) }));
  const currentGrand = rows.reduce((s, i) => s + i.qty * i.price * (1 + i.gst / 100), 0);
  if (currentGrand > 0) {
    const k = target / currentGrand;
    return rows.map((i) => ({ ...i, price: round2(i.price * k), rate: round2(i.price * k) }));
  }
  const weightSum = rows.reduce((s, i) => s + i.qty * (1 + i.gst / 100), 0);
  if (weightSum <= 0) return rows;
  const unitPrice = target / weightSum;
  return rows.map((i) => ({ ...i, price: round2(unitPrice), rate: round2(unitPrice) }));
}

export function defaultQuoteItemsForCapacity(capacityKw) {
  const capacity = num(capacityKw) || 3;
  const panelWp = 590;
  const panelQty = Math.max(1, Math.ceil((capacity * 1000) / panelWp));
  return QUOTE_ITEMS.map((it, idx) => {
    if (idx === 0) return { ...it, qty: panelQty, hsn: `${panelWp} WP (TATA)` };
    if (idx === 1) {
      const kw = capacity <= 5 ? Math.max(1, Math.round(capacity)) : Math.round(capacity);
      return { ...it, hsn: `${kw} KW (TATA)` };
    }
    return { ...it };
  });
}

export function estimateQuoteGrand(capacityKw) {
  const capacity = num(capacityKw) || 3;
  const panelQty = Math.ceil((capacity * 1000) / 550);
  const panelCost = panelQty * 550 * 24;
  const inverterCost = capacity <= 5 ? 52000 : 78000;
  const bosCost = 18000;
  const subtotal = panelCost + inverterCost + bosCost;
  return round2(subtotal * 1.05);
}

export function numberToWordsIndian(numIn) {
  let value = Math.round(num(numIn));
  if (value === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
  }
  function three(n) {
    if (n > 99) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '');
    return two(n);
  }
  let str = '';
  const crore = Math.floor(value / 10000000);
  value %= 10000000;
  const lakh = Math.floor(value / 100000);
  value %= 100000;
  const thousand = Math.floor(value / 1000);
  value %= 1000;
  if (crore) str += three(crore) + ' Crore ';
  if (lakh) str += three(lakh) + ' Lakh ';
  if (thousand) str += three(thousand) + ' Thousand ';
  if (value) str += three(value);
  return str.trim();
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function logoCell() {
  return `<img class="logo" src="${COMPANY.logoSrc}" alt="Step Solar">`;
}

export function formatDocDate(iso) {
  if (!iso) {
    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function leadAddress(lead) {
  return [lead?.address, lead?.city, lead?.state, lead?.pincode].filter(Boolean).join(', ') || '-';
}

export function quotationRecord(lead) {
  const q = lead?.quotation || {};
  const kind = q.kind || 'quotation';
  return {
    mode: kind === 'commercial' ? 'commercial' : 'quotation',
    docNo: q.number || lead?.code || '-',
    dateStr: formatDocDate(q.updatedAt || q.createdAt || lead?.createdAt),
    custName: lead?.name || '-',
    custPhone: lead?.phone || '-',
    custAddress: q.custAddress || leadAddress(lead),
    payMode: q.payMode || 'Online',
    branchAddress: q.branchAddress || COMPANY.branchAddress,
    branchPhone: q.branchPhone || COMPANY.branchPhone,
    items: q.items || [],
    subsidyCentral: num(q.subsidyCentral),
    subsidyState: num(q.subsidyState),
    validity: q.validity || '15',
    capacity: num(q.capacity ?? lead?.capacity),
    technology: q.technology || '',
    spaceRequired: q.spaceRequired || '',
    application: q.application || '',
    rate: num(q.rate),
    gstPct: num(q.gstPct ?? q.gstPercent),
    payAdvance: num(q.payAdvance, 10),
    payDispatch: num(q.payDispatch, 80),
    payInstall: num(q.payInstall, 10),
    gstPercent: num(q.gstPercent),
  };
}

export function invoiceRecord(lead) {
  const inv = lead?.invoice || {};
  const q = lead?.quotation || {};
  return {
    mode: 'invoice',
    docNo: inv.number || '-',
    dateStr: formatDocDate(inv.createdAt),
    custName: lead?.name || '-',
    custPhone: lead?.phone || '-',
    custAddress: inv.custAddress || q.custAddress || leadAddress(lead),
    payMode: inv.payMode || 'Online',
    branchAddress: inv.branchAddress || COMPANY.branchAddress,
    branchPhone: inv.branchPhone || COMPANY.branchPhone,
    items: inv.items || q.items || [],
    gstPercent: num(inv.gstPercent ?? q.gstPercent),
  };
}

export function receiptRecord(lead, payment) {
  const inv = lead?.invoice || {};
  return {
    mode: 'receipt',
    docNo: payment?.receiptNo || '-',
    dateStr: formatDocDate(payment?.at),
    custName: lead?.name || '-',
    custPhone: lead?.phone || '-',
    custAddress: inv.custAddress || leadAddress(lead),
    payMode: payment?.mode || 'Online',
    branchAddress: COMPANY.branchAddress,
    branchPhone: COMPANY.branchPhone,
    amount: num(payment?.amount),
    balance: Math.max(0, num(inv.grandTotal) - num(inv.paidAmount)),
    remarks: payment?.note || '',
    refInvoice: inv.number ? `Invoice ${inv.number}` : '',
  };
}

export function renderInvoiceHtml(record) {
  const fallback = num(record.gstPercent);
  const items = computeItemCalcs(record.items || [], fallback);
  const taxable = items.reduce((s, i) => s + i.amount, 0);
  const gstTotal = items.reduce((s, i) => s + i.gstAmt, 0);
  const grand = taxable + gstTotal;
  const itemRows = items.map((i, idx) => `
    <tr>
      <td class="center">${idx + 1}</td>
      <td>${esc(i.desc)}</td>
      <td class="center">${esc(i.hsn || '-')}</td>
      <td class="center">${i.qty}</td>
      <td class="center">${esc(i.unit)}</td>
      <td class="right">${inr(i.price)}</td>
      <td class="center">${i.gst}%</td>
      <td class="right">${inr(i.gstAmt)}</td>
      <td class="right">${inr(i.total)}</td>
    </tr>`).join('');
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const groups = {};
  items.forEach((i) => {
    const key = i.hsn || '-';
    if (!groups[key]) groups[key] = { hsn: key, taxable: 0, gst: i.gst };
    groups[key].taxable += i.amount;
  });
  const gstRows = Object.values(groups).map((g) => {
    const half = g.gst / 2;
    const cgst = g.taxable * half / 100;
    const sgst = cgst;
    return `<tr>
      <td class="center">${esc(g.hsn)}</td>
      <td class="right">${inr(g.taxable)}</td>
      <td class="center">${half}%</td>
      <td class="right">${inr(cgst)}</td>
      <td class="center">${half}%</td>
      <td class="right">${inr(sgst)}</td>
      <td class="right">${inr(cgst + sgst)}</td>
    </tr>`;
  }).join('');
  const totCgst = Object.values(groups).reduce((s, g) => s + g.taxable * (g.gst / 2) / 100, 0);
  const words = numberToWordsIndian(grand);
  const html = `
    <table>
      <tr>
        <td rowspan="3" style="width:100px;" class="noB center">${logoCell()}</td>
        <td colspan="2" class="center big">${esc(COMPANY.name)}</td>
      </tr>
      <tr><td colspan="2" class="center small"><b>Branch Address:-</b> ${esc(record.branchAddress)} &nbsp;&nbsp;&nbsp; <b>Phone:</b> ${esc(record.branchPhone)}</td></tr>
      <tr><td colspan="2" class="center bold small">GSTIN: ${esc(COMPANY.gstin)}</td></tr>
      <tr><td colspan="3" class="center midtitle">TAX INVOICE</td></tr>
    </table>
    <table>
      <tr><td colspan="2" class="center bold">BILL TO</td><td colspan="2" class="center bold">INVOICE DETAILS</td></tr>
      <tr><td class="label">Customer Name:</td><td>${esc(record.custName)}</td><td class="label">Invoice No:</td><td>${esc(record.docNo)}</td></tr>
      <tr><td class="label">Contact No:</td><td>${esc(record.custPhone)}</td><td class="label">Invoice Date:</td><td>${esc(record.dateStr)}</td></tr>
      <tr><td class="label">Place of Supply:</td><td>${esc(record.custAddress)}</td><td class="label">Payment Mode:</td><td>${esc(record.payMode)}</td></tr>
    </table>
    <table>
      <thead>
        <tr class="bold" style="background:#eef3f0;">
          <td class="center">S.No</td><td>Item Description</td><td class="center">HSN/SAC</td><td class="center">Qty</td>
          <td class="center">Unit</td><td class="center">Price/Unit (Rs)</td><td class="center">GST (%)</td>
          <td class="center">GST Amt (Rs)</td><td class="center">Amount (Rs)</td>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="bold"><td colspan="3" class="center">Total</td><td class="center">${totalQty}</td><td colspan="3"></td><td class="right">${inr(gstTotal)}</td><td class="right">${inr(grand)}</td></tr>
      </tbody>
    </table>
    <table><tr><td class="noB bold sectionbar">GST Tax Summary Breakdown:</td></tr></table>
    <table>
      <thead><tr class="bold" style="background:#eef3f0;"><td class="center">HSN</td><td class="center">Taxable Amount (Rs)</td><td class="center">CGST Rate</td><td class="center">CGST Amt (Rs)</td><td class="center">SGST Rate</td><td class="center">SGST Amt (Rs)</td><td class="center">Total Tax (Rs)</td></tr></thead>
      <tbody>
        ${gstRows}
        <tr class="bold"><td class="center">TOTAL</td><td class="right">${inr(taxable)}</td><td></td><td class="right">${inr(totCgst)}</td><td></td><td class="right">${inr(totCgst)}</td><td class="right">${inr(totCgst * 2)}</td></tr>
      </tbody>
    </table>
    <table>
      <tr>
        <td rowspan="3" style="width:50%;">
          <div class="bold">Amount In Words:</div>
          <div class="italic" style="margin-top:10px;">${esc(words)} Rupees Only</div>
        </td>
        <td class="label">Sub Total:</td><td class="right">${inr(grand)}</td>
      </tr>
      <tr><td class="label">Round off:</td><td class="right">Rs 0.00</td></tr>
      <tr><td class="label bold">Grand Total:</td><td class="right bold">${inr(grand)}</td></tr>
    </table>
    <table>
      <tr>
        <td colspan="2" class="bold">Bank Account Details for Payments:</td>
        <td colspan="2" class="center bold">Terms &amp; Conditions:</td>
      </tr>
      <tr>
        <td class="label">Account Name:</td><td>${esc(COMPANY.accountName)}</td>
        <td colspan="2" rowspan="4" class="small italic" style="vertical-align:top;">
          1. Goods once sold will not be taken back.<br>
          2. Payment terms as agreed upon ordering.<br>
          3. Thanks for doing business with us!<br><br>
          <b class="italic" style="font-style:normal;">For ${esc(COMPANY.name)}</b><br><br><br>
          <span class="italic">Authorized Signatory</span>
        </td>
      </tr>
      <tr><td class="label">Bank Name:</td><td>${esc(COMPANY.bankName)}</td></tr>
      <tr><td class="label">Account No:</td><td>${esc(COMPANY.accountNo)}</td></tr>
      <tr><td class="label">IFSC Code:</td><td>${esc(COMPANY.ifsc)}</td></tr>
      <tr><td class="label">Branch Name:</td><td colspan="1">${esc(COMPANY.bankBranch)}</td></tr>
    </table>
  `;
  return { html, grandTotal: grand };
}

export function renderQuotationHtml(record) {
  const fallback = num(record.gstPercent);
  const items = computeItemCalcs(record.items || [], fallback);
  const goods = items.filter((i) => i.gst === 5);
  const install = items.filter((i) => i.gst !== 5);
  const goodsTaxable = goods.reduce((s, i) => s + i.amount, 0);
  const goodsGst = goods.reduce((s, i) => s + i.gstAmt, 0);
  const installTaxable = install.reduce((s, i) => s + i.amount, 0);
  const installGst = install.reduce((s, i) => s + i.gstAmt, 0);
  const taxableTotal = goodsTaxable + installTaxable;
  const gstTotal = goodsGst + installGst;
  const grand = taxableTotal + gstTotal;
  const cs = num(record.subsidyCentral);
  const ss = num(record.subsidyState);
  const totalSubsidy = cs + ss;
  const netPayable = grand - totalSubsidy;
  const itemRows = items.map((i, idx) => `
    <tr>
      <td class="center">${idx + 1}</td>
      <td>${esc(i.desc)}</td>
      <td class="center">${esc(i.hsn || '-')}</td>
      <td class="center">${i.qty}</td>
      <td class="center">${esc(i.unit)}</td>
    </tr>`).join('');
  const words = numberToWordsIndian(netPayable);
  const html = `
    <table>
      <tr>
        <td colspan="2" class="center big" style="font-size:19px;">${esc(COMPANY.shortName)}</td>
        <td rowspan="4" style="width:100px;" class="noB center">${logoCell()}</td>
      </tr>
      <tr><td colspan="2" class="center small">GSTIN: ${esc(COMPANY.gstin)}</td></tr>
      <tr><td colspan="2" class="center small">Address: ${esc(record.branchAddress)}</td></tr>
      <tr><td colspan="2" class="center small">Mobile No.:- ${esc(record.branchPhone)} | Email: ${esc(COMPANY.email)}</td></tr>
      <tr><td colspan="3" class="center midtitle">QUOTATION</td></tr>
    </table>
    <table>
      <tr><td colspan="2" class="center bold">Quotation To</td><td class="center bold">Date:</td></tr>
      <tr><td class="label" style="width:110px;">Customer Name</td><td>${esc(record.custName)}</td><td rowspan="3" class="center">${esc(record.dateStr)}</td></tr>
      <tr><td class="label">Address</td><td>${esc(record.custAddress)}</td></tr>
      <tr><td class="label">Contact No.</td><td>${esc(record.custPhone)}</td></tr>
    </table>
    <table><tr><td class="noB bold center sectionbar">Technical Specifications &amp; Scope of Supply</td></tr></table>
    <table>
      <thead><tr class="bold" style="background:#eef3f0;"><td class="center">S.No</td><td>Item Description / Equipment</td><td class="center">Brand / Specification</td><td class="center">Qty</td><td class="center">Unit</td></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <table><tr><td class="noB bold center sectionbar">Commercial Summary &amp; Tax Breakdown</td></tr></table>
    <table>
      <tr><td class="label" style="width:70%;">Goods Taxable Value</td><td class="right">${inr(goodsTaxable)}</td></tr>
      <tr><td class="label">GST @ 5%</td><td class="right">${inr(goodsGst)}</td></tr>
      <tr><td class="label">Installation/Services Taxable Value</td><td class="right">${inr(installTaxable)}</td></tr>
      <tr><td class="label">GST @ 18%</td><td class="right">${inr(installGst)}</td></tr>
      <tr class="bold"><td class="label">Taxable Amount (Excl. GST)</td><td class="right">${inr(taxableTotal)}</td></tr>
      <tr class="bold"><td class="label">Total GST</td><td class="right">${inr(gstTotal)}</td></tr>
      <tr class="bold"><td class="label">Total Gross Payable Amount (Incl. of GST)</td><td class="right">${inr(grand)}</td></tr>
      <tr><td class="label">Less: Central Government Subsidy Benefit</td><td class="right">${inr(cs)}</td></tr>
      <tr><td class="label">Less: UP-State Government Subsidy Benefit</td><td class="right">${inr(ss)}</td></tr>
      <tr class="bold"><td class="label">Total Estimated Subsidy Benefit</td><td class="right">${inr(totalSubsidy)}</td></tr>
      <tr class="bold"><td class="label">Net Payable Amount (Est.)</td><td class="right">${inr(netPayable)}</td></tr>
    </table>
    <table>
      <tr><td colspan="2" class="center bold">Bank Account Details for Payments</td><td colspan="2" class="center bold">Lists of Documents Required</td></tr>
      <tr><td colspan="2">Account Name: ${esc(COMPANY.accountName)}</td><td colspan="2">1. Latest Electricity Bill Copy</td></tr>
      <tr><td colspan="2">Account Number: ${esc(COMPANY.accountNo)}</td><td colspan="2">2. Property Tax Receipt / Panchayat Letter</td></tr>
      <tr><td colspan="2">IFSC Code: ${esc(COMPANY.ifsc)}</td><td colspan="2">3. Aadhaar Card</td></tr>
      <tr><td colspan="2">Bank &amp; Branch: ${esc(COMPANY.bankName)}, ${esc(COMPANY.bankBranch)}</td><td colspan="2">4. PAN Card</td></tr>
      <tr><td colspan="2"></td><td colspan="2">5. Cancelled Cheque / Bank Passbook</td></tr>
    </table>
    <div style="page-break-inside:avoid;break-inside:avoid;">
      <table>
        <tr><td class="center bold">For Step Solar Energy Pvt Ltd</td><td class="center bold">Customer Acceptance</td></tr>
        <tr><td style="height:44px;"></td><td></td></tr>
        <tr><td class="center">Authorized Signatory</td><td class="center">Signature &amp; Date</td></tr>
      </table>
      <p class="small italic" style="padding:6px 4px;border:1px solid #000;border-top:none;margin:0;">Amount in Words (Net Payable): ${esc(words)} Rupees Only</p>
    </div>
  `;
  return { html, grandTotal: netPayable };
}

export function renderReceiptHtml(record) {
  const amount = num(record.amount);
  const words = numberToWordsIndian(amount);
  const html = `
    <table>
      <tr>
        <td rowspan="3" style="width:100px;" class="noB center">${logoCell()}</td>
        <td colspan="2" class="center big">${esc(COMPANY.name)}</td>
      </tr>
      <tr><td colspan="2" class="center small"><b>Branch Address:-</b> ${esc(record.branchAddress)} &nbsp;&nbsp;&nbsp; <b>Phone:</b> ${esc(record.branchPhone)}</td></tr>
      <tr><td colspan="2" class="center bold small">GSTIN: ${esc(COMPANY.gstin)}</td></tr>
      <tr><td colspan="3" class="center midtitle">PAYMENT RECEIPT</td></tr>
    </table>
    <table>
      <tr><td colspan="2" class="center bold">RECEIVED FROM</td><td colspan="2" class="center bold">RECEIPT DETAILS</td></tr>
      <tr><td class="label">Customer Name:</td><td>${esc(record.custName)}</td><td class="label">Receipt No:</td><td>${esc(record.docNo)}</td></tr>
      <tr><td class="label">Contact No:</td><td>${esc(record.custPhone)}</td><td class="label">Date:</td><td>${esc(record.dateStr)}</td></tr>
      <tr><td class="label">Address:</td><td>${esc(record.custAddress)}</td><td class="label">Payment Mode:</td><td>${esc(record.payMode)}</td></tr>
      ${record.refInvoice ? `<tr><td class="label">Received Against:</td><td colspan="3">${esc(record.refInvoice)}</td></tr>` : ''}
    </table>
    <table>
      <tr><td class="label" style="width:70%;">Amount Received</td><td class="right bold">${inr(amount)}</td></tr>
      <tr><td class="label">Balance Due</td><td class="right">${inr(record.balance || 0)}</td></tr>
      ${record.remarks ? `<tr><td class="label">Remarks</td><td>${esc(record.remarks)}</td></tr>` : ''}
    </table>
    <table>
      <tr><td class="bold" style="width:50%;">Amount In Words:</td><td></td></tr>
      <tr><td colspan="2" class="italic">${esc(words)} Rupees Only</td></tr>
    </table>
    <table>
      <tr><td colspan="2" class="bold">Bank Account Details for Payments:</td></tr>
      <tr><td class="label">Account Name:</td><td>${esc(COMPANY.accountName)}</td></tr>
      <tr><td class="label">Bank Name:</td><td>${esc(COMPANY.bankName)}</td></tr>
      <tr><td class="label">Account No:</td><td>${esc(COMPANY.accountNo)}</td></tr>
      <tr><td class="label">IFSC Code:</td><td>${esc(COMPANY.ifsc)}</td></tr>
      <tr><td class="label">Branch Name:</td><td>${esc(COMPANY.bankBranch)}</td></tr>
    </table>
    <table>
      <tr><td class="center" style="height:44px;"></td><td class="center bold" style="text-align:right;">For ${esc(COMPANY.name)}</td></tr>
      <tr><td class="center">Customer Signature</td><td class="center" style="text-align:right;">Authorized Signatory</td></tr>
    </table>
  `;
  return { html, grandTotal: amount };
}

export function renderCommercialHtml(record) {
  const items = record.items || [];
  const c = commercialTotals(record);
  const bomRows = items.map((i, idx) => `
    <tr>
      <td class="center">${idx + 1}</td>
      <td>${esc(i.desc)}</td>
      <td>${esc(i.hsn || '-')}</td>
      <td class="center">${i.qty}</td>
      <td class="center">${esc(i.unit)}</td>
    </tr>`).join('');
  const adv = num(record.payAdvance);
  const disp = num(record.payDispatch);
  const inst = num(record.payInstall);
  const html = `
    <table>
      <tr>
        <td colspan="2" class="center big" style="font-size:19px;">${esc(COMPANY.shortName)}</td>
        <td rowspan="6" style="width:100px;" class="noB center">${logoCell()}</td>
      </tr>
      <tr><td colspan="2" class="center small">Freedom - Future - Savings</td></tr>
      <tr><td colspan="2" class="center small">GSTIN: ${esc(COMPANY.gstin)}</td></tr>
      <tr><td colspan="2" class="center small">Address: ${esc(record.branchAddress)}</td></tr>
      <tr><td colspan="2" class="center small">Contact: +91 ${esc(record.branchPhone)} | Email: ${esc(COMPANY.email)}</td></tr>
      <tr><td colspan="2" class="center small">Website: ${esc(COMPANY.website)}</td></tr>
      <tr><td colspan="3" class="center midtitle">QUOTATION</td></tr>
      <tr><td colspan="3" class="center small">Ref No: ${esc(record.docNo)} &nbsp;|&nbsp; Date: ${esc(record.dateStr)} &nbsp;|&nbsp; Validity: ${esc(record.validity)} Days</td></tr>
    </table>
    <table><tr><td class="noB bold center sectionbar">CLIENT DETAILS (QUOTATION TO)</td></tr></table>
    <table>
      <tr><td class="label" style="width:20%;">Customer Name</td><td>${esc(record.custName)}</td></tr>
      <tr><td class="label">Contact</td><td>${esc(record.custPhone)}</td></tr>
      <tr><td class="label">Address</td><td>${esc(record.custAddress)}</td></tr>
    </table>
    <table><tr><td class="noB bold center sectionbar">PROJECT OVERVIEW</td></tr></table>
    <table>
      <tr><td class="label" style="width:25%;">System Capacity</td><td>${c.capacity} KWp Grid-Tie Solar PV System</td></tr>
      <tr><td class="label">Technology</td><td>${esc(record.technology || '-')}</td></tr>
      <tr><td class="label">Space Required</td><td>${esc(record.spaceRequired || '-')}</td></tr>
      <tr><td class="label">Application</td><td>${esc(record.application || '-')}</td></tr>
    </table>
    <table><tr><td class="noB bold sectionbar">1. INTRODUCTION &amp; COMPANY PROFILE</td></tr></table>
    <table><tr><td class="noB prose">
      Step Solar Energy Pvt Ltd is a leading renewable energy solutions provider headquartered in Varanasi, offering turn-key solar execution including design, engineering, procurement, installation, and long-term O&amp;M.
    </td></tr></table>
    <table><tr><td class="noB bold sectionbar">2. BILL OF MATERIALS (BOM) &amp; TECHNICAL SPECIFICATIONS</td></tr></table>
    <table>
      <thead><tr class="bold" style="background:#eef3f0;"><td class="center">S.N.</td><td>Equipment / Item Description</td><td>Specification / Make</td><td class="center">Qty</td><td class="center">Unit</td></tr></thead>
      <tbody>${bomRows}</tbody>
    </table>
    <table><tr><td class="noB bold sectionbar">3. COMMERCIAL PRICING &amp; FINANCIAL BREAKDOWN</td></tr></table>
    <table>
      <tr><td class="label" style="width:65%;">${c.capacity} KWp System @ Rs ${c.rate.toFixed(2)}/Wp</td><td class="right">${inr(c.base)}</td></tr>
      <tr><td class="label">Applicable GST @ ${c.gstPct}%</td><td class="right">${inr(c.gstAmount)}</td></tr>
      <tr class="bold"><td class="label">GROSS TOTAL PAYABLE</td><td class="right">${inr(c.grandTotal)}</td></tr>
    </table>
    <table><tr><td class="noB bold sectionbar">4. PAYMENT SCHEDULE &amp; BANK ACCOUNT DETAILS</td></tr></table>
    <table>
      <tr><td class="label" style="width:65%;">Advance with Purchase Order (PO) - ${adv}%</td><td class="right">${inr(c.grandTotal * adv / 100)}</td></tr>
      <tr><td class="label">Before Dispatch of Material - ${disp}%</td><td class="right">${inr(c.grandTotal * disp / 100)}</td></tr>
      <tr><td class="label">After Installation &amp; Commissioning - ${inst}%</td><td class="right">${inr(c.grandTotal * inst / 100)}</td></tr>
    </table>
    <table>
      <tr><td class="label" style="width:30%;">Account Name</td><td>${esc(COMPANY.accountName)}</td></tr>
      <tr><td class="label">Account Number</td><td>${esc(COMPANY.accountNo)}</td></tr>
      <tr><td class="label">IFSC Code</td><td>${esc(COMPANY.ifsc)}</td></tr>
      <tr><td class="label">Bank &amp; Branch</td><td>${esc(COMPANY.bankName)}, ${esc(COMPANY.bankBranch)}</td></tr>
    </table>
    <table>
      <tr><td class="center bold">CUSTOMER ACCEPTANCE &amp; STAMP</td><td class="center bold">FOR ${esc(COMPANY.shortName)}</td></tr>
      <tr><td style="height:50px;"></td><td></td></tr>
      <tr><td class="center">Authorized Signatory / Client<br>Date: ____ / ____ / ____</td><td class="center">Authorized Signatory<br>Step Solar Energy Pvt Ltd, Varanasi</td></tr>
    </table>
  `;
  return { html, grandTotal: c.grandTotal };
}

export function renderDocHtml(record) {
  if (record.mode === 'invoice') return renderInvoiceHtml(record);
  if (record.mode === 'quotation') return renderQuotationHtml(record);
  if (record.mode === 'commercial') return renderCommercialHtml(record);
  return renderReceiptHtml(record);
}

export const DOC_PRINT_CSS = `
  @page{ size: A4; margin: 0.3in; }
  *{box-sizing:border-box;}
  body{margin:0;background:#fff;color:#000;}
  .docwrap{background:#fff;padding:0;}
  .doc2{border:2px solid #000;font-family:Calibri,Arial,sans-serif;color:#000;font-size:12px;}
  .doc2 table{width:100%;border-collapse:collapse;page-break-inside:avoid;}
  .doc2 td{border:1px solid #000;padding:5px 8px;vertical-align:middle;font-size:12px;}
  .doc2 .noB{border:none;}
  .doc2 .center{text-align:center;}
  .doc2 .right{text-align:right;}
  .doc2 .bold{font-weight:700;}
  .doc2 .big{font-size:21px;font-weight:800;letter-spacing:.01em;}
  .doc2 .midtitle{font-size:15px;font-weight:800;letter-spacing:.04em;}
  .doc2 .small{font-size:10.5px;}
  .doc2 img.logo{width:82px;display:block;margin:0 auto;}
  .doc2 .sectionbar{font-size:11.5px;font-weight:700;padding:5px 8px;background:#fff;}
  .doc2 .italic{font-style:italic;}
  .doc2 .label{font-weight:700;width:150px;}
  .doc2 .prose{font-size:11.5px;line-height:1.55;padding:8px 10px;}
  .doc2 p{page-break-inside:avoid;}
  .doc2 tr{page-break-inside:avoid;}
`;

export function wrapPrintHtml(inner) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Step Solar Document</title><style>${DOC_PRINT_CSS}</style></head><body><div class="docwrap"><div class="doc2">${inner}</div></div></body></html>`;
}

export function printRecord(record) {
  const { html } = renderDocHtml(record);
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return false;
  w.document.open();
  w.document.write(wrapPrintHtml(html));
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch (e) { /* ignore */ }
  }, 250);
  return true;
}
