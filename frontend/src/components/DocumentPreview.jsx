import { useEffect, useMemo, useState } from 'react';
import { Modal, Icon } from './ui';
import { DOC_PRINT_CSS, printRecord, renderDocHtml } from '../lib/documents';
import { api } from '../lib/api';

export default function DocumentPreview({ open, onClose, record, title, leadId, documentType, documentNo }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const html = useMemo(() => {
    if (!record) return '';
    return renderDocHtml(record).html;
  }, [record]);

  useEffect(() => {
    setSending(false);
    setSent(false);
    setError('');
  }, [open, record, leadId, documentNo]);

  if (!open || !record) return null;

  async function sendWhatsApp() {
    if (!leadId || sending) return;
    setSending(true);
    setError('');
    try {
      const out = await api.sendWhatsappDocument(leadId, {
        document_type: documentType || record.mode || 'document',
        document_no: documentNo || record.docNo || '',
      });
      if (!out.ok) throw new Error(out.error || 'Send failed');
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title || 'Document Preview'} wide footer={
      <>
        {error && <span style={{ fontSize: 12, color: 'var(--crimson-600)', marginRight: 'auto' }}>{error}</span>}
        <button className="btn btn-outline" onClick={onClose}>Close</button>
        {leadId && (
          <button className="btn btn-whatsapp" onClick={sendWhatsApp} disabled={sending || sent}>
            <Icon name="whatsapp" size={14} /> {sent ? 'Sent' : sending ? 'Sending…' : 'Send via WhatsApp'}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => printRecord(record)}>Print / PDF</button>
      </>
    }>
      <style>{`
        .doc-preview { background:#f4f1ea; padding:12px; overflow:auto; max-height:68vh; }
        .doc-preview .docwrap { background:#fff; }
        .doc-preview .doc2 { border:2px solid #000; font-family:Calibri,Arial,sans-serif; color:#000; font-size:12px; background:#fff; }
        ${DOC_PRINT_CSS}
      `}</style>
      <div className="doc-preview">
        <div className="docwrap">
          <div className="doc2" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </Modal>
  );
}
