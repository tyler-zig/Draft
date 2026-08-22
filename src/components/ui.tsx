import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Mark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
    >
      <rect width="32" height="32" rx="7" className="fill-panel-2" />
      <path
        d="M8 8l8 8-8 8"
        fill="none"
        className="stroke-accent"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 8l8 8-8 8"
        fill="none"
        className="stroke-accent"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".45"
      />
    </svg>
  )
}

export function Logo({
  compact = false,
  to,
}: {
  compact?: boolean
  to?: string
}) {
  const inner = (
    <span className="inline-flex items-center gap-2">
      <Mark />
      {compact ? null : (
        <span className="text-[15px] font-semibold tracking-tight">
          Draft Assistant
        </span>
      )}
    </span>
  )
  if (to) {
    return (
      <Link to={to} className="rounded-md hover:opacity-90">
        {inner}
      </Link>
    )
  }
  return inner
}

export function Btn({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet'
}) {
  const styles = {
    primary:
      'bg-accent text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
    ghost:
      'border border-line bg-transparent text-muted hover:border-accent/40 hover:text-ink disabled:opacity-50',
    quiet:
      'bg-panel-2 text-ink hover:bg-line/70 disabled:opacity-50',
  }[variant]
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-semibold ${styles} ${className}`}
      {...props}
    />
  )
}

export function Pill({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'live' | 'warn' | 'accent'
  children: ReactNode
}) {
  const styles = {
    muted: 'border-line text-muted',
    live: 'border-accent/40 bg-accent-dim text-accent',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    accent: 'border-accent/30 text-accent',
  }[tone]
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles}`}
    >
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="pointer-events-none rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted">
      {children}
    </kbd>
  )
}

export function AppScreen({
  title,
  body,
  action,
  busy = false,
}: {
  title: string
  body?: string
  action?: ReactNode
  busy?: boolean
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-bg px-6">
      <Logo />
      {busy ? <div className="spinner mt-8" /> : null}
      <h1 className="mt-6 text-lg font-semibold tracking-tight">{title}</h1>
      {body ? (
        <p className="mt-2 max-w-sm text-center text-sm leading-6 text-muted">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
