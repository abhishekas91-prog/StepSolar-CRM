import { useEffect, useRef, useState } from 'react';
import { Drawer, Icon, useToast } from './ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';

function messageText(m) {
  return m?.content_text || m?.text || m?.body || m?.content || '';
}

function isOutbound(m) {
  return (m?.direction || '').toLowerCase() === 'outbound';
}

function sameThread(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i].id || '') !== (b[i].id || '')) return false;
    if (messageText(a[i]) !== messageText(b[i])) return false;
    if ((a[i].status || '') !== (b[i].status || '')) return false;
  }
  return true;
}

function mergeMessages(prev, next) {
  if (sameThread(prev, next)) return prev;
  const pending = prev.filter((m) => (
    !m.id
    && isOutbound(m)
    && !next.some((n) => isOutbound(n) && messageText(n) === messageText(m))
  ));
  return pending.length ? [...next, ...pending] : next;
}

export default function WhatsAppChat({ open, onClose, lead }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const threadRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!open || !lead?.phone) {
      setMessages([]);
      return undefined;
    }
    let cancelled = false;
    let first = true;
    setLoading(true);
    setError('');

    async function load() {
      try {
        const res = await api.whatsappChat(lead.phone);
        if (cancelled) return;
        setMessages((prev) => mergeMessages(prev, res.messages || []));
        setError('');
      } catch (e) {
        if (cancelled) return;
        if (first) {
          setError(e.message);
          setMessages([]);
        }
      } finally {
        if (!cancelled && first) {
          first = false;
          setLoading(false);
        }
      }
    }

    load();
    const timer = setInterval(load, 3000);
    function onVis() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [open, lead?.phone]);

  useEffect(() => {
    if (open && stickRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  function onThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.whatsappChatSend({ phone: lead.phone, text: body });
      stickRef.current = true;
      setMessages((prev) => [
        ...prev,
        { direction: 'outbound', content_text: body, created_at: new Date().toISOString(), status: 'sent' },
      ]);
      setText('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={`WhatsApp · ${lead?.name || ''}`} width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 }}>
        <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 12 }}>
          {lead?.phone} · via WaCRM Business API
        </div>
        <div ref={threadRef} onScroll={onThreadScroll} style={{ flex: 1, overflowY: 'auto', background: '#efeae2', borderRadius: 10, padding: 12, minHeight: 280 }}>
          {loading && <div className="empty-state" style={{ padding: 24 }}><strong>Loading chat…</strong></div>}
          {!loading && error && (
            <div className="empty-state" style={{ padding: 24 }}>
              <strong>Chat not connected</strong>
              <div style={{ marginTop: 6 }}>{error}</div>
              <div style={{ marginTop: 8, fontSize: 12 }}>Super Admin can set the WaCRM API key in Master Config.</div>
            </div>
          )}
          {!loading && !error && messages.length === 0 && (
            <div className="empty-state" style={{ padding: 24 }}>
              <strong>No messages yet</strong>
              <div>Send the first WhatsApp from this CRM.</div>
            </div>
          )}
          {!loading && !error && messages.map((m, i) => {
            const out = isOutbound(m);
            return (
              <div key={m.id || i} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{
                  maxWidth: '82%',
                  background: out ? '#d9fdd3' : '#fff',
                  borderRadius: 8,
                  padding: '8px 10px',
                  boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
                }}>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{messageText(m) || '(media)'}</div>
                  <div style={{ fontSize: 10, color: 'var(--slate-400)', textAlign: 'right', marginTop: 4 }}>
                    {m.created_at || m.at ? timeAgo(m.created_at || m.at) : ''} {out ? ' · ' + (m.status || '') : ''}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message…"
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={Boolean(error) || sending}
          />
          <button className="btn btn-whatsapp" onClick={send} disabled={Boolean(error) || sending || !text.trim()}>
            <Icon name="send" size={14} /> {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
