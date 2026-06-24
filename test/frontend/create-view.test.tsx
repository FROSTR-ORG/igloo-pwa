import { render, screen } from '@testing-library/react';
import { nip19 } from 'nostr-tools';
import { describe, expect, it, vi } from 'vitest';

import { CreateSelectShareView } from '../../src/views/create';

describe('create select-share view', () => {
  it('passes an npub-encoded group public key into shared Select Share UI', () => {
    const groupPublicKey = '11'.repeat(32);
    const store = {
      pendingKeyset: {
        group_name: 'Treasury Signers',
        group_public_key: groupPublicKey,
        shares: [
          { name: 'Share 1', member_idx: 0, share_public_key: '22'.repeat(32) },
          { name: 'Share 2', member_idx: 1, share_public_key: '33'.repeat(32) },
        ],
      },
      selectedGeneratedShareIdx: 0,
      selectGeneratedShare: vi.fn(),
      continueToSaveProfile: vi.fn(),
      setActiveView: vi.fn(),
    };

    render(<CreateSelectShareView store={store as never} run={vi.fn()} />);

    expect(screen.getByText(nip19.npubEncode(groupPublicKey))).toBeInTheDocument();
    expect(screen.getByText(groupPublicKey)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy group public key' })).not.toBeInTheDocument();
  });
});
