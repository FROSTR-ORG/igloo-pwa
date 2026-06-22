import type { Dispatch, SetStateAction } from 'react';

import * as adapter from './local-adapter';
import { defaultDrafts } from './store-hydrate';
import type { PwaPersistedState, PwaProfile } from './types';

export type StoreRecoverActions = {
  startRecoverKey: (profileId: string) => void;
  setRecoverDevicePassphrase: (value: string) => void;
  verifyRecoverDeviceUnlock: () => Promise<void>;
  setRecoverLostDevice: (value: boolean) => void;
  updateRecoverSource: (
    index: number,
    field: 'packageText' | 'password',
    value: string,
  ) => void;
  addRecoverSource: () => void;
  removeRecoverSource: (index: number) => void;
  recoverKeyFromShares: () => Promise<{ nsec: string; signingKeyHex: string }>;
};

export function createRecoverActions({
  getState,
  getSelectedProfile,
  setState,
}: {
  getState: () => PwaPersistedState;
  getSelectedProfile: () => PwaProfile | null;
  setState: Dispatch<SetStateAction<PwaPersistedState>>;
}): StoreRecoverActions {
  return {
    startRecoverKey(profileId) {
      setState((current) => ({
        ...current,
        selectedProfileId: profileId,
        activeView: 'recover-collect',
        drafts: {
          ...current.drafts,
          recoverKeyForm: {
            sourceProfileId: profileId,
            sources: [{ packageText: '' }],
          },
        },
        draftSecrets: {
          ...current.draftSecrets,
          recoverKeySources: {},
          recoverDevicePassphrase: '',
          recoverDeviceUnlockVerified: false,
          recoverLostDevice: false,
        },
      }));
    },
    setRecoverDevicePassphrase(value) {
      setState((current) => ({
        ...current,
        draftSecrets: {
          ...current.draftSecrets,
          recoverDevicePassphrase: value,
          // A changed passphrase must be re-verified before it counts again.
          recoverDeviceUnlockVerified: false,
        },
      }));
    },
    async verifyRecoverDeviceUnlock() {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile) {
        return;
      }
      const verified = await adapter.verifyDeviceShareUnlock({
        encryptedShareArtifact: selectedProfile.encrypted_bfshare_artifact,
        devicePassphrase: snapshot.draftSecrets.recoverDevicePassphrase,
      });
      setState((current) => ({
        ...current,
        draftSecrets: { ...current.draftSecrets, recoverDeviceUnlockVerified: verified },
      }));
    },
    setRecoverLostDevice(value) {
      setState((current) => ({
        ...current,
        draftSecrets: {
          ...current.draftSecrets,
          recoverLostDevice: value,
          // Entering lost-device mode drops the device passphrase + its verified
          // state; the device share is not used on that path.
          recoverDevicePassphrase: value ? '' : current.draftSecrets.recoverDevicePassphrase,
          recoverDeviceUnlockVerified: value ? false : current.draftSecrets.recoverDeviceUnlockVerified,
        },
      }));
    },
    updateRecoverSource(index, field, value) {
      setState((current) => {
        if (field === 'password') {
          // Per-source passphrases are secrets: keep them out of the
          // persistable recoverKeyForm and in draftSecrets instead.
          return {
            ...current,
            draftSecrets: {
              ...current.draftSecrets,
              recoverKeySources: {
                ...current.draftSecrets.recoverKeySources,
                [index]: value,
              },
            },
          };
        }
        return {
          ...current,
          drafts: {
            ...current.drafts,
            recoverKeyForm: {
              ...current.drafts.recoverKeyForm,
              sources: current.drafts.recoverKeyForm.sources.map((entry, sourceIndex) =>
                sourceIndex === index ? { ...entry, [field]: value } : entry,
              ),
            },
          },
        };
      });
    },
    addRecoverSource() {
      setState((current) => ({
        ...current,
        drafts: {
          ...current.drafts,
          recoverKeyForm: {
            ...current.drafts.recoverKeyForm,
            sources: [...current.drafts.recoverKeyForm.sources, { packageText: '' }],
          },
        },
      }));
    },
    removeRecoverSource(index) {
      setState((current) => ({
        ...current,
        drafts: {
          ...current.drafts,
          recoverKeyForm: {
            ...current.drafts.recoverKeyForm,
            sources:
              current.drafts.recoverKeyForm.sources.length > 1
                ? current.drafts.recoverKeyForm.sources.filter((_, sourceIndex) => sourceIndex !== index)
                : current.drafts.recoverKeyForm.sources,
          },
        },
      }));
    },
    async recoverKeyFromShares() {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile) {
        throw new Error('Select a device profile to recover its key.');
      }
      const lostDevice = snapshot.draftSecrets.recoverLostDevice;
      // Normal path: the recovering device is a group member, so its profile
      // supplies the group package (public) and its own share (unlocked with the
      // device passphrase), which counts toward the threshold; the rest are pasted.
      // Lost-device path: the device share/passphrase are omitted and the full
      // threshold is met from pasted shares alone.
      const recovered = await adapter.recoverNsecFromShares({
        groupPackageJson: selectedProfile.group_package_json,
        encryptedShareArtifact: lostDevice ? null : selectedProfile.encrypted_bfshare_artifact,
        devicePassphrase: lostDevice ? null : snapshot.draftSecrets.recoverDevicePassphrase,
        sources: snapshot.drafts.recoverKeyForm.sources
          .map((source, index) => ({
            packageText: source.packageText.trim(),
            password: snapshot.draftSecrets.recoverKeySources[index] ?? '',
          }))
          .filter((source) => source.packageText && source.password),
      });
      // The reconstructed key is never persisted; it is returned to the caller for
      // in-memory display and the source inputs/passphrase are cleared immediately.
      setState((current) => ({
        ...current,
        activeView: 'recover-key',
        drafts: {
          ...current.drafts,
          recoverKeyForm: defaultDrafts.recoverKeyForm,
        },
        draftSecrets: {
          ...current.draftSecrets,
          recoverKeySources: {},
          recoverDevicePassphrase: '',
          recoverDeviceUnlockVerified: false,
          recoverLostDevice: false,
        },
      }));
      return recovered;
    },
  };
}
