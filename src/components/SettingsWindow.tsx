'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Select, { MultiValue, StylesConfig, ThemeConfig } from 'react-select';
import { User, UserPlus, Search, LifeBuoy, LogOut, Mail, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Rnd } from 'react-rnd';

/* ----------------------------------------------------------------------------
   Types
---------------------------------------------------------------------------- */
type Section = 'profile' | 'createUser' | 'support';

type Role = { id: number; name: string };
type Perm = { id: number; name: string; description?: string };
type RoleWithPerms = { id: number; name: string; permissions: { name: string }[] };

type Option = { value: string; label: string; description?: string };

type ApiResp<T> = { error?: string } & T;

type Props = {
  zIndex?: number;
  initialPos?: { x: number; y: number };
  initialSize?: { w: number; h: number };
  onClose?: () => void;
  onMinimize?: () => void;
  onFocus?: () => void;
  initialSection?: Section;
  centerOnOpen?: boolean;
  profileName?: string;         // fallback if /me fails
  profileEmail?: string;        // fallback if /me fails
  profileAvatarUrl?: string;    // optional avatar
};

/* ----------------------------------------------------------------------------
   Helpers
---------------------------------------------------------------------------- */
const ACCENT = '#2563eb';
const lightTheme: ThemeConfig = (theme) => ({
  ...theme,
  colors: {
    ...theme.colors,
    primary: ACCENT,
    primary25: 'rgba(37,99,235,0.12)',
    neutral0: '#ffffff',
    neutral10: '#f8fafc',
    neutral20: '#e2e8f0',
    neutral30: '#cbd5e1',
    neutral40: '#94a3b8',
    neutral50: '#64748b',
    neutral60: '#475569',
    neutral70: '#334155',
    neutral80: '#1f2937',
    neutral90: '#0f172a',
  },
});
function rsStyles(isMobile: boolean): StylesConfig<Option, true> {
  return {
    control: (base, state) => ({
      ...base,
      backgroundColor: '#ffffff',
      borderColor: state.isFocused ? 'rgba(37,99,235,0.6)' : '#e2e8f0',
      boxShadow: 'none',
      minHeight: isMobile ? 34 : 40,
      borderRadius: 12,
      ':hover': { borderColor: '#cbd5e1' },
    }),
    valueContainer: (b) => ({ ...b, padding: isMobile ? '2px 8px' : '6px 10px' }),
    menu: (base) => ({
      ...base,
      backgroundColor: 'rgba(255,255,255,0.95)',
      border: '1px solid rgba(148,163,184,0.35)',
      backdropFilter: 'blur(10px)',
      zIndex: 9999,
      borderRadius: 12,
      overflow: 'hidden',
    }),
    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? 'rgba(37,99,235,0.18)'
        : state.isFocused
        ? 'rgba(2,6,23,0.04)'
        : 'transparent',
      color: '#0f172a',
      paddingTop: isMobile ? 6 : 10,
      paddingBottom: isMobile ? 6 : 10,
    }),
    multiValue: (base) => ({ ...base, backgroundColor: 'rgba(37,99,235,0.12)' }),
    multiValueLabel: (base) => ({ ...base, color: '#0f172a' }),
    multiValueRemove: (base) => ({
      ...base,
      color: '#0f172a',
      ':hover': { backgroundColor: 'rgba(2,6,23,0.06)', color: '#0f172a' },
    }),
    input: (b) => ({ ...b, color: '#0f172a' }),
    placeholder: (b) => ({ ...b, color: '#64748b' }),
    singleValue: (b) => ({ ...b, color: '#0f172a' }),
  };
}

async function safeJson<T>(p: Promise<Response>): Promise<ApiResp<T> | null> {
  try {
    const res = await p;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return null;
    const data = (await res.json()) as ApiResp<T>;
    return { ...data, ...(res.ok ? {} : { error: data?.error ?? 'Request failed' }) };
  } catch {
    return null;
  }
}
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

/* ----------------------------------------------------------------------------
   Component
---------------------------------------------------------------------------- */
export default function SettingsWindow({
  zIndex = 100,
  initialSize = { w: 760, h: 520 },
  initialPos = { x: 0, y: 0 },
  onClose, onMinimize, onFocus,
  initialSection = 'profile',
  centerOnOpen = true,
  profileName: fallbackName = 'Admin',
  profileEmail: fallbackEmail = 'admin@company.com',
  profileAvatarUrl,
}: Props) {
  /* responsive */
  const [viewport, setViewport] = useState({ w: 1024, h: 768 });
  const isMobile = viewport.w < 768;
  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read(); window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  /* window (drag/center/min/max) */
  const [pos, setPos] = useState(initialPos);
  const [size, setSize] = useState(initialSize);
  const [maximized, setMaximized] = useState(false);

  const MIN_W = isMobile ? 320 : 760;
  const MIN_H = isMobile ? 520 : 520;

  const frame = useMemo(() => {
    if (isMobile) return { w: viewport.w, h: viewport.h };
    if (maximized) {
      const PAD = 12;
      return {
        w: Math.max(viewport.w - PAD * 2, MIN_W),
        h: Math.max(viewport.h - PAD * 2, MIN_H),
      };
    }
    return { w: Math.max(size.w, MIN_W), h: Math.max(size.h, MIN_H) };
  }, [isMobile, maximized, viewport.w, viewport.h, size.w, size.h]);

  useEffect(() => {
    if (isMobile) return;
    if (maximized) {
      setPos({ x: 12, y: 12 });
      return;
    }
    if (!centerOnOpen) return;
    const x = Math.max(8, Math.round((viewport.w - frame.w) / 2));
    const y = Math.max(8, Math.round((viewport.h - frame.h) / 2));
    setPos({ x, y });
  }, [isMobile, maximized, centerOnOpen, frame.w, frame.h, viewport.w, viewport.h]);

  const focus = () => onFocus?.();

  /* header (live) */
  const [headerName, setHeaderName] = useState(fallbackName);
  const [headerEmail, setHeaderEmail] = useState(fallbackEmail);

  useEffect(() => {
    (async () => {
      const data = await safeJson<{ user?: { email?: string } }>(fetch('/api/auth/me', { cache: 'no-store' }));
      const email = data?.user?.email;
      if (email) {
        setHeaderEmail(email);
        setHeaderName(email.split('@')[0] || 'Admin');
        setNewEmail(email);
      }
    })();
  }, []);

  /* section */
  const [section, setSection] = useState<Section>(initialSection);

  /* ---------------- Profile form state ---------------- */
  const [newEmail, setNewEmail] = useState(fallbackEmail);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] =
    useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  type UpdateAdminBody = {
    newEmail?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  async function submitProfile() {
    setProfileMsg(null);

    if (newPassword || confirmPassword || currentPassword) {
      if (newPassword.length < 8) {
        setProfileMsg({ kind: 'err', text: 'New password must be at least 8 characters.' });
        return;
      }
      if (newPassword !== confirmPassword) {
        setProfileMsg({ kind: 'err', text: 'New passwords do not match.' });
        return;
      }
      if (!currentPassword) {
        setProfileMsg({ kind: 'err', text: 'Enter your current password to change it.' });
        return;
      }
    }

    const body: UpdateAdminBody = {};
    if (newEmail && newEmail !== headerEmail) body.newEmail = newEmail;
    if (newPassword) { body.currentPassword = currentPassword; body.newPassword = newPassword; }
    if (Object.keys(body).length === 0) {
      setProfileMsg({ kind: 'err', text: 'Nothing to update.' });
      return;
    }

    setProfileBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMsg({ kind: 'err', text: data?.error ?? 'Update failed' });
        return;
      }
      const updatedEmail: string | undefined = data?.user?.email;
      if (updatedEmail) {
        setHeaderEmail(updatedEmail);
        setHeaderName(updatedEmail.split('@')[0] || 'Admin');
        setNewEmail(updatedEmail);
      }
      setProfileMsg({ kind: 'ok', text: 'Profile updated.' });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch {
      setProfileMsg({ kind: 'err', text: 'Network error' });
    } finally {
      setProfileBusy(false);
    }
  }

  /* ---------------- Create user state ---------------- */
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [emptyMeta, setEmptyMeta] = useState(false);

  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [rolePermMap, setRolePermMap] = useState<Record<string, string[]>>({}); // ROLE -> [perm]

  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRoles, setURoles] = useState<string[]>([]);
  const [uPerms, setUPerms] = useState<string[]>([]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] =
    useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingMeta(true);
      setEmptyMeta(false);
      try {
        const base = await safeJson<{ roles?: Role[]; permissions?: Perm[] }>(fetch('/api/admin', { cache: 'no-store' }));
        const mapRes = await safeJson<{ roles?: RoleWithPerms[] }>(fetch('/api/admin/roles', { cache: 'no-store' }));

        const r = base?.roles ?? [];
        const p = base?.permissions ?? [];
        setRoles(r);
        setPerms(p);

        const list = mapRes?.roles ?? [];
        const m: Record<string, string[]> = {};
        for (const role of list) m[role.name] = uniq(role.permissions.map((x) => x.name));
        setRolePermMap(m);

        if (r.length === 0 && p.length === 0) setEmptyMeta(true);
      } catch {
        setEmptyMeta(true);
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (uRoles.length === 0) return;
    const auto = uniq(uRoles.flatMap((name) => rolePermMap[name] ?? []));
    setUPerms((prev) => uniq([...prev, ...auto]));
  }, [uRoles, rolePermMap]);

  const roleOptions: Option[] = roles.map((r) => ({ value: r.name, label: r.name }));
  const permOptions: Option[] = perms.map((p) => ({ value: p.name, label: p.name, description: p.description }));

  const selectStyleObj = useMemo(() => rsStyles(isMobile), [isMobile]);
  const menuPortalTarget = typeof window === 'undefined' ? undefined : document.body;

  async function submitCreate() {
    setCreateMsg(null);
    if (!uEmail || !uPassword) {
      setCreateMsg({ kind: 'err', text: 'Email and password are required.' });
      return;
    }
    setCreateBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: uEmail, password: uPassword, roles: uRoles, permissions: uPerms }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateMsg({ kind: 'err', text: data?.error ?? 'Failed to create user' });
      } else {
        const createdEmail = data?.user?.email ?? uEmail;
        setCreateMsg({ kind: 'ok', text: `User created: ${createdEmail}` });
        setUEmail(''); setUPassword(''); setURoles([]); setUPerms([]);
      }
    } catch {
      setCreateMsg({ kind: 'err', text: 'Network error' });
    } finally {
      setCreateBusy(false);
    }
  }

  /* ---------------- Support state ---------------- */
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [includeSystem, setIncludeSystem] = useState(true);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportMsg, setSupportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submitSupport(e?: React.FormEvent) {
    e?.preventDefault();
    setSupportMsg(null);
    if (!supportSubject || !supportMessage) {
      setSupportMsg({ kind: 'err', text: 'Please enter a subject and message.' });
      return;
    }
    setSupportBusy(true);
    try {
      const payload = {
        subject: supportSubject,
        message: supportMessage,
        from: headerEmail,
        info: includeSystem
          ? {
              userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
              tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : undefined,
      };
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSupportMsg({ kind: 'err', text: data?.error ?? 'Failed to send message' });
      } else {
        setSupportMsg({ kind: 'ok', text: 'Thanks! Your message has been sent.' });
        setSupportSubject(''); setSupportMessage('');
      }
    } catch {
      setSupportMsg({ kind: 'err', text: 'Network error' });
    } finally {
      setSupportBusy(false);
    }
  }

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
    try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch {}
    try { await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' }); } catch {}
    window.location.href = '/login';
  }

  /* style for mobile CSS var without `any` */
  const mobileRootStyle = useMemo(
    () => ({ '--z': zIndex } as React.CSSProperties & Record<'--z', number>),
    [zIndex]
  );

  /* ---------------- Mobile layout ---------------- */
  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[var(--z,100)] flex flex-col bg-white/30 backdrop-blur-xl"
        style={mobileRootStyle}
        onMouseDown={focus}
      >
        {/* Header */}
        <header
          className="sticky top-0 z-10 border-b border-slate-200/60 bg-white/75 backdrop-blur-xl"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="h-12 flex items-center px-3">
            <button
              onClick={() => onClose?.()}
              className="px-2 py-1 text-[13px] text-slate-700 rounded hover:bg-black/5"
            >
              Close
            </button>
            <div className="mx-auto text-[15px] font-medium text-slate-900">Settings</div>
            <button
              onClick={logout}
              className="flex items-center gap-1 px-2 py-1 text-[12px] text-rose-600 rounded hover:bg-rose-50"
              title="Logout"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-3 pb-[calc(64px+env(safe-area-inset-bottom,0))] pt-3">
          {section === 'profile' && (
            <div className="mx-auto w-full max-w-[320px]">
              {/* mini profile */}
              <div className="mb-3 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-xl p-3">
                <div className="flex items-center gap-3">
                  {profileAvatarUrl ? (
                    <Image
                      src={profileAvatarUrl}
                      alt="avatar"
                      width={40}
                      height={40}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 border border-slate-200 grid place-items-center text-slate-700 text-sm font-semibold">
                      {headerName?.[0] ?? 'A'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900 truncate">{headerName}</div>
                    <div className="text-[12px] text-slate-500 truncate">{headerEmail}</div>
                  </div>
                </div>
              </div>

              {/* profile form */}
              <div className="rounded-2xl bg-white/75 border border-slate-200/70 backdrop-blur-xl p-4 space-y-4">
                <h3 className="text-[15px] font-semibold text-slate-900">Profile</h3>

                <div className="space-y-1">
                  <Label htmlFor="m_email" className="text-slate-700 text-xs">Email</Label>
                  <Input id="m_email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-10" />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="m_current" className="text-slate-700 text-xs">Current Password</Label>
                  <Input id="m_current" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="h-10" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="m_new" className="text-slate-700 text-xs">New Password</Label>
                  <Input id="m_new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-10" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="m_confirm" className="text-slate-700 text-xs">Confirm New Password</Label>
                  <Input id="m_confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-10" />
                </div>

                {profileMsg && (
                  <p className={`text-sm ${profileMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{profileMsg.text}</p>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="h-9 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                    onClick={() => { setNewEmail(headerEmail); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setProfileMsg(null); }}
                    disabled={profileBusy}
                  >
                    Reset
                  </Button>
                  <Button className="h-9 bg-blue-600 hover:bg-blue-700 text-white" onClick={submitProfile} disabled={profileBusy}>
                    {profileBusy ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {section === 'createUser' && (
            <div className="mx-auto w-full max-w-[320px]">
              <div className="rounded-2xl bg-white/75 border border-slate-200/70 backdrop-blur-xl p-4 space-y-4">
                <h3 className="text-[15px] font-semibold text-slate-900">Create New User</h3>

                <div className="space-y-1">
                  <Label className="text-slate-700 text-xs">Email</Label>
                  <Input value={uEmail} onChange={(e) => setUEmail(e.target.value)} className="h-10" />
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-700 text-xs">Password</Label>
                  <Input type="password" value={uPassword} onChange={(e) => setUPassword(e.target.value)} className="h-10" />
                </div>

                <div className="space-y-1">
                  <Label className="text-slate-700 text-xs">Assign Roles</Label>
                  <Select
                    isMulti isLoading={loadingMeta}
                    options={roleOptions}
                    value={roleOptions.filter((o) => uRoles.includes(o.value))}
                    onChange={(vals) => setURoles((vals as MultiValue<Option>).map((v) => v.value))}
                    theme={lightTheme} styles={selectStyleObj} classNamePrefix="rs" placeholder="Select roles…"
                    menuPortalTarget={menuPortalTarget} menuPosition="fixed"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-slate-700 text-xs">Permissions</Label>
                  <Select
                    isMulti isLoading={loadingMeta}
                    options={permOptions}
                    value={permOptions.filter((o) => uPerms.includes(o.value))}
                    onChange={(vals) => setUPerms((vals as MultiValue<Option>).map((v) => v.value))}
                    theme={lightTheme} styles={selectStyleObj} classNamePrefix="rs" placeholder="Select permissions…"
                    formatOptionLabel={(opt) => (
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        {opt.description ? <span className="text-[11px] text-slate-500">{opt.description}</span> : null}
                      </div>
                    )}
                    menuPortalTarget={menuPortalTarget} menuPosition="fixed"
                  />
                </div>

                {createMsg && (
                  <p className={`text-sm ${createMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{createMsg.text}</p>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    className="h-9 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                    onClick={() => { setUEmail(''); setUPassword(''); setURoles([]); setUPerms([]); setCreateMsg(null); }}
                    disabled={createBusy}
                  >
                    Reset
                  </Button>
                  <Button className="h-9 bg-blue-600 hover:bg-blue-700 text-white" onClick={submitCreate} disabled={createBusy}>
                    {createBusy ? 'Creating…' : 'Create User'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {section === 'support' && (
            <div className="mx-auto w-full max-w-[360px]">
              <div className="rounded-2xl bg-white/75 border border-slate-200/70 backdrop-blur-xl p-4 space-y-4">
                <h3 className="text-[15px] font-semibold text-slate-900">Contact & Support</h3>

                <div className="grid grid-cols-3 gap-2">
                  <a href="mailto:support@yourapp.com" className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2 grid place-items-center text-slate-700 hover:bg-white">
                    <Mail className="w-4 h-4" />
                    <span className="text-[11px] mt-1">Email</span>
                  </a>
                  <a href="https://wa.me/0000000000" target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2 grid place-items-center text-slate-700 hover:bg-white">
                    <MessageCircle className="w-4 h-4" />
                    <span className="text-[11px] mt-1">WhatsApp</span>
                  </a>
                  <a href="tel:+10000000000" className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2 grid place-items-center text-slate-700 hover:bg-white">
                    <Phone className="w-4 h-4" />
                    <span className="text-[11px] mt-1">Call</span>
                  </a>
                </div>

                <form onSubmit={submitSupport} className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-slate-700 text-xs">Subject</Label>
                    <Input value={supportSubject} onChange={(e) => setSupportSubject(e.target.value)} className="h-10" placeholder="Brief summary" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-700 text-xs">Message</Label>
                    <textarea
                      value={supportMessage}
                      onChange={(e) => setSupportMessage(e.target.value)}
                      className="w-full h-28 rounded-md border border-slate-200 bg-white/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300/50"
                      placeholder="Tell us what's going on…"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={includeSystem} onChange={(e) => setIncludeSystem(e.target.checked)} />
                    Include system info (helps us debug)
                  </label>

                  {supportMsg && (
                    <p className={`text-sm ${supportMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{supportMsg.text}</p>
                  )}

                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" className="h-9 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                      onClick={() => { setSupportSubject(''); setSupportMessage(''); setSupportMsg(null); }} disabled={supportBusy}>
                      Reset
                    </Button>
                    <Button type="submit" className="h-9 bg-blue-600 hover:bg-blue-700 text-white" disabled={supportBusy}>
                      {supportBusy ? 'Sending…' : 'Send'}
                    </Button>
                  </div>
                </form>

                <div className="pt-2 border-t border-slate-200/60">
                  <Button onClick={logout} className="w-full h-9 bg-rose-600 hover:bg-rose-700 text-white">
                    <LogOut className="w-4 h-4 mr-2" /> Logout
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Bottom tabs */}
        <nav
          className="fixed left-0 right-0 bottom-0 border-t border-slate-200/60 bg-white/80 backdrop-blur-xl"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0) + 8px)' }}
        >
          <div className="mx-auto max-w-lg grid grid-cols-3 gap-1 px-4 py-2">
            <TabButton active={section === 'profile'} onClick={() => setSection('profile')} icon={<User className="h-5 w-5" />} label="Profile" />
            <TabButton active={section === 'createUser'} onClick={() => setSection('createUser')} icon={<UserPlus className="h-5 w-5" />} label="Create" />
            <TabButton active={section === 'support'} onClick={() => setSection('support')} icon={<LifeBuoy className="h-5 w-5" />} label="Support" />
          </div>
        </nav>
      </div>
    );
  }

  /* ---------------- Desktop layout ---------------- */
  return (
    <Rnd
      default={{
        x: Math.max(8, Math.round((viewport.w - frame.w) / 2)),
        y: Math.max(8, Math.round((viewport.h - frame.h) / 2)),
        width: frame.w,
        height: frame.h,
      }}
      position={{ x: pos.x, y: pos.y }}
      size={{ width: frame.w, height: frame.h }}
      minWidth={MIN_W}
      minHeight={MIN_H}
      bounds="window"
      enableResizing={!maximized}
      disableDragging={maximized}
      dragHandleClassName="ios-window-titlebar"
      onDragStart={() => onFocus?.()}
      onDragStop={(_, data) => {
        setPos({ x: data.x, y: data.y });
        onFocus?.();
      }}
      onResizeStart={() => onFocus?.()}
      onResizeStop={(_e, _dir, ref, _delta, newPos) => {
        setSize({ w: ref.offsetWidth, h: ref.offsetHeight });
        setPos({ x: newPos.x, y: newPos.y });
        onFocus?.();
      }}
      style={{
        zIndex,
        position: 'absolute',
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100dvh - 16px)',
        overflow: 'hidden',
        borderRadius: '18px',
        background: 'rgba(255,255,255,0.14)',
        backdropFilter: 'blur(22px) saturate(120%)',
        WebkitBackdropFilter: 'blur(22px) saturate(120%)',
        border: '1px solid rgba(255,255,255,0.28)',
        boxShadow: '0 18px 60px rgba(2,6,23,0.22)',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={() => onFocus?.()}
    >
      {/* Titlebar */}
      <div
        className="
          ios-window-titlebar
          relative flex items-center justify-between
          px-3 py-2 border-b border-white/25 text-slate-900 select-none
          bg-white/20
        "
      >
        <div className="absolute left-1/2 -translate-x-1/2 -top-1.5">
          <div className="h-1.5 w-14 rounded-full bg-white/60" />
        </div>

        <div className="flex items-center gap-2">
          <button aria-label="Close" onClick={onClose} className="w-3.5 h-3.5 rounded-full" style={{ background: '#ff5f57' }} />
          <button aria-label="Minimize" onClick={onMinimize} className="w-3.5 h-3.5 rounded-full" style={{ background: '#febc2e' }} />
          <button
            aria-label="Zoom"
            onClick={() => setMaximized(v => !v)}
            className="w-3.5 h-3.5 rounded-full"
            style={{ background: '#28c840' }}
            title="Zoom"
          />
          <span className="ml-2 text-sm/5 text-slate-800/90">Settings</span>
        </div>

        {/* <div className="flex items-center gap-2">
          <Button onClick={() => setSection('support')} variant="outline" className="h-8">
            <LifeBuoy className="w-4 h-4 mr-1" /> Support
          </Button>
          <Button onClick={logout} className="h-8 bg-rose-600 hover:bg-rose-700 text-white">
            <LogOut className="w-4 h-4 mr-1" /> Logout
          </Button>
        </div> */}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar */}
        <aside className="w-64 h-full flex-shrink-0 overflow-y-auto border-r border-white/25 bg-white/10">
          <div className="p-3 border-b border-white/20">
            <div className="flex items-center gap-3">
              {profileAvatarUrl ? (
                <Image
                  src={profileAvatarUrl}
                  alt="Profile"
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-full object-cover border border-white/30"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 border border-white/30 grid place-items-center text-slate-700 text-sm font-semibold">
                  {headerName?.[0] ?? 'A'}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">{headerName}</div>
                <div className="text-xs text-slate-600/90 truncate">{headerEmail}</div>
              </div>
            </div>

            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text" placeholder="Search"
                className="w-full pl-9 pr-3 h-9 rounded-lg bg-white/50 border border-white/40 text-sm text-slate-900 placeholder-slate-500 outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-400"
              />
            </div>
          </div>

          <nav className="flex-1 overflow-auto py-2">
            {[
              { key: 'profile', label: 'Profile', icon: <User className="w-5 h-5" /> },
              { key: 'createUser', label: 'Create User', icon: <UserPlus className="w-5 h-5" /> },
              { key: 'support', label: 'Contact & Support', icon: <LifeBuoy className="w-5 h-5" /> },
            ].map((item) => {
              const active = section === (item.key as Section);
              return (
                <button
                  key={item.key}
                  onClick={() => setSection(item.key as Section)}
                  className={`flex items-center gap-3 px-3 py-2.5 w-full transition
                    ${active
                      ? 'bg-white/35 text-blue-700 border-l-2 border-blue-500'
                      : 'text-slate-800 hover:bg-white/25'
                    }`}
                  title={item.label}
                >
                  {item.icon}
                  <span className="text-sm">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 md:p-6">
          {section === 'profile' && (
            <div className="max-w-xl">
              <div className="rounded-2xl bg-white/40 border border-white/35 backdrop-blur-2xl p-6 space-y-4">
                <h3 className="text-xl font-semibold text-slate-900">Profile</h3>

                <div className="space-y-1">
                  <Label htmlFor="email" className="text-slate-700 text-xs">Email</Label>
                  <Input id="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@company.com" className="h-10" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="current" className="text-slate-700 text-xs">Current Password</Label>
                    <Input id="current" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="h-10" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="newpw" className="text-slate-700 text-xs">New Password</Label>
                    <Input id="newpw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-10" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label htmlFor="confirm" className="text-slate-700 text-xs">Confirm New Password</Label>
                    <Input id="confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-10" />
                  </div>
                </div>

                {profileMsg && (
                  <p className={`text-sm ${profileMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{profileMsg.text}</p>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    className="h-9 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                    onClick={() => { setNewEmail(headerEmail); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setProfileMsg(null); }}
                    disabled={profileBusy}
                  >
                    Reset
                  </Button>
                  <Button className="h-9 bg-blue-600 hover:bg-blue-700 text-white" onClick={submitProfile} disabled={profileBusy}>
                    {profileBusy ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {section === 'createUser' && (
            <div className="max-w-3xl">
              <div className="rounded-2xl bg-white/40 border border-white/35 backdrop-blur-2xl p-6 space-y-4">
                <h3 className="text-xl font-semibold text-slate-900">Create New User</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-slate-700 text-xs">Email</Label>
                    <Input value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="user@company.com" className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-700 text-xs">Password</Label>
                    <Input type="password" value={uPassword} onChange={(e) => setUPassword(e.target.value)} placeholder="Strong password" className="h-9" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-slate-700 text-xs">Assign Roles</Label>
                    <Select
                      isMulti isLoading={loadingMeta}
                      options={roleOptions}
                      value={roleOptions.filter((o) => uRoles.includes(o.value))}
                      onChange={(vals) => setURoles((vals as MultiValue<Option>).map((v) => v.value))}
                      theme={lightTheme} styles={selectStyleObj} classNamePrefix="rs" placeholder="Select roles…"
                      menuPortalTarget={menuPortalTarget} menuPosition="fixed"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-slate-700 text-xs">Permissions</Label>
                    <Select
                      isMulti isLoading={loadingMeta}
                      options={permOptions}
                      value={permOptions.filter((o) => uPerms.includes(o.value))}
                      onChange={(vals) => setUPerms((vals as MultiValue<Option>).map((v) => v.value))}
                      theme={lightTheme} styles={selectStyleObj} classNamePrefix="rs" placeholder="Select permissions…"
                      formatOptionLabel={(opt) => (
                        <div className="flex flex-col">
                          <span>{opt.label}</span>
                          {opt.description ? <span className="text-[11px] text-slate-500">{opt.description}</span> : null}
                        </div>
                      )}
                      menuPortalTarget={menuPortalTarget} menuPosition="fixed"
                    />
                  </div>
                </div>

                {createMsg && (
                  <p className={`text-sm ${createMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{createMsg.text}</p>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    className="h-9 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                    onClick={() => { setUEmail(''); setUPassword(''); setURoles([]); setUPerms([]); setCreateMsg(null); }}
                    disabled={createBusy}
                  >
                    Reset
                  </Button>
                  <Button className="h-9 bg-blue-600 hover:bg-blue-700 text-white" onClick={submitCreate} disabled={createBusy}>
                    {createBusy ? 'Creating…' : 'Create User'}
                  </Button>

                  {!loadingMeta && emptyMeta && (
                    <Button
                      variant="outline"
                      className="h-9 ml-auto border-slate-300 text-slate-700 hover:bg-slate-100"
                      onClick={async () => {
                        const res = await fetch('/api/admin/bootstrap', { method: 'POST' });
                        const data = await safeJson(res as unknown as Promise<Response>);
                        if (!('error' in (data ?? {}))) {
                          const again = await safeJson<{ roles?: Role[]; permissions?: Perm[] }>(fetch('/api/admin', { cache: 'no-store' }));
                          setRoles(again?.roles ?? []); setPerms(again?.permissions ?? []);
                        }
                      }}
                    >
                      Seed Roles & Permissions
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {section === 'support' && (
            <div className="max-w-3xl">
              <div className="rounded-2xl bg-white/40 border border-white/35 backdrop-blur-2xl p-6 space-y-6">
                <div className="flex items-center gap-2">
                  <LifeBuoy className="w-5 h-5 text-blue-600" />
                  <h3 className="text-xl font-semibold text-slate-900">Contact & Support</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <a href="mailto:support@yourapp.com" className="rounded-xl border border-white/40 bg-white/70 px-4 py-3 flex items-center gap-3 hover:bg-white">
                    <Mail className="w-4 h-4 text-slate-700" />
                    <div>
                      <div className="text-sm font-medium text-slate-800">Email</div>
                      <div className="text-xs text-slate-600">support@yourapp.com</div>
                    </div>
                  </a>
                  <a href="https://wa.me/0000000000" target="_blank" rel="noreferrer" className="rounded-xl border border-white/40 bg-white/70 px-4 py-3 flex items-center gap-3 hover:bg-white">
                    <MessageCircle className="w-4 h-4 text-slate-700" />
                    <div>
                      <div className="text-sm font-medium text-slate-800">WhatsApp</div>
                      <div className="text-xs text-slate-600">Chat with us</div>
                    </div>
                  </a>
                  <a href="tel:+10000000000" className="rounded-xl border border-white/40 bg-white/70 px-4 py-3 flex items-center gap-3 hover:bg-white">
                    <Phone className="w-4 h-4 text-slate-700" />
                    <div>
                      <div className="text-sm font-medium text-slate-800">Phone</div>
                      <div className="text-xs text-slate-600">+1 000 000 0000</div>
                    </div>
                  </a>
                </div>

                <form onSubmit={submitSupport} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-slate-700 text-xs">Your Email</Label>
                      <Input value={headerEmail} readOnly className="h-10 bg-white/70" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-slate-700 text-xs">Subject</Label>
                      <Input value={supportSubject} onChange={(e) => setSupportSubject(e.target.value)} className="h-10" placeholder="Brief summary" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-slate-700 text-xs">Message</Label>
                    <textarea
                      value={supportMessage}
                      onChange={(e) => setSupportMessage(e.target.value)}
                      className="w-full h-36 rounded-md border border-slate-200 bg-white/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300/50"
                      placeholder="Tell us what's going on…"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={includeSystem} onChange={(e) => setIncludeSystem(e.target.checked)} />
                    Include system info (helps us debug)
                  </label>

                  {supportMsg && (
                    <p className={`text-sm ${supportMsg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{supportMsg.text}</p>
                  )}

                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" className="h-9 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                      onClick={() => { setSupportSubject(''); setSupportMessage(''); setSupportMsg(null); }} disabled={supportBusy}>
                      Reset
                    </Button>
                    <Button type="submit" className="h-9 bg-blue-600 hover:bg-blue-700 text-white" disabled={supportBusy}>
                      {supportBusy ? 'Sending…' : 'Send Message'}
                    </Button>
                    <Button onClick={logout} className="h-9 ml-auto bg-rose-600 hover:bg-rose-700 text-white">
                      <LogOut className="w-4 h-4 mr-2" /> Logout
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    </Rnd>
  );
}

/* ----------------------------------------------------------------------------
   Small mobile tab button
---------------------------------------------------------------------------- */
function TabButton({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center h-12 rounded-xl transition
        ${active ? 'bg-white/70 text-slate-900' : 'text-slate-700 hover:bg-white/60'}`}
    >
      <span>{icon}</span>
      <span className="text-[11px] leading-none mt-0.5">{label}</span>
    </button>
  );
}
