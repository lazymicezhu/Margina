import { useState } from 'react';
import { api, jsonOptions } from './cloud-api';
export default function AuthForm({ setupEmail, onSuccess }: { setupEmail?: string | null; onSuccess: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if (setupEmail && password !== confirmation) { setError('两次密码不一致'); return; }
    setBusy(true); setError('');
    try {
      await api(setupEmail ? '/api/auth/password' : '/api/auth/login', jsonOptions('POST', { email, password }));
      setPassword(''); setConfirmation(''); await onSuccess();
    } catch (e) { setError(e instanceof Error ? e.message : '登录失败，请重试'); }
    finally { setBusy(false); }
  }
  return <form className="shelf-form auth-form" onSubmit={event => void submit(event)}>
    <label>邮箱<input aria-label="邮箱" type="email" autoComplete="username" value={setupEmail || email} readOnly={!!setupEmail} required maxLength={254} onChange={event => setEmail(event.target.value)} /></label>
    <label>{setupEmail ? '设置密码' : '密码'}<input aria-label="密码" type="password" autoComplete={setupEmail ? 'new-password' : 'current-password'} minLength={setupEmail ? 10 : undefined} maxLength={128} placeholder={setupEmail ? '至少 10 位' : ''} required value={password} onChange={event => setPassword(event.target.value)} /></label>
    {setupEmail && <label>确认密码<input aria-label="确认密码" type="password" autoComplete="new-password" required maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
    {error && <p className="cloud-error" role="alert">{error}</p>}
    <button className="wide-button primary-button" disabled={busy} type="submit">{busy ? '正在处理…' : setupEmail ? '保存并登录' : '登录'}</button>
    <div className="auth-links"><a href="/api/auth/start?mode=register">注册账号</a><a href="/api/auth/start?mode=reset">{setupEmail ? '重新验证邮箱' : '忘记密码'}</a></div>
  </form>;
}
