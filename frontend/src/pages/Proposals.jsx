import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore, store } from '../lib/store';
import { Card, Icon, Badge, Modal, useToast } from '../components/ui';
import { formatINR, formatDate } from '../lib/format';
import DocumentPreview from '../components/DocumentPreview';
import { api } from '../lib/api';
import { COMPANY, defaultQuoteItemsForCapacity, documentTotals, quotationRecord } from '../lib/documents';

const STATUS_TONE = { Draft: 'slate', Sent: 'amber', Approved: 'green', Rejected: 'crimson' };

export default function Proposals() {
  const state = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preselect = params.get('lead');
  const [open, setOpen] = useState(Boolean(preselect));
  const [leadId, setLeadId] = useState(preselect || '');
  const [preview, setPreview] = useState(null);

  const proposals = useMemo(() => state.leads.filter((l) => l.quotation), [state.leads]);

  const stats = useMemo(() => {
    const approved = proposals.filter((l) => l.quotation.status === 'Approved');
    const totalValue = approved.reduce((a, l) => a + (l.quotation.grandTotal || 0), 0);
    return {
      total: proposals.length,
      sent: proposals.filter((l) => ['Sent', 'Approved'].includes(l.quotation.status)).length,
      approved: approved.length,
      totalValue: Math.round(totalValue),
    };
  }, [proposals]);

  const lead = state.leads.find((l) => l.id === leadId);

  async function generate() {
    if (!lead) return;
    const q = lead.quotation;
    if (q) {
      toast('This lead already has a quotation — open the lead to edit it', 'amber');
      setOpen(false);
      navigate(`/leads/${lead.id}`);
      return;
    }
    try {
      const items = defaultQuoteItemsForCapacity(lead.capacity);
      const totals = documentTotals(items);
      await store.saveQuotation(lead.id, {
        kind: 'quotation',
        items,
        gstPercent: 0,
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        grandTotal: totals.grandTotal,
        netPayable: totals.netPayable,
        subsidyCentral: 0,
        subsidyState: 0,
        custAddress: [lead.address, lead.city, lead.state].filter(Boolean).join(', '),
        branchAddress: COMPANY.branchAddress,
        branchPhone: COMPANY.branchPhone,
        template: 'invoice.html',
        status: 'Draft',
      });
      toast('Draft quotation generated — open the lead to send it');
      setOpen(false);
      navigate(`/leads/${lead.id}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="kpi"><div className="kpi-label"><Icon name="proposal" size={14} /> Proposals</div><div className="kpi-value">{stats.total}</div><div className="kpi-extra">across pipeline</div></div>
        <div className="kpi accent-sky"><div className="kpi-label"><Icon name="send" size={14} /> Sent / Negotiating</div><div className="kpi-value">{stats.sent}</div><div className="kpi-extra">awaiting acceptance</div></div>
        <div className="kpi accent-green"><div className="kpi-label"><Icon name="check" size={14} /> Approved</div><div className="kpi-value">{stats.approved}</div><div className="kpi-extra">ready for invoicing</div></div>
        <div className="kpi accent-amber"><div className="kpi-label"><Icon name="billing" size={14} /> Approved Value</div><div className="kpi-value">{formatINR(stats.totalValue)}</div><div className="kpi-extra">gross incl. GST</div></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={15} /> New Proposal</button>
      </div>

      <Card title="Proposals & Quotations" subtitle="Quotation workflow per lead — Draft → Sent → Approved" pad={false}>
        {proposals.length === 0 ? (
          <div className="empty-state"><div className="big"><Icon name="proposal" size={40} /></div><strong>No proposals yet</strong><div>Generate a proposal from a lead to see it here.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Lead</th><th>Customer</th><th>Capacity</th><th>Grand Total</th><th>Status</th><th>Revision</th><th style={{ textAlign: 'right' }}>Open</th></tr></thead>
              <tbody>
                {proposals.map((l) => {
                  const q = l.quotation;
                  return (
                    <tr key={l.id} className="clickable" onClick={() => navigate(`/leads/${l.id}`)}>
                      <td><span className="cell-main">{l.code}</span><div className="cell-sub">{formatDate(l.createdAt)}</div></td>
                      <td><div className="cell-main">{l.name}</div><div className="cell-sub">{l.city || '—'}</div></td>
                      <td><Badge tone="navy">{l.capacity ? l.capacity + ' kW' : '—'}</Badge></td>
                      <td><strong>{formatINR(q.grandTotal)}</strong></td>
                      <td><Badge tone={STATUS_TONE[q.status] || 'slate'}>{q.status}</Badge></td>
                      <td>{q.revision || 1}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); setPreview(l); }}><Icon name="file" size={13} /> Print</button>
                        <button className="btn btn-sm btn-whatsapp" onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const out = await api.sendWhatsappDocument(l.id, { document_type: l.quotation?.kind === 'commercial' ? 'commercial' : 'quotation', document_no: l.quotation?.number || l.code });
                            if (!out.ok) throw new Error(out.error || 'Send failed');
                            toast('Quotation sent via WhatsApp');
                          } catch (err) {
                            toast(err.message, 'error');
                          }
                        }}><Icon name="whatsapp" size={13} /> WhatsApp</button>
                        <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); navigate(`/leads/${l.id}`); }}><Icon name="chev" size={13} /> View</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Proposal" footer={
        <>
          <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!lead} onClick={generate}><Icon name="send" size={14} /> Generate Draft</button>
        </>
      }>
        <div className="field">
          <label>Customer Lead</label>
          <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Select lead</option>
            {state.leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.city || '—'} ({l.capacity || '?'} kW{', '}{l.quotation ? 'has quote' : 'no quote'})</option>)}
          </select>
        </div>
        {lead && (
          <div className="card" style={{ padding: 14, background: 'var(--green-50)', borderColor: 'var(--green-100)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--slate-500)', marginBottom: 6 }}>Auto-generated quotation</div>
            <div style={{ fontSize: 13, color: 'var(--slate-700)' }}>
              {lead.quotation
                ? 'This lead already has a quotation. Opening the lead lets you edit line items, GST & revision.'
                : 'A draft will be created in Invoice.html quotation format (Tata 590Wp BOM). Open the lead afterwards to set prices, subsidies and send it.'}
            </div>
          </div>
        )}
      </Modal>
      <DocumentPreview open={Boolean(preview)} onClose={() => setPreview(null)} record={preview ? quotationRecord(preview) : null} title={`Quotation — ${preview?.name || ''}`} leadId={preview?.id} documentType={preview?.quotation?.kind === 'commercial' ? 'commercial' : 'quotation'} documentNo={preview?.quotation?.number || preview?.code} />
    </div>
  );
}
