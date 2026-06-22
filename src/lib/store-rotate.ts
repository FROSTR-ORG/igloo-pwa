import type { Dispatch, SetStateAction } from 'react';
import {
  groupPublicKeyFromPackage,
  saveBrowserProfileAndMaybeActivate,
} from 'igloo-shared';

import * as adapter from './local-adapter';
import type { SessionController } from './session-controller';
import { setDraftFormField, setDraftSecretField } from './store-drafts';
import type { PwaPersistedState, PwaProfile } from './types';

export type StoreRotateActions = {
  startRotateKey: () => void;
  updateRotateConnectForm: (field: 'packageText', value: string) => void;
  updateRotateConnectPassword: (value: string) => void;
  connectRotationPackage: () => Promise<void>;
  finalizeRotationUpdate: () => Promise<void>;
};

export function createRotateActions({
  controller,
  getState,
  getSelectedProfile,
  setState,
}: {
  controller: SessionController;
  getState: () => PwaPersistedState;
  getSelectedProfile: () => PwaProfile | null;
  setState: Dispatch<SetStateAction<PwaPersistedState>>;
}): StoreRotateActions {
  return {
    startRotateKey() {
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile) {
        throw new Error('Select a profile first.');
      }
      setState((current) => ({
        ...current,
        activeView: 'rotate-connect',
        drafts: {
          ...current.drafts,
          rotateConnectForm: {
            packageText: '',
          },
        },
        draftSecrets: {
          ...current.draftSecrets,
          rotateConnectFormPassword: '',
        },
      }));
    },
    updateRotateConnectForm(field, value) {
      setState((current) => setDraftFormField(current, 'rotateConnectForm', field, value));
    },
    updateRotateConnectPassword(value) {
      setState((current) => setDraftSecretField(current, 'rotateConnectFormPassword', value));
    },
    async connectRotationPackage() {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile) {
        throw new Error('Select a profile first.');
      }
      // Rotation derives a new keyset and starts a fresh node, so it does NOT
      // keep the onboarding node alive (no `keepAlive`); today's capture-then-
      // shutdown behavior is preserved and there is no staged session to adopt.
      const { connection } = await adapter.connectOnboardingPackage({
        packageText: snapshot.drafts.rotateConnectForm.packageText,
        password: snapshot.draftSecrets.rotateConnectFormPassword,
      });
      if (
        connection.profile_payload &&
        groupPublicKeyFromPackage(connection.profile_payload.groupPackage) !== selectedProfile.group_public_key
      ) {
        throw new Error('Rotation package does not match the selected profile group public key.');
      }
      if (connection.profile_payload?.profileId === selectedProfile.id) {
        throw new Error('Rotation package did not produce a new device profile id.');
      }
      setState((current) => ({
        ...current,
        pendingRotationConnection: connection,
        activeView: 'rotate-save',
      }));
    },
    async finalizeRotationUpdate() {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile || !snapshot.pendingRotationConnection) {
        throw new Error('Connect a rotation package first.');
      }
      // The profile being rotated is the active, unlocked one, so its
      // passphrase is the current in-memory unlock passphrase.
      const targetPassphrase = snapshot.unlockPassphrase;
      if (!targetPassphrase.trim()) {
        throw new Error('Target profile passphrase is required to rotate.');
      }
      if (snapshot.runtimeSnapshot?.active) {
        await adapter.stopSession(snapshot.runtimeSnapshot, controller);
      }
      const profile = await adapter.finalizeRotationUpdateFromConnection({
        targetProfile: selectedProfile,
        targetPassphrase,
        connection: snapshot.pendingRotationConnection,
        existingProfileIds: snapshot.profiles.map((entry) => entry.id),
      });
      const newPassphrase = snapshot.pendingRotationConnection.passphrase;
      const saved = await saveBrowserProfileAndMaybeActivate({
        profile,
        autoStart: true,
        activate: async () => await adapter.startSession(profile, newPassphrase, controller),
      });
      const runtimeSnapshot = saved.runtime;
      setState((current) => ({
        ...current,
        profiles: [
          profile,
          ...current.profiles.filter((entry) => entry.id !== selectedProfile.id && entry.id !== profile.id),
        ],
        selectedProfileId: profile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot,
        runtimeWarning: saved.runtimeWarning?.message ?? null,
        unlockPassphrase: newPassphrase,
        pendingRotationConnection: null,
        peerPermissionStates:
          runtimeSnapshot?.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
        draftSecrets: {
          ...current.draftSecrets,
          rotateConnectFormPassword: '',
        },
      }));
    },
  };
}
