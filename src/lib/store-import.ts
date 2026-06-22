import type { Dispatch, SetStateAction } from 'react';

import * as adapter from './local-adapter';
import { setDraftFormField, setDraftSecretField } from './store-drafts';
import { defaultDrafts } from './store-hydrate';
import type {
  PwaDraftState,
  PwaLoadConfirmation,
  PwaPersistedState,
  PwaProfile,
  PwaRuntimeSnapshot,
} from './types';

type PersistProfileToDashboard = (
  profile: PwaProfile,
  passphrase: string,
  runtimeSnapshot?: PwaRuntimeSnapshot | null,
  adoptStaged?: boolean,
) => Promise<void>;

export type StoreImportActions = {
  startLoadImport: () => void;
  updateImportProfileForm: (field: keyof PwaDraftState['importProfileForm'], value: string) => void;
  updateImportProfilePassword: (value: string) => void;
  updateImportSaveForm: (field: keyof PwaDraftState['importSaveForm'], value: string) => void;
  updateImportSavePassword: (field: 'password' | 'confirmPassword', value: string) => void;
  loadBfProfile: () => Promise<void>;
  clearLoadError: () => void;
  acceptPendingLoadConfirmation: () => Promise<void>;
};

export function createImportActions({
  getState,
  setState,
  persistProfileToDashboard,
}: {
  getState: () => PwaPersistedState;
  setState: Dispatch<SetStateAction<PwaPersistedState>>;
  persistProfileToDashboard: PersistProfileToDashboard;
}): StoreImportActions {
  return {
    startLoadImport() {
      setState((current) => ({ ...current, activeView: 'load-import' }));
    },
    updateImportProfileForm(field, value) {
      setState((current) => setDraftFormField(current, 'importProfileForm', field, value));
    },
    updateImportProfilePassword(value) {
      setState((current) => setDraftSecretField(current, 'importProfileFormPassword', value));
    },
    updateImportSaveForm(field, value) {
      setState((current) => setDraftFormField(current, 'importSaveForm', field, value));
    },
    updateImportSavePassword(field, value) {
      setState((current) =>
        setDraftSecretField(
          current,
          field === 'password' ? 'importSaveFormPassword' : 'importSaveFormConfirm',
          value,
        ),
      );
    },
    async loadBfProfile() {
      const snapshot = getState();
      let confirmation: PwaLoadConfirmation;
      try {
        confirmation = await adapter.importBfProfile({
          profileString: snapshot.drafts.importProfileForm.profileString,
          password: snapshot.draftSecrets.importProfileFormPassword,
        });
      } catch (error) {
        // Import failures land on the dedicated Import Error screen rather than the
        // global alert banner, matching the Paper design.
        const message = error instanceof Error && error.message.trim()
          ? error.message
          : 'We couldn’t import this profile backup.';
        setState((current) => ({
          ...current,
          pendingLoadError: message,
          activeView: 'load-error',
          // Don't retain the decrypt passwords after a failed import — the
          // error screen never shows them, so clearing is pure hygiene
          // (mirrors the cancel paths).
          draftSecrets: {
            ...current.draftSecrets,
            importProfileFormPassword: '',
            importSaveFormPassword: '',
            importSaveFormConfirm: '',
          },
        }));
        return;
      }
      setState((current) => ({
        ...current,
        pendingLoadConfirmation: confirmation,
        pendingLoadError: null,
        activeView: 'load-confirm',
        drafts: {
          ...current.drafts,
          importSaveForm: {
            ...current.drafts.importSaveForm,
            label: confirmation.preview.label,
            relayUrls: confirmation.preview.relays.join('\n'),
          },
        },
        draftSecrets: {
          ...current.draftSecrets,
          importSaveFormPassword: '',
          importSaveFormConfirm: '',
        },
      }));
    },
    clearLoadError() {
      setState((current) => ({ ...current, pendingLoadError: null, activeView: 'load-import' }));
    },
    async acceptPendingLoadConfirmation() {
      const snapshot = getState();
      if (!snapshot.pendingLoadConfirmation) {
        throw new Error('No confirmed profile is waiting to be loaded.');
      }
      // The local-save password is a secret: read it from draftSecrets, not
      // the persistable importSaveForm.
      const password = snapshot.draftSecrets.importSaveFormPassword;
      const confirmPassword = snapshot.draftSecrets.importSaveFormConfirm;
      if (!password) {
        throw new Error('Enter a password to protect this profile on the device.');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      const localPassword = password;
      const profile = await adapter.finalizeLoadedProfile(
        snapshot.pendingLoadConfirmation,
        snapshot.profiles.map((entry) => entry.id),
        localPassword,
      );
      // The stored profile is re-encrypted under the new local password, so
      // the session must be started with that password, not the import
      // package's passphrase.
      await persistProfileToDashboard(profile, localPassword);
      setState((current) => ({
        ...current,
        pendingLoadConfirmation: null,
        drafts: {
          ...current.drafts,
          importSaveForm: { ...defaultDrafts.importSaveForm },
        },
        peerPermissionStates:
          current.peerPermissionStates.length
            ? current.peerPermissionStates
            : adapter.defaultPeerPermissionStates(),
        draftSecrets: {
          ...current.draftSecrets,
          importProfileFormPassword: '',
          importSaveFormPassword: '',
          importSaveFormConfirm: '',
        },
      }));
    },
  };
}
