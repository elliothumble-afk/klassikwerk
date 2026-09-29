interface Props {
  title?: string
  message: string
  retry?: () => void
}

export function ErrorState({ title = 'Something went wrong', message, retry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--color-danger-light)] flex items-center justify-center mb-4">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="10" cy="10" r="7" stroke="var(--color-danger)" strokeWidth="1.5" />
          <path d="M10 7v4M10 13v.5" stroke="var(--color-danger)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="font-medium text-[var(--color-foreground)] mb-1">{title}</p>
      <p className="text-sm text-[var(--color-muted)] max-w-xs mb-4">{message}</p>
      {retry && (
        <button
          onClick={retry}
          className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline underline-offset-2"
        >
          Try again
        </button>
      )}
    </div>
  )
}
