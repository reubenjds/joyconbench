export interface StageDefinition {
  id: string;
  short: string;
}

export function StageRail({ stages, active }: { stages: StageDefinition[]; active: number }) {
  return (
    <nav className="stage-rail" aria-label="Diagnostic stages">
      <ol>
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className={index === active ? 'stage-active' : index < active ? 'stage-complete' : ''}
            aria-current={index === active ? 'step' : undefined}
          >
            <span className="stage-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="stage-name">{stage.short}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
