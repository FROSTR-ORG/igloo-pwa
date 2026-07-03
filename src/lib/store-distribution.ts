import type { Dispatch, SetStateAction } from 'react';
import {
  buildProfileDownloadFilename,
  type PolicyOverrideValue,
} from 'igloo-shared';

import { saveTextToFile } from './file-save';
import * as adapter from './local-adapter';
import type { SessionController } from './session-controller';
import {
  defaultDrafts,
  ensureDistributionForm,
  ensureDistributionPasswordSlot,
} from './store-hydrate';
import type {
  PwaDistributionActionResult,
  PwaPersistedState,
  PwaProfile,
} from './types';

export type StoreDistributionActions = {
  updateDistributionForm: (
    memberIdx: number,
    field: 'label',
    value: string,
  ) => void;
  updateDistributionPassword: (
    memberIdx: number,
    field: 'password' | 'confirmPassword',
    value: string,
  ) => void;
  distributeShare: (
    memberIdx: number,
    kind: 'prepare' | 'copy' | 'qr' | 'save' | 'mark' | 'cancel' | 'revert',
  ) => Promise<void>;
  updateDistributionPermission: (
    memberIdx: number,
    permission: 'sign' | 'ecdh' | 'ping' | 'onboard',
    enabled: boolean,
  ) => Promise<void>;
  closeQrPackage: () => void;
  startDistributionClient: () => Promise<void>;
  stopDistributionClient: () => Promise<void>;
  finishSetup: () => Promise<void>;
};

export function createDistributionActions({
  controller,
  getState,
  getSelectedProfile,
  setState,
}: {
  controller: SessionController;
  getState: () => PwaPersistedState;
  getSelectedProfile: () => PwaProfile | null;
  setState: Dispatch<SetStateAction<PwaPersistedState>>;
}): StoreDistributionActions {
  return {
    updateDistributionForm(memberIdx, field, value) {
      setState((current) => {
        const share = current.pendingKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
        return {
          ...current,
          drafts: {
            ...current.drafts,
            distributionForms: {
              ...current.drafts.distributionForms,
              [memberIdx]: {
                ...ensureDistributionForm(
                  current.drafts.distributionForms,
                  memberIdx,
                  share?.name ?? `Member ${memberIdx}`,
                ),
                [field]: value,
              },
            },
          },
        };
      });
    },
    updateDistributionPassword(memberIdx, field, value) {
      setState((current) => ({
        ...current,
        draftSecrets: {
          ...current.draftSecrets,
          distributionPasswords: {
            ...current.draftSecrets.distributionPasswords,
            [memberIdx]: {
              ...ensureDistributionPasswordSlot(current.draftSecrets.distributionPasswords, memberIdx),
              [field]: value,
            },
          },
        },
      }));
    },
    async distributeShare(memberIdx, kind) {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!snapshot.pendingKeyset || !snapshot.distributionSession || !selectedProfile) {
        throw new Error('Create the primary device profile before distributing shares.');
      }
      const existing = snapshot.distributionSession.results[memberIdx];

      const writeResult = (next: PwaDistributionActionResult | null) => {
        setState((current) => {
          if (!current.distributionSession) return current;
          const results = { ...current.distributionSession.results };
          if (next) {
            results[memberIdx] = next;
          } else {
            delete results[memberIdx];
          }
          // Discarding the package also clears any QR still showing it.
          const qr_package =
            next == null && current.distributionSession.qr_package?.member_idx === memberIdx
              ? null
              : current.distributionSession.qr_package;
          return {
            ...current,
            distributionSession: { ...current.distributionSession, results, qr_package },
          };
        });
      };

      // Status-only transitions that operate on the already-created package.
      if (kind === 'mark') {
        if (!existing) {
          throw new Error('Create the onboarding package before marking it delivered.');
        }
        writeResult({ ...existing, status: 'delivered' });
        return;
      }
      if (kind === 'revert') {
        if (!existing) {
          throw new Error('No distributed share to revert.');
        }
        writeResult({ ...existing, status: 'packaged' });
        return;
      }
      if (kind === 'cancel') {
        writeResult(null);
        return;
      }

      if (kind === 'prepare') {
        const form = ensureDistributionForm(
          snapshot.drafts.distributionForms,
          memberIdx,
          snapshot.pendingKeyset.shares.find((share) => share.member_idx === memberIdx)?.name ?? `Member ${memberIdx}`,
        );
        // Share password lives in the segregated draftSecrets partition, not
        // on the persistable distribution form.
        const passwordSlot = ensureDistributionPasswordSlot(
          snapshot.draftSecrets.distributionPasswords,
          memberIdx,
        );
        if (passwordSlot.password !== passwordSlot.confirmPassword) {
          throw new Error('Share password confirmation does not match.');
        }
        if (!form.label.trim()) {
          throw new Error('Share name is required.');
        }

        const result = await adapter.createOnboardingPackageForShare({
          keyset: snapshot.pendingKeyset,
          shareMemberIdx: memberIdx,
          label: form.label,
          password: passwordSlot.password,
          relayUrls: selectedProfile.relays.join('\n'),
          signerPubkey: snapshot.distributionSession.signer_pubkey,
        });

        writeResult({
          status: 'packaged',
          member_idx: memberIdx,
          label: form.label,
          package_text: result.package_text,
        });
        return;
      }

      // copy / qr / save operate on the package built by `prepare`.
      if (!existing?.package_text) {
        throw new Error('Create the onboarding package before sharing it.');
      }
      if (kind === 'copy') {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(existing.package_text);
        }
        return;
      }
      if (kind === 'qr') {
        setState((current) => ({
          ...current,
          distributionSession: current.distributionSession
            ? {
                ...current.distributionSession,
                qr_package: {
                  member_idx: memberIdx,
                  label: existing.label,
                  package_text: existing.package_text,
                },
              }
            : current.distributionSession,
        }));
        return;
      }
      if (kind === 'save') {
        const sharePublicKey =
          snapshot.pendingKeyset.shares.find((share) => share.member_idx === memberIdx)?.share_public_key ?? '';
        const saved = await saveTextToFile(
          buildProfileDownloadFilename(existing.label, sharePublicKey, 'bfonboard.txt'),
          existing.package_text,
        );
        if (saved) {
          writeResult({ ...existing, status: 'saved' });
        }
        return;
      }
    },
    async updateDistributionPermission(memberIdx, permission, enabled) {
      const snapshot = getState();
      const nextPermissions = enabled
        ? Array.from(new Set([...(snapshot.drafts.distributionPermissions[memberIdx] ?? []), permission]))
        : (snapshot.drafts.distributionPermissions[memberIdx] ?? []).filter((entry) => entry !== permission);

      let runtimeSnapshot = snapshot.runtimeSnapshot;
      const share = snapshot.pendingKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
      if (share && runtimeSnapshot) {
        const distributionValue: PolicyOverrideValue = enabled ? 'allow' : 'deny';
        const requestSnapshot = await adapter.applyPeerPolicy(
          runtimeSnapshot,
          share.share_public_key,
          'request',
          permission,
          distributionValue,
          controller,
        );
        if (requestSnapshot) {
          runtimeSnapshot = requestSnapshot;
          const respondSnapshot = await adapter.applyPeerPolicy(
            runtimeSnapshot,
            share.share_public_key,
            'respond',
            permission,
            distributionValue,
            controller,
          );
          if (respondSnapshot) {
            runtimeSnapshot = respondSnapshot;
          }
        }
      }

      setState((current) => ({
        ...current,
        drafts: {
          ...current.drafts,
          distributionPermissions: {
            ...current.drafts.distributionPermissions,
            [memberIdx]: nextPermissions,
          },
        },
        runtimeSnapshot,
        peerPermissionStates: runtimeSnapshot?.peer_permission_states ?? current.peerPermissionStates,
      }));
    },
    closeQrPackage() {
      setState((current) => ({
        ...current,
        distributionSession: current.distributionSession
          ? { ...current.distributionSession, qr_package: null }
          : null,
      }));
    },
    async startDistributionClient() {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile) {
        throw new Error('Save the device profile before starting the onboarding client.');
      }
      if (snapshot.runtimeSnapshot?.active) return;
      const runtimeSnapshot = await adapter.startSession(selectedProfile, snapshot.unlockPassphrase, controller);
      setState((current) => ({
        ...current,
        profiles:
          runtimeSnapshot.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === selectedProfile.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        peerPermissionStates:
          runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
        runtimeWarning: null,
        runtimeSnapshot,
      }));
    },
    async stopDistributionClient() {
      const snapshot = getState();
      if (!snapshot.runtimeSnapshot?.active) return;
      const runtimeSnapshot = await adapter.stopSession(snapshot.runtimeSnapshot, controller);
      setState((current) => ({
        ...current,
        profiles:
          runtimeSnapshot?.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        peerPermissionStates:
          runtimeSnapshot?.peer_permission_states ?? current.peerPermissionStates,
        runtimeWarning: null,
        runtimeSnapshot,
      }));
    },
    async finishSetup() {
      const snapshot = getState();
      // Capture the latest runtime snapshot (peer pubkey + nonce pool negotiated
      // during distribution) so it persists into the already-stored profile before
      // we lock the device.
      let latestSnapshot = snapshot.runtimeSnapshot;
      if (latestSnapshot?.active) {
        try {
          latestSnapshot = (await adapter.readSession(latestSnapshot, controller)) ?? latestSnapshot;
        } catch {
          // Fall back to the last known snapshot if the live read fails.
        }
      }
      const persistedProfile = latestSnapshot?.profile ?? null;

      // Stop the live runtime session before returning to the lock screen.
      if (snapshot.runtimeSnapshot?.active) {
        try {
          await adapter.stopSession(snapshot.runtimeSnapshot, controller);
        } catch {
          // Ignore stop failures while tearing down the setup session.
        }
      }

      setState((current) => ({
        ...current,
        profiles: persistedProfile
          ? current.profiles.map((entry) =>
              entry.id === persistedProfile.id
                ? {
                    ...entry,
                    // Persisted runtime snapshots were dropped (they serialized
                    // the share seckey at rest); only carry the non-secret peer
                    // pubkey negotiated during distribution.
                    peer_pubkey: persistedProfile.peer_pubkey ?? entry.peer_pubkey ?? null,
                  }
                : entry,
            )
          : current.profiles,
        // Purge in-memory setup secrets and return to the locked Welcome.
        pendingKeyset: null,
        selectedGeneratedShareIdx: null,
        distributionSession: null,
        runtimeSnapshot: null,
        unlockPassphrase: '',
        activeView: 'landing',
        activeDashboardTab: 'signer',
        drafts: {
          ...current.drafts,
          profileForm: { ...defaultDrafts.profileForm },
          distributionForms: {},
          distributionPermissions: {},
        },
      }));
    },
  };
}
