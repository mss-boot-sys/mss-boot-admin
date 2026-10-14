import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContainer, PageShell } from '../package/runtime';

// Business hosts import from the package entry, not from src/; the deprecated
// v1.3.x subTitle alias must keep working through that public surface.
describe('subTitle through the public package entry', () => {
  it('renders subTitle on the exported PageContainer', () => {
    render(<PageContainer title="Agents" subTitle="Legacy description" />);
    expect(screen.getByText('Legacy description')).toBeTruthy();
  });

  it('renders subTitle on the exported PageShell and prefers content', () => {
    const { unmount } = render(<PageShell title="Agents" subTitle="Legacy only" />);
    expect(screen.getByText('Legacy only')).toBeTruthy();
    unmount();
    render(<PageShell title="Agents" content="Current" subTitle="Legacy" />);
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.queryByText('Legacy')).toBeNull();
  });
});
