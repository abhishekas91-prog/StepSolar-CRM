import { useMemo } from 'react';
import { Modal } from './ui';
import { DOC_PRINT_CSS, printRecord, renderDocHtml } from '../lib/documents';

export default function DocumentPreview({ open, onClose, record, title }) {
  const html = useMemo(() => {
    if (!record) return '';
    return renderDocHtml(record).html;
  }, [record]);

  if (!open || !record) return null;

  return (
    <Modal open onClose={onClose} title={title || 'Document Preview'} wide footer={
      <>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
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
