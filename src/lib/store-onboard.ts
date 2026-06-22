import type { Dispatch, SetStateAction } from 'react';

import * as adapter from './local-adapter';
import { SessionController } from './session-controller';
import { setDraftFormField, setDraftSecretField } from './store-drafts';
import type {
  PwaDraftState,
  PwaPersistedState,
  PwaProfile,
  PwaRuntimeSnapshot,
} from './types';

const ONBOARD_HANDSHAKE_MINIMUM_MS = 350;

type PersistProfileToDashboard = (
  profile: PwaProfile,
  passphrase: string,
  runtimeSnapshot?: PwaRuntimeSnapshot | null,
  adoptStaged?: boolean,
) => Promise<void>;

export type StoreOnboardActions = {
  updateOnboardConnectForm: (field: 'packageText', value: string) => void;
  updateOnboardConnectPassword: (value: string) => void;
  connectOnboardingPackage: () => Promise<void>;
  updateOnboardSaveForm: (field: 'label' | 'relayUrls', value: string) => void;
  updateOnboardSavePassword: (field: 'password' | 'confirmPassword', value: string) => void;
  finalizeOnboardedDevice: () => Promise<void>;
  cancelOnboarding: () => void;
};

export function createOnboardActions({
  controller,
  getState,
  setState,
  persistProfileToDashboard,
}: {
  controller: SessionController;
  getState: () => PwaPersistedState;
  setState: Dispatch<SetStateAction<PwaPersistedState>>;
  persistProfileToDashboard: PersistProfileToDashboard;
}): StoreOnboardActions {
  return {
    updateOnboardConnectForm(field, value) {
      setState((current) => setDraftFormField(current, 'onboardConnectForm', field, value));
    },
    updateOnboardConnectPassword(value) {
      setState((current) => setDraftSecretField(current, 'onboardConnectFormPassword', value));
    },
    async connectOnboardingPackage() {
      const snapshot = getState();
      // Fresh entry: release any node staged by a prior (abandoned) handshake
      // before starting a new one.
      controller.discardStagedSession();
      setState((current) => ({
        ...current,
        activeView: 'onboard-handshake',
        pendingOnboardConnection: null,
      }));
      try {
        await new Promise((resolve) => window.setTimeout(resolve, ONBOARD_HANDSHAKE_MINIMUM_MS));
        const { connection, stagedSession } = await adapter.connectOnboardingPackage({
          packageText: snapshot.drafts.onboardConnectForm.packageText,
          password: snapshot.draftSecrets.onboardConnectFormPassword,
          // Keep the live onboarding node alive so finalize can adopt it as the
          // durable signer (no capture-then-relaunch seam).
          keepAlive: true,
        });
        // Park the live node until the device profile is finalized + saved.
        if (stagedSession) {
          controller.stageOnboardSession(stagedSession);
        }
        setState((current) => ({
          ...current,
          pendingOnboardConnection: connection,
          activeView: 'onboard-save',
          drafts: {
            ...current.drafts,
            onboardSaveForm: {
              ...current.drafts.onboardSaveForm,
              label: connection.preview.label,
              relayUrls: connection.preview.relays.join('\n'),
            },
          },
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          activeView: 'onboard-failed',
          // Don't retain the onboarding decrypt passwords after a failed
          // handshake (mirrors cancelOnboarding's cleanup).
          draftSecrets: {
            ...current.draftSecrets,
            onboardConnectFormPassword: '',
            onboardSaveFormPassword: '',
            onboardSaveFormConfirm: '',
          },
        }));
        throw error;
      }
    },
    updateOnboardSaveForm(field, value) {
      setState((current) => setDraftFormField(current, 'onboardSaveForm', field, value));
    },
    updateOnboardSavePassword(field, value) {
      setState((current) =>
        setDraftSecretField(
          current,
          field === 'password' ? 'onboardSaveFormPassword' : 'onboardSaveFormConfirm',
          value,
        ),
      );
    },
    async finalizeOnboardedDevice() {
      const snapshot = getState();
      if (!snapshot.pendingOnboardConnection) {
        throw new Error('Connect an onboarding package first.');
      }
      if (snapshot.draftSecrets.onboardSaveFormPassword !== snapshot.draftSecrets.onboardSaveFormConfirm) {
        throw new Error('Device password confirmation does not match.');
      }
      const password = snapshot.draftSecrets.onboardSaveFormPassword;
      const profile = await adapter.finalizeOnboardedDevice({
        connection: snapshot.pendingOnboardConnection,
        label: snapshot.drafts.onboardSaveForm.label,
        password,
        existingProfileIds: snapshot.profiles.map((entry) => entry.id),
      });
      try {
        // Adopt the live staged onboarding node as the durable signer (when
        // auto-open is enabled) instead of relaunching from a snapshot — the
        // exchanged nonce pool is already live in that node, so the device can
        // co-sign immediately with no capture-then-relaunch seam.
        await persistProfileToDashboard(profile, password, null, /* adoptStaged */ true);
      } finally {
        // Release the staged node if it was not adopted (auto-open disabled, or
        // an activation error). No-op once adopted as the active session.
        controller.discardStagedSession();
      }
      setState((current) => ({
        ...current,
        pendingOnboardConnection: null,
        pendingRotationConnection: null,
        peerPermissionStates:
          current.peerPermissionStates.length
            ? current.peerPermissionStates
            : adapter.defaultPeerPermissionStates(),
        draftSecrets: {
          ...current.draftSecrets,
          onboardConnectFormPassword: '',
          onboardSaveFormPassword: '',
          onboardSaveFormConfirm: '',
        },
      }));
    },
    cancelOnboarding() {
      // Abandon the onboard flow: tear down the staged (never-adopted) node and
      // clear the in-memory connection + device-password drafts before leaving.
      controller.discardStagedSession();
      setState((current) => ({
        ...current,
        pendingOnboardConnection: null,
        activeView: 'landing',
        draftSecrets: {
          ...current.draftSecrets,
          onboardConnectFormPassword: '',
          onboardSaveFormPassword: '',
          onboardSaveFormConfirm: '',
        },
      }));
    },
  };
}
