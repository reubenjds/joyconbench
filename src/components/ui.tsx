import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import type { DiagnosticStatus } from '../types/controller';

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`.trim()} {...props} />;
}

export function Panel({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`panel ${className}`.trim()} {...props} />;
}

export function StatusLabel({
  status,
  children,
}: {
  status: DiagnosticStatus;
  children: ReactNode;
}) {
  return (
    <span className={`status-label status-${status}`}>
      <span className="status-marker" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  className = '',
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <Button className="button-text" onClick={onClose} aria-label="Close dialog">
            Close
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}
