interface Props {
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--color-accent-light)] flex items-center justify-center mb-4">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x="3" y="5" width="14" height="10" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" />
          <path d="M7 9h6M7 12h4" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="font-medium text-[var(--color-foreground)] mb-1">{title}</p>
      {description && (
        <p className="text-sm text-[var(--color-muted)] max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
