import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, store } from '../lib/store';
import { Card, Icon, Badge, Modal, Drawer, useToast } from '../components/ui';
import { formatINR, formatDate, timeAgo } from '../lib/format';
import { invoiceOutstanding } from '../lib/backend';

const STATUS_TONE = { Paid: 'green', Partial: 'amber', Due: 'crimson' };

export default function Billing() {
  const state = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [selLeadId, setSelLeadId] = useState(null);
  const [details, setDetails] = useState(null);

  const bills = useMemo(() => state.leads.filter((l) => l.invoice), [state.leads]);

  const stats = useMemo(() => {
    let billed = 0, collected = 0, outstanding = 0;
    bills.forEach((l) => {
      const inv = l.invoice;
      billed += Number(inv.grandTotal || 0);
      collected += Number(inv.paidAmount || 0);
      outstanding += invoiceOutstanding(inv);
    });
    return { count: bills.length, billed, collected, outstanding };
  }, [bills]);

  const statusTally = useMemo(() => {
    const t = { Paid: 0, Partial: 0, Due: 0 };
    bills.forEach((l) => {
      const s = l.invoice.paymentStatus === 'Paid' ? 'Paid' : invoiceOutstanding(l.invoice) > 0 ? 'Partial' : 'Paid';
      t[s] = (t[s] || 0) + 1;
    });
    return t;
  }, [bills]);

  const recentPayments = useMemo(() => {
    const rows = [];
    bills.forEach((l) => {
      (l.invoice.payments || []).forEach((p) => rows.push({ lead: l, p }));
    });
    return rows.sort((a, b) => new Date(b.p.at) - new Date(a.p.at)).slice(0, 10);
  }, [bills]);

  async function createInvoiceFor() {
    const lead = state.leads.find((l) => l.id === selLeadId);
    if (!lead) return;
    if (lead.invoice) {
      toast('Invoice already exists for this lead', 'amber');
      setSelLeadId(null);
      return;
    }
    if (!lead.quotation) {
      toast('Generate a quotation first, then create the invoice', 'error');
      setSelLeadId(null);
      return;
    }
    try {
      await store.createInvoice(selLeadId);
      toast(`Invoice ${lead.code} created from the approved quotation`);
      setSelLeadId(null);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function getPaymentStatus(inv) {
    if (inv.paymentStatus === 'Paid') return 'Paid';
    const o = invoiceOutstanding(inv);
    if (o <= 0) return 'Paid';
    return Number(inv.paidAmount || 0) > 0 ? 'Partial' : 'Due';
  }

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="kpi"><div className="kpi-label"><Icon name="billing" size={14} /> Invoices</div><div className="kpi-value">{stats.count}</div><div className="kpi-extra">{formatINR(stats.billed)} billed</div></div>
        <div className="kpi accent-green"><div className="kpi-label"><Icon name="check" size={14} /> Collected</div><div className="kpi-value">{formatINR(stats.collected)}</div><div className="kpi-extra">{statusTally.Paid} fully paid</div></div>
        <div className="kpi accent-crimson"><div className="kpi-label"><Icon name="alert" size={14} /> Outstanding</div><div className="kpi-value">{formatINR(stats.outstanding)}</div><div className="kpi-extra">{statusTally.Partial} partially paid</div></div>
        <div className="kpi accent-amber"><div className="kpi-label"><Icon name="clock" size={14} /> Due</div><div className="kpi-value">{statusTally.Due}</div><div className="kpi-extra">no payment recorded</div></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setSelLeadId('')}><Icon name="plus" size={15} /> New Invoice</button>
      </div>

      <Card title="Invoices & Payments" subtitle="Invoices created from approved quotations; payments tracked per invoice" pad={false}>
        {bills.length === 0 ? (
          <div className="empty-state"><div className="big"><Icon name="billing" size={40} /></div><strong>No invoices yet</strong><div>Create an invoice from an approved quotation to start billing.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Invoice</th><th>Customer</th><th>Billed</th><th>Paid</th><th>Outstanding</th><th>Status</th><th style={{ textAlign: 'right' }}>Open</th></tr></thead>
              <tbody>
                {bills.map((l) => {
                  const inv = l.invoice;
                  const st = getPaymentStatus(inv);
                  const o = invoiceOutstanding(inv);
                  return (
                    <tr key={l.id} className="clickable" onClick={() => setDetails(l)}>
                      <td><span className="cell-main">{inv.number || l.code}</span><div className="cell-sub">{formatDate(l.createdAt)}</div></td>
                      <td><div className="cell-main">{l.name}</div><div className="cell-sub">{l.city || '—'}</div></td>
                      <td style={{ fontWeight: 700 }}>{formatINR(inv.grandTotal)}</td>
                      <td style={{ color: 'var(--green-700)' }}>{formatINR(inv.paidAmount)}</td>
                      <td style={{ color: o > 0 ? 'var(--crimson-600)' : 'var(--slate-400)' }}>{formatINR(o)}</td>
                      <td><Badge tone={STATUS_TONE[st]}>{st}</Badge></td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); setDetails(l); }}><Icon name="chev" size={13} /> Details</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <Card title="Recent Payments" pad={false}>
          {recentPayments.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}><strong>No payments yet</strong></div>
          ) : recentPayments.map(({ lead, p }, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--slate-100)', alignItems: 'center' }}>
              <span className="badge badge-green"><Icon name="check" size={11} /> {p.mode}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{formatINR(p.amount)} <span style={{ fontWeight: 400, color: 'var(--slate-500)' }}>· {p.reference || '—'}</span></div>
                <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{lead.name} · {lead.code} · {timeAgo(p.at)}</div>
              </div>
              <button className="btn btn-sm btn-outline" onClick={() => navigate(`/leads/${lead.id}`)}>View</button>
            </div>
          ))}
        </Card>

        <Card title="Billing Health" pad={false}>
          {bills.map((l) => {
            const inv = l.invoice;
            const o = invoiceOutstanding(inv);
            const pct = inv.grandTotal ? Math.min(100, Math.round((Number(inv.paidAmount || 0) / Number(inv.grandTotal)) * 100)) : 0;
            return (
              <div key={l.id} style={{ padding: '10px 20px', borderBottom: '1px solid var(--slate-100)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12.5 }}>
                  <strong>{l.name}</strong>
                  <span style={{ color: 'var(--slate-500)' }}>{formatINR(o)} due</span>
                </div>
                <div className="progress"><div className="progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--green-500)' : pct > 50 ? 'var(--amber-500)' : 'var(--crimson-500)' }} /></div>
              </div>
            );
          })}
        </Card>
      </div>

      {selLeadId !== null && (
        <Modal open onClose={() => setSelLeadId(null)} title="New Invoice"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setSelLeadId(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={createInvoiceFor}><Icon name="plus" size={14} /> Create Invoice</button>
            </>
          }
        >
          <div className="field">
            <label>Customer Lead</label>
            <select className="select" value={selLeadId} onChange={(e) => setSelLeadId(e.target.value)}>
              <option value="">Select lead</option>
              {state.leads.filter((l) => l.quotation).map((l) => (
                <option key={l.id} value={l.id}>{l.name} — {l.city || '—'} ({l.quotation.status}{l.invoice ? ', invoiced' : ''})</option>
              ))}
            </select>
          </div>
          <div className="card" style={{ padding: 14, background: 'var(--green-50)', borderColor: 'var(--green-100)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--slate-500)', marginBottom: 6 }}>How it works</div>
            <div style={{ fontSize: 13, color: 'var(--slate-700)' }}>
              An invoice is created from the lead's approved quotation (amount = grand total, GST included). Payments are then recorded against the invoice from the lead page.
            </div>
          </div>
        </Modal>
      )}

      <Drawer open={Boolean(details)} onClose={() => setDetails(null)} title={`Invoice · ${details?.invoice?.number || details?.code || ''}`}>
        {details && (() => {
          const inv = details.invoice;
          const o = invoiceOutstanding(inv);
          const st = getPaymentStatus(inv);
          return (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <Badge tone={STATUS_TONE[st]}>{st}</Badge>
                <Badge tone="slate">{inv.payments?.length || 0} payments</Badge>
                <Badge tone="crimson">{formatINR(o)} due</Badge>
              </div>
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div className="kv">
                  <dt>Customer</dt><dd>{details.name}</dd>
                  <dt>Phone</dt><dd>{details.phone}</dd>
                  <dt>Billed</dt><dd>{formatINR(inv.grandTotal)}</dd>
                  <dt>Paid</dt><dd>{formatINR(inv.paidAmount)}</dd>
                </div>
              </div>
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--slate-400)', marginBottom: 10 }}>Line Items</div>
                {(inv.items || []).map((it, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{it.desc}</span>
                    <span style={{ color: 'var(--slate-500)' }}>×{it.qty}</span>
                    <strong>{formatINR(it.amount || it.qty * it.rate)}</strong>
                  </div>
                ))}
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--slate-400)', marginBottom: 10 }}>Payments</div>
                {(inv.payments || []).length === 0 ? <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>No payments recorded.</div> : (inv.payments || []).map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--slate-100)' }}>
                    <span className="badge badge-green">{p.mode}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{formatINR(p.amount)}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{p.reference || '—'}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{formatDate(p.at)}</span>
                  </div>
                ))}
              </div>
              {o > 0 && (
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={() => { setDetails(null); navigate(`/leads/${details.id}`); }}>
                  <Icon name="plus" size={14} /> Record Payment on Lead
                </button>
              )}
            </div>
          );
        })()}
      </Drawer>
    </div>
  );
}
