import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContainer } from './PageContainer';
import { PageShell } from './PageShell';

describe('PageShell description', () => {
  it('renders content as the page description', () => {
    render(<PageShell title="Users" content="Manage users" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeTruthy();
    expect(screen.getByText('Manage users')).toBeTruthy();
  });

  it('keeps the deprecated v1.3.x subTitle prop working through PageContainer', () => {
    render(<PageContainer title="Agents" subTitle="Legacy description" />);
    expect(screen.getByText('Legacy description')).toBeTruthy();
  });

  it('prefers content over the deprecated subTitle alias', () => {
    render(<PageShell title="Agents" content="Current" subTitle="Legacy" />);
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.queryByText('Legacy')).toBeNull();
  });
});
