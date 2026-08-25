import type { ControllerIdentity, DiagnosticReport, DiagnosticResult } from '../types/controller';

function browserSummary() {
  if (navigator.userAgentData) {
    const browser = navigator.userAgentData.brands
      .filter(({ brand }) => !brand.toLowerCase().includes('not'))
      .map(({ brand, version }) => `${brand} ${version}`)
      .join(', ');
    return { name: browser || 'Chromium browser', platform: navigator.userAgentData.platform };
  }
  const name = navigator.userAgent.includes('Edg/')
    ? 'Microsoft Edge'
    : navigator.userAgent.includes('Chrome/')
      ? 'Chromium browser'
      : 'Unsupported or unknown browser';
  const platform = /Windows/i.test(navigator.userAgent)
    ? 'Windows'
    : /Macintosh|Mac OS/i.test(navigator.userAgent)
      ? 'macOS'
      : /Linux/i.test(navigator.userAgent)
        ? 'Linux'
        : 'Unknown platform';
  return { name, platform };
}

export function buildReport(
  identity: ControllerIdentity,
  results: DiagnosticResult[],
  includeDeviceIds = false,
  createdAt = new Date()
): DiagnosticReport {
  return {
    schemaVersion: 1,
    applicationVersion: __APP_VERSION__,
    browser: browserSummary(),
    controller: {
      kind: identity.kind,
      connection: identity.connection,
      ...(includeDeviceIds ? { vendorId: identity.vendorId, productId: identity.productId } : {}),
    },
    results,
    createdAt: createdAt.toISOString(),
    privacy: { rawSamplesIncluded: false, identifyingValuesIncluded: false },
  };
}

export function reportSummary(report: DiagnosticReport) {
  const counts = report.results.reduce<Record<string, number>>((all, result) => {
    all[result.status] = (all[result.status] ?? 0) + 1;
    return all;
  }, {});
  const notable = report.results.filter((result) => result.status === 'potential-issue');
  const lines = [
    'JoyConBench diagnostic summary',
    `Controller: ${report.controller.kind} (${report.controller.connection})`,
    `Created: ${report.createdAt}`,
    `Results: ${counts.pass ?? 0} pass, ${counts['potential-issue'] ?? 0} potential issue, ${counts.inconclusive ?? 0} inconclusive, ${counts.skipped ?? 0} skipped`,
  ];
  if (notable.length) {
    lines.push('', 'Potential issues:');
    for (const result of notable) lines.push(`- ${result.title}: ${result.interpretation}`);
  }
  lines.push('', 'Generated locally by JoyConBench. No raw controller data is included.');
  return lines.join('\n');
}

export function downloadReport(report: DiagnosticReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `joyconbench-report-${report.createdAt.replace(/[:.]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
