import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createBrowserProfilePreview, publicKeyFromSecret } from 'igloo-shared';

import { OnboardHandshakeView, OnboardFailedView } from '../../src/views/onboard';

// Acme 2-of-3 preview: device is member idx 1 (shareSecret = '11'.repeat(32)).
// Built via igloo-shared helpers — no hand-crafted JSON, no secret exposed.
const shareSecret = '11'.repeat(32);
const ACME_2_OF_3_PREVIEW = createBrowserProfilePreview(
  {
    profileId: 'test-profile-id',
    version: 1,
    device: {
      name: 'Acme Device',
      shareSecret,
      manualPeerPolicyOverrides: [],
      relays: ['wss://relay.example'],
    },
    groupPackage: {
      groupName: 'Acme Keyset',
      groupPk: `02${publicKeyFromSecret(shareSecret)}`,
      threshold: 2,
      members: [
        { idx: 0, pubkey: `02${publicKeyFromSecret('22'.repeat(32))}` },
        { idx: 1, pubkey: `02${publicKeyFromSecret(shareSecret)}` },
        { idx: 2, pubkey: `02${publicKeyFromSecret('33'.repeat(32))}` },
      ],
    },
  },
  'bfonboard',
);

function handshakeStoreStub() {
  return {
    pendingOnboardConnection: { preview: ACME_2_OF_3_PREVIEW },
    drafts: { onboardConnectForm: { packageText: 'bfonboard1abc' } },
    setActiveView: vi.fn(),
  } as unknown as Parameters<typeof OnboardHandshakeView>[0]['store'];
}

function failedStoreStub() {
  return {
    pendingOnboardConnection: { preview: ACME_2_OF_3_PREVIEW },
  } as unknown as Parameters<typeof OnboardFailedView>[0]['store'];
}

describe('OnboardHandshakeView metadata', () => {
  it('shows the real keyset, threshold, and share index — not the placeholders', () => {
    render(<OnboardHandshakeView store={handshakeStoreStub()} />);
    expect(screen.getByText(/Acme Keyset \(2\/3\)/)).toBeInTheDocument();
    expect(screen.getByText(/Share #1/)).toBeInTheDocument();
    expect(screen.queryByText(/My Signing Key/)).not.toBeInTheDocument();
  });
});

describe('OnboardFailedView metadata', () => {
  it('shows the real keyset name and threshold — not the placeholders', () => {
    render(<OnboardFailedView store={failedStoreStub()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Acme Keyset \(2\/3\)/)).toBeInTheDocument();
    expect(screen.queryByText(/My Signing Key/)).not.toBeInTheDocument();
  });
});
